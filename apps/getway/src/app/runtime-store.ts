import type {
  ProxyConfig,
  ProxyGroup,
  ProxyHeaderEntry,
  ProxyHeaderPreset,
  ProxyHeaderRule,
  ProxyMockGroup,
  ProxyMockRule,
  ProxyPayloadBody,
  ProxyRecordDetailResponse,
  ProxyRecordsExportResponse,
  ProxyRecordsResponse,
  ProxyRule,
  ProxySseEvent,
  ProxyTrafficRecord,
} from "@proxira/core";
import type { RuleInput } from "../rules/utils.js";
import { createRule, findMatchingRule } from "../rules/utils.js";
import type { MockRuleInput } from "../mock/utils.js";
import {
  createMockRule,
  findMatchingMockRule,
  MAX_MOCK_RULES,
  normalizeMockGroupName,
  normalizeMockGroups,
} from "../mock/utils.js";
import { normalizeHeaderPresets, normalizeIdList, normalizePresetName } from "../presets/utils.js";
import type {
  ExportRecordsQuery,
  RecordsQuery,
  RuntimeDeps,
  RuntimeSnapshot,
} from "./types.js";
import { AppError } from "../shared/errors.js";
import { readJsonFile, saveJsonFile } from "../shared/files.js";
import { encodeFilenameRFC5987, toSafeAsciiToken } from "../shared/format.js";
import { normalizeRecord, ensureUniqueRecordId, filterRecords } from "../history/utils.js";
import { createGroup, normalizeGroupName, normalizeTargetBaseUrl, normalizeTimeout } from "../groups/utils.js";
import { parseHeadersConfig } from "../headers/utils.js";
import type { RuntimeConfig } from "./types.js";

// Bodies are re-clipped before hitting disk: memory keeps the full capture
// (up to maxBodyCaptureBytes), while history.json only keeps a bounded prefix
// so a few large downloads cannot balloon the persist file to hundreds of MB.
const shrinkBodyForPersist = (
  body: ProxyPayloadBody,
  limitBytes: number,
): ProxyPayloadBody => {
  if (body.text === null || body.text.length <= limitBytes) {
    return body;
  }
  return {
    ...body,
    text: body.text.slice(0, limitBytes),
    truncated: true,
  };
};

const shrinkRecordForPersist = (
  record: ProxyTrafficRecord,
  config: RuntimeConfig,
): ProxyTrafficRecord => {
  if (config.historyPersistBodyLimitBytes <= 0) {
    return record;
  }
  const limit = config.historyPersistBodyLimitBytes;
  return {
    ...record,
    requestBody: shrinkBodyForPersist(record.requestBody, limit),
    responseBody: record.responseBody
      ? shrinkBodyForPersist(record.responseBody, limit)
      : null,
  };
};

type SseClient = {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeatTimer: ReturnType<typeof setInterval>;
};

type PersistKind = "config" | "history" | "rules";

type HistoryFilePayload = Record<string, ProxyTrafficRecord[]>;

const encoder = new TextEncoder();

