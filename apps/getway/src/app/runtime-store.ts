import type {
  ProxyConfig,
  ProxyGroup,
  ProxyRecordDetailResponse,
  ProxyRecordsExportResponse,
  ProxyRecordsResponse,
  ProxySseEvent,
  ProxyTrafficRecord,
} from "@proxira/core";
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
import { createGroup, normalizeGroupName, normalizeTargetBaseUrl } from "../groups/utils.js";

type SseClient = {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeatTimer: ReturnType<typeof setInterval>;
};

type HistoryFilePayload = Record<string, ProxyTrafficRecord[]>;

const encoder = new TextEncoder();

export class RuntimeStore {
  private readonly deps: RuntimeDeps;
  private readonly proxyConfig: ProxyConfig;
  private readonly historyByGroup = new Map<string, ProxyTrafficRecord[]>();
  private readonly sseClients = new Map<string, SseClient>();
  private persistQueue = Promise.resolve();

  constructor(deps: RuntimeDeps) {
    this.deps = deps;
    this.proxyConfig = {
      activeGroupId: "",
      groups: [],
      targetBaseUrl: deps.config.defaultTargetBaseUrl,
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

        hydratedGroups.push({
          id: groupId,
          name: normalizeGroupName(group.name ?? "", hydratedGroups.length + 1),
          targetBaseUrl: normalizedTarget,
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
          "默认分组",
          legacyTarget ?? normalizedDefaultTarget,
          this.deps.randomUUID,
        ),
      );
    }

    this.proxyConfig.groups = hydratedGroups;
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
          "targetBaseUrl already exists in another group.",
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
      throw new AppError(409, "targetBaseUrl already exists in another group.");
    }

    const nextGroup = createGroup(
      groupName,
      normalizedTarget,
      this.deps.randomUUID,
    );
    this.proxyConfig.groups.push(nextGroup);
    this.ensureGroupHistory(nextGroup.id);

    if (payload.switchToNew ?? true) {
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
    },
  ): { group: ProxyGroup; config: ProxyConfig } {
    const group = this.findGroupById(groupId);
    if (!group) {
      throw new AppError(404, "group not found.");
    }

    const hasName = typeof payload.name === "string";
    const hasTarget = typeof payload.targetBaseUrl === "string";
    const hasActive = typeof payload.makeActive === "boolean";
    if (!hasName && !hasTarget && !hasActive) {
      throw new AppError(
        400,
        "name, targetBaseUrl or makeActive is required.",
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
          "targetBaseUrl already exists in another group.",
        );
      }
      group.targetBaseUrl = normalizedTarget;
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
      throw new AppError(404, "group not found.");
    }

    const removedHistory = this.historyByGroup.get(groupId) ?? [];
    const clearedRecords = removedHistory.length;
    this.proxyConfig.groups.splice(groupIndex, 1);
    this.historyByGroup.delete(groupId);

    if (this.proxyConfig.groups.length === 0) {
      const fallbackTarget =
        normalizeTargetBaseUrl(this.deps.config.defaultTargetBaseUrl) ??
        "http://localhost:8080";
      const fallbackGroup = createGroup(
        "默认分组",
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
      "默认分组",
      fallbackTarget,
      this.deps.randomUUID,
    );
    this.proxyConfig.groups = [nextDefaultGroup];
    this.proxyConfig.activeGroupId = nextDefaultGroup.id;
    this.syncConfigTargetBaseUrl();

    this.historyByGroup.clear();
    this.historyByGroup.set(nextDefaultGroup.id, []);

    this.saveConfig();
    this.saveHistory();
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

    return {
      exportedAt: new Date(this.deps.now()).toISOString(),
      groupId: group.id,
      groupName: normalizeGroupName(group.name, 1),
      total: filterRecords(this.ensureGroupHistory(group.id), query).length,
      items: filterRecords(this.ensureGroupHistory(group.id), query),
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

  private enqueuePersist(task: () => Promise<void>): void {
    this.persistQueue = this.persistQueue.then(task).catch((error) => {
      this.deps.logger.error(
        "[persist]",
        error instanceof Error ? error.message : error,
      );
    });
  }

  private serializeHistory(): HistoryFilePayload {
    const payload: HistoryFilePayload = {};
    for (const group of this.proxyConfig.groups) {
      payload[group.id] = this.ensureGroupHistory(group.id).slice(
        0,
        this.deps.config.effectiveHistoryPersistLimit,
      );
    }
    return payload;
  }

  private saveConfig(): void {
    this.enqueuePersist(async () => {
      await saveJsonFile(
        this.deps.fs,
        this.deps.config.configFile,
        this.proxyConfig,
      );
    });
  }

  private saveHistory(): void {
    this.enqueuePersist(async () => {
      await saveJsonFile(
        this.deps.fs,
        this.deps.config.historyFile,
        this.serializeHistory(),
      );
    });
  }
}