export class RuntimeStore {
  private readonly deps: RuntimeDeps;
  private readonly proxyConfig: ProxyConfig;
  private readonly historyByGroup = new Map<string, ProxyTrafficRecord[]>();
  private readonly rulesByGroup = new Map<string, ProxyRule[]>();
  private readonly sseClients = new Map<string, SseClient>();
  private persistQueue = Promise.resolve();
  private readonly pendingPersist = new Map<PersistKind, () => Promise<void>>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: RuntimeDeps) {
    this.deps = deps;
    this.proxyConfig = {
      activeGroupId: "",
      groups: [],
      targetBaseUrl: deps.config.defaultTargetBaseUrl,
      headerPresets: [],
      mockGroups: [],
    };
  }

  async hydrate(): Promise<void> {
    await this.deps.fs.mkdir(this.deps.config.dataDir, { recursive: true });

    const fileConfig = await readJsonFile<Partial<ProxyConfig>>(
      this.deps.fs,
      this.deps.config.configFile,
    );
    const fileHistory = await readJsonFile<Partial<Record<string, unknown>>>(
      this.deps.fs,
      this.deps.config.historyFile,
    );
    const fileRules = await readJsonFile<ProxyRule[]>(this.deps.fs, this.deps.config.rulesFile);

    const normalizedDefaultTarget =
      normalizeTargetBaseUrl(this.deps.config.defaultTargetBaseUrl) ??
      "http://localhost:8080";
    const hydratedGroups: ProxyGroup[] = [];
    const usedGroupIds = new Set<string>();
    const usedTargets = new Set<string>();

    if (Array.isArray(fileConfig?.groups)) {
      for (const group of fileConfig.groups) {
        if (
          !group ||
          typeof group.id !== "string" ||
          typeof group.targetBaseUrl !== "string"
        ) {
          continue;
        }

        const groupId = group.id.trim();
        if (!groupId || usedGroupIds.has(groupId)) {
          continue;
        }

        const normalizedTarget = normalizeTargetBaseUrl(group.targetBaseUrl);
        if (!normalizedTarget || usedTargets.has(normalizedTarget)) {
          continue;
        }

        // Header config is rebuilt from scratch on every hydration: entries
        // that no longer make sense (renamed to a protected header, hand-edited
        // into an invalid name) are dropped instead of failing startup.
        const headers = parseHeadersConfig(
          { customHeaders: group.customHeaders, headerRules: group.headerRules },
          this.deps.randomUUID,
        );

        hydratedGroups.push({
          id: groupId,
          name: normalizeGroupName(group.name ?? "", hydratedGroups.length + 1),
          targetBaseUrl: normalizedTarget,
          upstreamTimeoutMs: normalizeTimeout(group.upstreamTimeoutMs),
          customHeaders: headers.customHeaders,
          headerRules: headers.headerRules,
          // Ids are validated after the presets / mock groups exist.
          headerPresetIds: normalizeIdList(group.headerPresetIds),
          mockGroupIds: normalizeIdList(group.mockGroupIds),
        });
        usedGroupIds.add(groupId);
        usedTargets.add(normalizedTarget);
      }
    }

    if (hydratedGroups.length === 0) {
      const legacyTarget = fileConfig?.targetBaseUrl
        ? normalizeTargetBaseUrl(fileConfig.targetBaseUrl)
        : null;
      hydratedGroups.push(
        createGroup(
          "默认转发地址",
          legacyTarget ?? normalizedDefaultTarget,
          this.deps.randomUUID,
        ),
      );
    }

    this.proxyConfig.groups = hydratedGroups;
    this.proxyConfig.headerPresets = normalizeHeaderPresets(
      fileConfig?.headerPresets,
      this.deps.randomUUID,
    );
    this.proxyConfig.mockGroups = normalizeMockGroups(
      fileConfig?.mockGroups,
      this.deps.randomUUID,
    );

    // Rules must exist before the mock migration can pick them apart.
    this.rulesByGroup.clear();
    for (const group of hydratedGroups) {
      this.rulesByGroup.set(group.id, this.hydrateGroupRules(fileRules, group.id));
    }

    // One-time migrations: a config saved before groups existed keeps working,
    // and from then on the user edits the group instead of the target.
    this.migrateLegacyHeaders();
    this.migrateLegacyMockRules();
    this.pruneMissingGroupRefs();

    const preferredGroupId =
      typeof fileConfig?.activeGroupId === "string" ? fileConfig.activeGroupId : "";
    const selectedGroup =
      (preferredGroupId
        ? hydratedGroups.find((group) => group.id === preferredGroupId)
        : null) ??
      hydratedGroups[0] ??
      null;

    this.proxyConfig.activeGroupId = selectedGroup?.id ?? "";
    this.syncConfigTargetBaseUrl();

    this.historyByGroup.clear();
    for (const group of hydratedGroups) {
      this.historyByGroup.set(
        group.id,
        this.hydrateGroupHistory(fileHistory, group),
      );
    }

    this.saveConfig();
    this.saveHistory();
    this.saveRules();
  }

  /**
   * Targets used to carry their own header config. Move it into a preset and
   * link it, so the settings screen has exactly one place to edit headers.
   *
   * The target's own lists are emptied on purpose: leaving them populated
   * would migrate the same headers again on every restart, growing one preset
   * per boot.
   */
  private migrateLegacyHeaders(): void {
    for (const group of this.proxyConfig.groups) {
      if (group.customHeaders.length === 0 && group.headerRules.length === 0) {
        continue;
      }
      const preset: ProxyHeaderPreset = {
        id: this.deps.randomUUID(),
        name: normalizePresetName(`${group.name} 的请求头`, this.proxyConfig.headerPresets.length + 1),
        customHeaders: group.customHeaders,
        headerRules: group.headerRules,
      };
      this.proxyConfig.headerPresets.push(preset);
      group.headerPresetIds = [preset.id, ...group.headerPresetIds];
      group.customHeaders = [];
      group.headerRules = [];
    }
  }

  /**
   * `action: "mock"` intervention rules predate the mock server. Lift them into
   * their own group and drop them from rules.json — what stays there is failure
   * injection, which is still per-target.
   *
   * Rule ids are not carried over: hydration already re-issues an id for every
   * rule (see `createRule`), so a recorded `appliedRuleId` never survived a
   * restart in the first place.
   */
  private migrateLegacyMockRules(): void {
    for (const group of this.proxyConfig.groups) {
      const rules = this.ensureGroupRules(group.id);
      const mockRules = rules.filter((rule) => rule.action === "mock");
      if (mockRules.length === 0) {
        continue;
      }

      const mockGroup: ProxyMockGroup = {
        id: this.deps.randomUUID(),
        name: normalizeMockGroupName(
          `${group.name} 的 Mock`,
          this.proxyConfig.mockGroups.length + 1,
        ),
        enabled: true,
        rules: mockRules.map((rule) =>
          createMockRule(
            {
              id: rule.id,
              name: rule.name,
              enabled: rule.enabled,
              matchPath: rule.matchPath,
              matchMethod: rule.matchMethod,
              delayMs: rule.delayMs,
              status: rule.status,
              headers: rule.headers,
              body: rule.body,
              stream: rule.stream,
              chunkIntervalMs: rule.chunkIntervalMs,
            },
            this.deps.randomUUID,
          ),
        ),
      };
      this.proxyConfig.mockGroups.push(mockGroup);
      group.mockGroupIds = [mockGroup.id, ...group.mockGroupIds];

      const remaining = rules.filter((rule) => rule.action !== "mock");
      this.rulesByGroup.set(group.id, remaining);
    }
  }

  private hydrateGroupRules(
    fileRules: ProxyRule[] | null,
    groupId: string,
  ): ProxyRule[] {
    if (!Array.isArray(fileRules)) {
      return [];
    }
    return fileRules
      .filter((rule) => rule && typeof rule.id === "string" && rule.groupId === groupId)
      .map((rule) => createRule(groupId, rule as RuleInput, this.deps.randomUUID));
  }

  listRules(groupIdRaw: string | undefined): { groupId: string; items: ProxyRule[] } {
    const group = this.resolveGroupOrActive(groupIdRaw);
    if (!group) {
      throw new AppError(404, "groupId not found.");
    }
    return { groupId: group.id, items: this.ensureGroupRules(group.id) };
  }

  // Returns the first enabled rule matching this request, or null.
  matchRule(groupId: string, method: string, path: string): ProxyRule | null {
    return findMatchingRule(this.ensureGroupRules(groupId), method, path);
  }

  // ---- Header presets ---------------------------------------------------

  listHeaderPresets(): ProxyHeaderPreset[] {
    return this.proxyConfig.headerPresets;
  }

  /**
   * The header layers for a target, in application order: the target's own
   * (legacy, normally empty) config first, then every linked preset in the
   * order the user listed them. A later layer overwrites what an earlier one
   * wrote, which is what "后面的覆盖前面的" in the UI means.
   */
  resolveHeaderLayers(groupId: string): {
    customHeaders: ProxyHeaderEntry[];
    headerRules: ProxyHeaderRule[];
  }[] {
    const group = this.findGroupById(groupId);
    if (!group) {
      return [];
    }

    const layers = [
      { customHeaders: group.customHeaders, headerRules: group.headerRules },
    ];
    // 顺序取自**全局分组列表**，不是引用数组的书写顺序：引用顺序取决于用户在
    // 转发地址表单里先点了哪个，那是看不见的；列表顺序才是界面上明示的那一个。
    for (const preset of this.proxyConfig.headerPresets) {
      if (!group.headerPresetIds.includes(preset.id)) {
        continue;
      }
      layers.push({
        customHeaders: preset.customHeaders,
        headerRules: preset.headerRules,
      });
    }
    return layers;
  }

  createHeaderPreset(payload: {
    name: string;
    customHeaders?: unknown;
    headerRules?: unknown;
  }): { preset: ProxyHeaderPreset; config: ProxyConfig } {
    const preset: ProxyHeaderPreset = {
      id: this.deps.randomUUID(),
      name: normalizePresetName(payload.name, this.proxyConfig.headerPresets.length + 1),
      customHeaders: [],
      headerRules: [],
    };
    // Reuse the strict path so a bad paste is rejected the same way it is when
    // the dashboard saves an existing preset.
    const applied = this.applyPresetConfig(preset, payload);
    this.proxyConfig.headerPresets.push(applied);
    return this.persistPresetChange(applied);
  }

  updateHeaderPreset(
    presetId: string,
    payload: { name?: string | undefined; customHeaders?: unknown; headerRules?: unknown },
  ): { preset: ProxyHeaderPreset; config: ProxyConfig } | null {
    const index = this.proxyConfig.headerPresets.findIndex((item) => item.id === presetId);
    const current = this.proxyConfig.headerPresets[index];
    if (!current) {
      return null;
    }

    if (typeof payload.name === "string") {
      const name = payload.name.trim();
      if (!name) {
        throw new AppError(400, "name cannot be empty.");
      }
      current.name = name;
    }

    const updated = this.applyPresetConfig(current, payload);
    this.proxyConfig.headerPresets[index] = updated;
    return this.persistPresetChange(updated);
  }

  deleteHeaderPreset(presetId: string): { removed: boolean; id: string; config: ProxyConfig } {
    const index = this.proxyConfig.headerPresets.findIndex((item) => item.id === presetId);
    if (index === -1) {
      return { removed: false, id: presetId, config: this.proxyConfig };
    }
    this.proxyConfig.headerPresets.splice(index, 1);
    // Dangling references would silently do nothing; unlink instead so the
    // target form never shows a phantom selection.
    for (const group of this.proxyConfig.groups) {
      group.headerPresetIds = group.headerPresetIds.filter((id) => id !== presetId);
    }
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { removed: true, id: presetId, config: this.proxyConfig };
  }

  moveHeaderPreset(
    presetId: string,
    direction: "up" | "down",
  ): { config: ProxyConfig } {
    this.moveInList(this.proxyConfig.headerPresets, presetId, direction);
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { config: this.proxyConfig };
  }

  private applyPresetConfig(
    preset: ProxyHeaderPreset,
    payload: { customHeaders?: unknown; headerRules?: unknown },
  ): ProxyHeaderPreset {
    if (payload.customHeaders === undefined && payload.headerRules === undefined) {
      return preset;
    }
    const parsed = parseHeadersConfig(payload, this.deps.randomUUID);
    if (parsed.problems.length > 0) {
      throw new AppError(400, parsed.problems.join(" "));
    }
    if (payload.customHeaders !== undefined) {
      preset.customHeaders = parsed.customHeaders;
    }
    if (payload.headerRules !== undefined) {
      preset.headerRules = parsed.headerRules;
    }
    return preset;
  }

  private persistPresetChange(preset: ProxyHeaderPreset): {
    preset: ProxyHeaderPreset;
    config: ProxyConfig;
  } {
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { preset, config: this.proxyConfig };
  }

  // ---- Mock groups ------------------------------------------------------

  listMockGroups(): ProxyMockGroup[] {
    return this.proxyConfig.mockGroups;
  }

  /**
   * First match wins across every linked group, in the order the target listed
   * them. A disabled group is skipped as a whole.
   */
  matchMockRule(
    groupId: string,
    method: string,
    path: string,
  ): { group: ProxyMockGroup; rule: ProxyMockRule } | null {
    const group = this.findGroupById(groupId);
    if (!group) {
      return null;
    }
    // 同样按全局列表顺序问，与请求头分组保持一致。
    for (const mockGroup of this.proxyConfig.mockGroups) {
      if (!group.mockGroupIds.includes(mockGroup.id) || !mockGroup.enabled) {
        continue;
      }
      const rule = findMatchingMockRule(mockGroup.rules, method, path);
      if (rule) {
        return { group: mockGroup, rule };
      }
    }
    return null;
  }

  createMockGroup(payload: {
    name: string;
    enabled?: boolean | undefined;
    rules?: unknown;
  }): { group: ProxyMockGroup; config: ProxyConfig } {
    const group: ProxyMockGroup = {
      id: this.deps.randomUUID(),
      name: normalizeMockGroupName(payload.name, this.proxyConfig.mockGroups.length + 1),
      enabled: payload.enabled ?? true,
      rules: [],
    };
    if (payload.rules !== undefined) {
      group.rules = this.parseMockRules(payload.rules);
    }
    this.proxyConfig.mockGroups.push(group);
    return this.persistMockGroupChange(group);
  }

  updateMockGroup(
    groupId: string,
    payload: {
      name?: string | undefined;
      enabled?: boolean | undefined;
      rules?: unknown;
    },
  ): { group: ProxyMockGroup; config: ProxyConfig } | null {
    const index = this.proxyConfig.mockGroups.findIndex((item) => item.id === groupId);
    const current = this.proxyConfig.mockGroups[index];
    if (!current) {
      return null;
    }

    if (typeof payload.name === "string") {
      const name = payload.name.trim();
      if (!name) {
        throw new AppError(400, "name cannot be empty.");
      }
      current.name = name;
    }
    if (typeof payload.enabled === "boolean") {
      current.enabled = payload.enabled;
    }
    if (payload.rules !== undefined) {
      current.rules = this.parseMockRules(payload.rules);
    }
    this.proxyConfig.mockGroups[index] = current;
    return this.persistMockGroupChange(current);
  }

  deleteMockGroup(groupId: string): { removed: boolean; id: string; config: ProxyConfig } {
    const index = this.proxyConfig.mockGroups.findIndex((item) => item.id === groupId);
    if (index === -1) {
      return { removed: false, id: groupId, config: this.proxyConfig };
    }
    this.proxyConfig.mockGroups.splice(index, 1);
    for (const group of this.proxyConfig.groups) {
      group.mockGroupIds = group.mockGroupIds.filter((id) => id !== groupId);
    }
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { removed: true, id: groupId, config: this.proxyConfig };
  }

  moveMockGroup(groupId: string, direction: "up" | "down"): { config: ProxyConfig } {
    this.moveInList(this.proxyConfig.mockGroups, groupId, direction);
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { config: this.proxyConfig };
  }

  private parseMockRules(raw: unknown): ProxyMockRule[] {
    if (!Array.isArray(raw)) {
      throw new AppError(400, "rules must be an array.");
    }
    if (raw.length > MAX_MOCK_RULES) {
      throw new AppError(400, `rules accepts at most ${MAX_MOCK_RULES} entries.`);
    }
    return raw.map((item) => createMockRule((item ?? {}) as MockRuleInput, this.deps.randomUUID));
  }

  private persistMockGroupChange(group: ProxyMockGroup): {
    group: ProxyMockGroup;
    config: ProxyConfig;
  } {
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { group, config: this.proxyConfig };
  }

  private moveInList<T extends { id: string }>(
    items: T[],
    id: string,
    direction: "up" | "down",
  ): void {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) {
      return;
    }
    const current = items[index];
    const neighbour = items[target];
    if (!current || !neighbour) {
      return;
    }
    items[index] = neighbour;
    items[target] = current;
  }

  createRuleEntry(
    groupIdRaw: string | undefined,
    input: RuleInput,
  ): { rule: ProxyRule; items: ProxyRule[] } {
    const group = this.resolveGroupOrActive(groupIdRaw);
    if (!group) {
      throw new AppError(404, "groupId not found.");
    }
    const rules = this.ensureGroupRules(group.id);
    const rule = createRule(group.id, input, this.deps.randomUUID);
    rules.push(rule);
    this.saveRules();
    return { rule, items: rules };
  }

  updateRuleEntry(
    ruleId: string,
    input: RuleInput,
  ): { rule: ProxyRule; items: ProxyRule[] } | null {
    for (const [groupId, rules] of this.rulesByGroup) {
      const index = rules.findIndex((rule) => rule.id === ruleId);
      if (index === -1) {
        continue;
      }
      const current = rules[index];
      if (!current) {
        continue;
      }
      const next = createRule(groupId, { ...current, ...input }, () => ruleId);
      rules[index] = next;
      this.saveRules();
      return { rule: next, items: rules };
    }
    return null;
  }

  deleteRuleEntry(ruleId: string): { removed: boolean; id: string } {
    for (const rules of this.rulesByGroup.values()) {
      const index = rules.findIndex((rule) => rule.id === ruleId);
      if (index === -1) {
        continue;
      }
      rules.splice(index, 1);
      this.saveRules();
      return { removed: true, id: ruleId };
    }
    return { removed: false, id: ruleId };
  }

  private ensureGroupRules(groupId: string): ProxyRule[] {
    const existing = this.rulesByGroup.get(groupId);
    if (existing) {
      return existing;
    }
    const created: ProxyRule[] = [];
    this.rulesByGroup.set(groupId, created);
    return created;
  }

  private serializeRules(): ProxyRule[] {
    const items: ProxyRule[] = [];
    for (const group of this.proxyConfig.groups) {
      items.push(...this.ensureGroupRules(group.id));
    }
    return items;
  }

  private saveRules(): void {
    this.enqueuePersist("rules", async () => {
      await saveJsonFile(
        this.deps.fs,
        this.deps.config.rulesFile,
        this.serializeRules(),
      );
    });
  }

  getConfig(): ProxyConfig {
    return this.proxyConfig;
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      config: this.proxyConfig,
      historySize: this.listGroupHistorySize(),
      sseClients: this.sseClients.size,
    };
  }

  updateConfig(payload: {
    activeGroupId?: string | undefined;
    targetBaseUrl?: string | undefined;
  }): ProxyConfig {
    const hasGroupSwitch = typeof payload.activeGroupId === "string";
    const hasTargetUpdate = typeof payload.targetBaseUrl === "string";
    if (!hasGroupSwitch && !hasTargetUpdate) {
      throw new AppError(400, "activeGroupId or targetBaseUrl is required.");
    }

    if (hasGroupSwitch) {
      const nextGroup = payload.activeGroupId
        ? this.findGroupById(payload.activeGroupId)
        : null;
      if (!nextGroup) {
        throw new AppError(400, "activeGroupId not found.");
      }
      this.proxyConfig.activeGroupId = nextGroup.id;
    }

    const activeGroup = this.ensureActiveGroup();
    if (!activeGroup) {
      throw new AppError(500, "No active group available.");
    }

    if (hasTargetUpdate) {
      const normalized = normalizeTargetBaseUrl(payload.targetBaseUrl ?? "");
      if (!normalized) {
        throw new AppError(400, "targetBaseUrl must be a valid HTTP/HTTPS URL.");
      }
      if (
        normalized !== activeGroup.targetBaseUrl &&
        this.hasTargetConflict(normalized, activeGroup.id)
      ) {
        throw new AppError(
          409,
          "targetBaseUrl already exists in another target.",
        );
      }
      activeGroup.targetBaseUrl = normalized;
    }

    this.syncConfigTargetBaseUrl();
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return this.proxyConfig;
  }

  createGroupEntry(payload: {
    name: string;
    targetBaseUrl: string;
    switchToNew?: boolean | undefined;
    upstreamTimeoutMs?: number | null | undefined;
    customHeaders?: unknown;
    headerRules?: unknown;
    headerPresetIds?: string[] | undefined;
    mockGroupIds?: string[] | undefined;
  }): { group: ProxyGroup; config: ProxyConfig } {
    const groupName = payload.name.trim();
    if (!groupName) {
      throw new AppError(400, "name is required.");
    }

    const normalizedTarget = normalizeTargetBaseUrl(payload.targetBaseUrl);
    if (!normalizedTarget) {
      throw new AppError(400, "targetBaseUrl must be a valid HTTP/HTTPS URL.");
    }
    if (this.hasTargetConflict(normalizedTarget)) {
      throw new AppError(409, "targetBaseUrl already exists in another target.");
    }

    const headers = parseHeadersConfig(payload, this.deps.randomUUID);
    if (headers.problems.length > 0) {
      throw new AppError(400, headers.problems.join(" "));
    }

    const nextGroup = createGroup(
      groupName,
      normalizedTarget,
      this.deps.randomUUID,
      normalizeTimeout(payload.upstreamTimeoutMs),
      headers,
    );
    nextGroup.headerPresetIds = this.filterPresetIds(payload.headerPresetIds);
    nextGroup.mockGroupIds = this.filterMockGroupIds(payload.mockGroupIds);
    this.proxyConfig.groups.push(nextGroup);
    this.ensureGroupHistory(nextGroup.id);

    // Creating a group must not silently move traffic: a brand new (possibly
    // misconfigured) target would start receiving proxied requests. Callers
    // switch explicitly via `switchToNew` or the group picker.
    if (payload.switchToNew === true) {
      this.proxyConfig.activeGroupId = nextGroup.id;
    }

    this.syncConfigTargetBaseUrl();
    this.saveConfig();
    this.saveHistory();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { group: nextGroup, config: this.proxyConfig };
  }

  updateGroupEntry(
    groupId: string,
    payload: {
      name?: string | undefined;
      targetBaseUrl?: string | undefined;
      makeActive?: boolean | undefined;
      upstreamTimeoutMs?: number | null | undefined;
      customHeaders?: unknown;
      headerRules?: unknown;
      headerPresetIds?: string[] | undefined;
      mockGroupIds?: string[] | undefined;
    },
  ): { group: ProxyGroup; config: ProxyConfig } {
    const group = this.findGroupById(groupId);
    if (!group) {
      throw new AppError(404, "target not found.");
    }

    const hasName = typeof payload.name === "string";
    const hasTarget = typeof payload.targetBaseUrl === "string";
    const hasActive = typeof payload.makeActive === "boolean";
    const hasTimeout = payload.upstreamTimeoutMs !== undefined;
    const hasHeaders =
      payload.customHeaders !== undefined || payload.headerRules !== undefined;
    const hasPresetIds = payload.headerPresetIds !== undefined;
    const hasMockGroupIds = payload.mockGroupIds !== undefined;
    if (
      !hasName &&
      !hasTarget &&
      !hasActive &&
      !hasTimeout &&
      !hasHeaders &&
      !hasPresetIds &&
      !hasMockGroupIds
    ) {
      throw new AppError(
        400,
        "name, targetBaseUrl, makeActive, upstreamTimeoutMs, headers or groups is required.",
      );
    }

    if (hasName) {
      const normalizedName = payload.name?.trim() ?? "";
      if (!normalizedName) {
        throw new AppError(400, "name cannot be empty.");
      }
      group.name = normalizedName;
    }

    if (hasTarget) {
      const normalizedTarget = normalizeTargetBaseUrl(
        payload.targetBaseUrl ?? "",
      );
      if (!normalizedTarget) {
        throw new AppError(400, "targetBaseUrl must be a valid HTTP/HTTPS URL.");
      }
      if (
        normalizedTarget !== group.targetBaseUrl &&
        this.hasTargetConflict(normalizedTarget, group.id)
      ) {
        throw new AppError(
          409,
          "targetBaseUrl already exists in another target.",
        );
      }
      group.targetBaseUrl = normalizedTarget;
    }

    if (hasTimeout) {
      group.upstreamTimeoutMs = normalizeTimeout(payload.upstreamTimeoutMs);
    }

    if (hasHeaders) {
      const headers = parseHeadersConfig(payload, this.deps.randomUUID);
      if (headers.problems.length > 0) {
        throw new AppError(400, headers.problems.join(" "));
      }
      // Replace only the list the caller actually sent: the dashboard saves
      // both together, but one list must never be wiped by a partial update.
      if (payload.customHeaders !== undefined) {
        group.customHeaders = headers.customHeaders;
      }
      if (payload.headerRules !== undefined) {
        group.headerRules = headers.headerRules;
      }
    }

    // Unknown ids are dropped rather than rejected: a preset deleted in another
    // tab must not make saving the target fail.
    if (hasPresetIds) {
      group.headerPresetIds = this.filterPresetIds(payload.headerPresetIds);
    }
    if (hasMockGroupIds) {
      group.mockGroupIds = this.filterMockGroupIds(payload.mockGroupIds);
    }

    if (payload.makeActive) {
      this.proxyConfig.activeGroupId = group.id;
    }

    this.syncConfigTargetBaseUrl();
    this.saveConfig();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    return { group, config: this.proxyConfig };
  }

  deleteGroupEntry(groupId: string): {
    removed: true;
    id: string;
    clearedRecords: number;
    config: ProxyConfig;
  } {
    const groupIndex = this.proxyConfig.groups.findIndex(
      (group) => group.id === groupId,
    );
    if (groupIndex === -1) {
      throw new AppError(404, "target not found.");
    }

    const removedHistory = this.historyByGroup.get(groupId) ?? [];
    const clearedRecords = removedHistory.length;
    this.proxyConfig.groups.splice(groupIndex, 1);
    this.historyByGroup.delete(groupId);
    this.rulesByGroup.delete(groupId);

    if (this.proxyConfig.groups.length === 0) {
      const fallbackTarget =
        normalizeTargetBaseUrl(this.deps.config.defaultTargetBaseUrl) ??
        "http://localhost:8080";
      const fallbackGroup = createGroup(
        "默认转发地址",
        fallbackTarget,
        this.deps.randomUUID,
      );
      this.proxyConfig.groups = [fallbackGroup];
      this.historyByGroup.set(fallbackGroup.id, []);
    }

    if (this.proxyConfig.activeGroupId === groupId) {
      this.proxyConfig.activeGroupId = this.proxyConfig.groups[0]?.id ?? "";
    }

    this.syncConfigTargetBaseUrl();
    this.saveConfig();
    this.saveHistory();
    // 规则也要落盘：否则 rules.json 里仍留着已删分组的 mock（含响应体与内部 URL），
    // 重启后又会复活。
    this.saveRules();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });

    return {
      removed: true,
      id: groupId,
      clearedRecords,
      config: this.proxyConfig,
    };
  }

  resetAll(): {
    ok: true;
    clearedGroups: number;
    clearedRecords: number;
    config: ProxyConfig;
  } {
    const currentActiveGroup = this.ensureActiveGroup();
    const fallbackTarget =
      currentActiveGroup?.targetBaseUrl ??
      (normalizeTargetBaseUrl(this.deps.config.defaultTargetBaseUrl) ??
        "http://localhost:8080");

    const previousGroupCount = this.proxyConfig.groups.length;
    const previousRecordCount = this.listGroupHistorySize();

    const nextDefaultGroup = createGroup(
      "默认转发地址",
      fallbackTarget,
      this.deps.randomUUID,
    );
    this.proxyConfig.groups = [nextDefaultGroup];
    this.proxyConfig.activeGroupId = nextDefaultGroup.id;
    // 分组是全局的，重置必须一起清掉，否则「清空所有数据」会留下一堆预设。
    this.proxyConfig.headerPresets = [];
    this.proxyConfig.mockGroups = [];
    this.syncConfigTargetBaseUrl();

    this.historyByGroup.clear();
    this.historyByGroup.set(nextDefaultGroup.id, []);
    this.rulesByGroup.clear();
    this.rulesByGroup.set(nextDefaultGroup.id, []);

    this.saveConfig();
    this.saveHistory();
    // 同上：reset 必须把 rules.json 一起清空，否则旧规则会在重启后复活。
    this.saveRules();
    this.broadcastEvent({ type: "config", config: this.proxyConfig });
    this.broadcastEvent({
      type: "records_cleared",
      groupId: nextDefaultGroup.id,
    });

    return {
      ok: true,
      clearedGroups: previousGroupCount,
      clearedRecords: previousRecordCount,
      config: this.proxyConfig,
    };
  }

  listRecords(query: RecordsQuery): ProxyRecordsResponse {
    const group = this.resolveGroupOrActive(query.groupId);
    if (!group) {
      throw new AppError(404, "groupId not found.");
    }

    const filtered = filterRecords(this.ensureGroupHistory(group.id), query);
    return {
      groupId: group.id,
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
    };
  }

  exportRecords(query: ExportRecordsQuery): ProxyRecordsExportResponse {
    const group = this.resolveGroupOrActive(query.groupId);
    if (!group) {
      throw new AppError(404, "groupId not found.");
    }

    const items = filterRecords(this.ensureGroupHistory(group.id), query);
    return {
      exportedAt: new Date(this.deps.now()).toISOString(),
      groupId: group.id,
      groupName: normalizeGroupName(group.name, 1),
      total: items.length,
      items,
    };
  }

  buildExportHeaders(payload: ProxyRecordsExportResponse): Headers {
    const fileToken = payload.exportedAt.replace(/[:.]/g, "-");
    const groupToken =
      payload.groupName
        .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "group";
    const asciiGroupToken = toSafeAsciiToken(payload.groupName) || "group";
    const utf8FileName = `proxira-${groupToken}-records-${fileToken}.json`;
    const asciiFileName = `proxira-${asciiGroupToken}-records-${fileToken}.json`;

    return new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeFilenameRFC5987(utf8FileName)}`,
    });
  }

  getRecord(groupId: string | undefined, id: string): ProxyRecordDetailResponse {
    const group = this.resolveGroupOrActive(groupId);
    if (!group) {
      throw new AppError(404, "groupId not found.");
    }
    const record =
      this.ensureGroupHistory(group.id).find((item) => item.id === id) ?? null;
    return { item: record };
  }

  deleteRecord(groupId: string | undefined, recordId: string): {
    removed: boolean;
    id: string;
  } {
    const group = this.resolveGroupOrActive(groupId);
    if (!group) {
      throw new AppError(404, "groupId not found.");
    }

    const groupHistory = this.ensureGroupHistory(group.id);
    const targetIndex = groupHistory.findIndex((item) => item.id === recordId);
    if (targetIndex === -1) {
      return { removed: false, id: recordId };
    }

    groupHistory.splice(targetIndex, 1);
    this.saveHistory();
    this.broadcastEvent({ type: "record_deleted", groupId: group.id, id: recordId });
    return { removed: true, id: recordId };
  }

  clearRecords(groupId: string | undefined): { cleared: number } {
    const group = this.resolveGroupOrActive(groupId);
    if (!group) {
      throw new AppError(404, "groupId not found.");
    }

    const groupHistory = this.ensureGroupHistory(group.id);
    const removed = groupHistory.length;
    groupHistory.length = 0;
    this.saveHistory();
    this.broadcastEvent({ type: "records_cleared", groupId: group.id });
    return { cleared: removed };
  }

  getProxyGroup(): ProxyGroup {
    const activeGroup = this.ensureActiveGroup();
    if (!activeGroup) {
      throw new AppError(500, "No active group configured.");
    }
    return activeGroup;
  }

  addProxyRecord(groupId: string, record: ProxyTrafficRecord): void {
    const groupHistory = this.ensureGroupHistory(groupId);
    const nextRecordId = ensureUniqueRecordId(
      groupHistory,
      record.id,
      this.deps.randomUUID,
    );
    const nextRecord =
      nextRecordId === record.id ? record : { ...record, id: nextRecordId };

    groupHistory.unshift(nextRecord);
    this.broadcastEvent({ type: "record", groupId, record: nextRecord });

    while (groupHistory.length > this.deps.config.historyLimit) {
      const removed = groupHistory.pop();
      if (removed) {
        this.broadcastEvent({
          type: "record_deleted",
          groupId,
          id: removed.id,
        });
      }
    }

    this.saveHistory();
  }

  // Streaming responses are recorded with a null body first (the client stream
  // must start immediately) and patched once background sampling finishes.
  updateProxyRecordBody(
    groupId: string,
    recordId: string,
    responseBody: ProxyPayloadBody,
  ): void {
    const groupHistory = this.historyByGroup.get(groupId);
    if (!groupHistory) {
      return;
    }
    const index = groupHistory.findIndex((record) => record.id === recordId);
    const existing = index === -1 ? undefined : groupHistory[index];
    if (!existing) {
      return;
    }
    const updated: ProxyTrafficRecord = { ...existing, responseBody };
    groupHistory[index] = updated;
    this.broadcastEvent({ type: "record", groupId, record: updated });
    this.saveHistory();
  }

  createEventsResponse(signal: AbortSignal): Response {
    const clientId = this.deps.randomUUID();
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(
              this.sendEventChunk({
                type: "heartbeat",
                at: new Date(this.deps.now()).toISOString(),
              }),
            );
          } catch {
            this.removeSseClient(clientId);
          }
        }, this.deps.config.sseHeartbeatMs);

        this.sseClients.set(clientId, {
          id: clientId,
          controller,
          heartbeatTimer,
        });
        controller.enqueue(
          this.sendEventChunk({ type: "snapshot", config: this.proxyConfig }),
        );
      },
      cancel: () => {
        this.removeSseClient(clientId);
      },
    });

    signal.addEventListener("abort", () => {
      this.removeSseClient(clientId);
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  private findGroupById(groupId: string): ProxyGroup | undefined {
    return this.proxyConfig.groups.find((group) => group.id === groupId);
  }

  private filterPresetIds(raw: string[] | undefined): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const kept = raw.filter(
      (id, index) =>
        typeof id === "string" &&
        id.trim().length > 0 &&
        raw.indexOf(id) === index &&
        this.proxyConfig.headerPresets.some((preset) => preset.id === id),
    );
    // 存成全局列表顺序：面板读到什么顺序，语义就是什么顺序。
    return this.proxyConfig.headerPresets
      .map((preset) => preset.id)
      .filter((id) => kept.includes(id));
  }

  private filterMockGroupIds(raw: string[] | undefined): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const kept = raw.filter(
      (id, index) =>
        typeof id === "string" &&
        id.trim().length > 0 &&
        raw.indexOf(id) === index &&
        this.proxyConfig.mockGroups.some((group) => group.id === id),
    );
    return this.proxyConfig.mockGroups
      .map((group) => group.id)
      .filter((id) => kept.includes(id));
  }

  /** Drops references to groups that no longer exist (deleted elsewhere, or a
   *  hand-edited config.json). Cheap, and keeps the target form honest. */
  private pruneMissingGroupRefs(): void {
    for (const group of this.proxyConfig.groups) {
      group.headerPresetIds = this.filterPresetIds(group.headerPresetIds);
      group.mockGroupIds = this.filterMockGroupIds(group.mockGroupIds);
    }
  }

  private syncConfigTargetBaseUrl(): void {
    const activeGroup = this.findGroupById(this.proxyConfig.activeGroupId) ?? null;
    this.proxyConfig.targetBaseUrl = activeGroup?.targetBaseUrl ?? "";
  }

  private ensureActiveGroup(): ProxyGroup | null {
    const currentActive = this.findGroupById(this.proxyConfig.activeGroupId);
    if (currentActive) {
      return currentActive;
    }

    const fallback = this.proxyConfig.groups[0] ?? null;
    if (!fallback) {
      this.proxyConfig.activeGroupId = "";
      this.proxyConfig.targetBaseUrl = "";
      return null;
    }

    this.proxyConfig.activeGroupId = fallback.id;
    this.proxyConfig.targetBaseUrl = fallback.targetBaseUrl;
    return fallback;
  }

  private resolveGroupOrActive(groupIdRaw: string | undefined): ProxyGroup | null {
    if (groupIdRaw) {
      return this.findGroupById(groupIdRaw) ?? null;
    }
    return this.ensureActiveGroup();
  }

  private hasTargetConflict(targetBaseUrl: string, ignoreGroupId?: string): boolean {
    return this.proxyConfig.groups.some((group) => {
      if (ignoreGroupId && group.id === ignoreGroupId) {
        return false;
      }
      return group.targetBaseUrl === targetBaseUrl;
    });
  }

  private ensureGroupHistory(groupId: string): ProxyTrafficRecord[] {
    const existing = this.historyByGroup.get(groupId);
    if (existing) {
      return existing;
    }

    const created: ProxyTrafficRecord[] = [];
    this.historyByGroup.set(groupId, created);
    return created;
  }

  private listGroupHistorySize(): number {
    let total = 0;
    for (const items of this.historyByGroup.values()) {
      total += items.length;
    }
    return total;
  }

  private hydrateGroupHistory(
    fileHistory: Partial<Record<string, unknown>> | null,
    group: ProxyGroup,
  ): ProxyTrafficRecord[] {
    const rawItems = fileHistory?.[group.id];
    if (!Array.isArray(rawItems)) {
      return [];
    }

    const nextItems: ProxyTrafficRecord[] = [];
    const usedRecordIds = new Set<string>();
    for (const rawItem of rawItems) {
      const normalized = normalizeRecord(rawItem, group.id);
      if (normalized) {
        let uniqueId = normalized.id;
        while (usedRecordIds.has(uniqueId)) {
          uniqueId = this.deps.randomUUID();
        }
        usedRecordIds.add(uniqueId);
        nextItems.push(
          uniqueId === normalized.id ? normalized : { ...normalized, id: uniqueId },
        );
      }
      if (nextItems.length >= this.deps.config.historyLimit) {
        break;
      }
    }

    return nextItems;
  }

  private sendEventChunk(event: ProxySseEvent): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  }

  private removeSseClient(clientId: string): void {
    const client = this.sseClients.get(clientId);
    if (!client) {
      return;
    }

    clearInterval(client.heartbeatTimer);
    this.sseClients.delete(clientId);
    try {
      client.controller.close();
    } catch {
      // Stream may already be closed by client.
    }
  }

  private broadcastEvent(event: ProxySseEvent): void {
    const chunk = this.sendEventChunk(event);
    for (const [clientId, client] of this.sseClients) {
      try {
        client.controller.enqueue(chunk);
      } catch {
        this.removeSseClient(clientId);
      }
    }
  }

  private enqueuePersist(kind: PersistKind, task: () => Promise<void>): void {
    // Latest state wins: the task reads live data when it finally runs, so
    // bursts of requests collapse into one write instead of one write each.
    this.pendingPersist.set(kind, task);
    if (this.persistTimer !== null) {
      return;
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushPersist();
    }, this.deps.config.persistDebounceMs);
  }

  async flushPersist(): Promise<void> {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.pendingPersist.size === 0) {
      return;
    }

    const tasks = [...this.pendingPersist.values()];
    this.pendingPersist.clear();
    for (const task of tasks) {
      this.persistQueue = this.persistQueue.then(task).catch((error) => {
        this.deps.logger.error(
          "[persist]",
          error instanceof Error ? error.message : error,
        );
      });
    }
    await this.persistQueue;
  }

  private serializeHistory(): HistoryFilePayload {
    const payload: HistoryFilePayload = {};
    for (const group of this.proxyConfig.groups) {
      payload[group.id] = this.ensureGroupHistory(group.id)
        .slice(0, this.deps.config.effectiveHistoryPersistLimit)
        .map((record) => shrinkRecordForPersist(record, this.deps.config));
    }
    return payload;
  }

  private saveConfig(): void {
    this.enqueuePersist("config", async () => {
      await saveJsonFile(
        this.deps.fs,
        this.deps.config.configFile,
        this.proxyConfig,
      );
    });
  }

  private saveHistory(): void {
    this.enqueuePersist("history", async () => {
      await saveJsonFile(
        this.deps.fs,
        this.deps.config.historyFile,
        this.serializeHistory(),
      );
    });
  }
}
