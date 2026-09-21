import { create } from "zustand";
import type {
  ProxyConfig,
  ProxyGroup,
  ProxyHeaderEntry,
  ProxyHeaderPreset,
  ProxyHeaderRule,
  ProxyMockGroup,
  ProxyMockRule,
  ProxyRecordsResponse,
  ProxyRule,
  ProxyServerStatus,
  ProxySseEvent,
  ProxyTrafficRecord,
} from "@proxira/core";
import { apiFetch, apiUrl, extractErrorMessage } from "../lib/api";
import { normalizeExportPayload } from "../lib/body";
import { normalizeTargetInput } from "../lib/filters";
import { toPrettyJson } from "../lib/format";
import { toast } from "./toast";

export type ConnectionState = "connecting" | "open" | "closed";

export type ReplayResult = {
  ok: boolean;
  status: number | null;
  durationMs: number;
  headers: Record<string, string>;
  body: string | null;
  recordId: string | null;
  error: string | null;
};

type ProxiraState = {
  targets: ProxyGroup[];
  activeTargetId: string;
  /** 全局请求头分组（可被多个转发地址引用）。 */
  headerPresets: ProxyHeaderPreset[];
  /** 全局 Mock 拦截分组。 */
  mockGroups: ProxyMockGroup[];
  records: ProxyTrafficRecord[];
  recordsTotal: number;
  recordsLoadingMore: boolean;
  selectedRecordId: string | null;
  /**
   * 「新请求提示」的水位线：**这个 id 及其之前的记录都算已看到**。
   *
   * 未读条数是派生的：`records` 里排在水位线之前的条数就是新增数
   * （见 NewRecordNotice）。它和「当前选中哪一条」**无关** —— 这一点很关键，
   * 早期版本按「选中的是不是最新」来推导，结果看旧记录就冒泡、看新记录就没泡、
   * 切回旧记录泡又回来了，像是跟着选中项走。
   */
  newestSeenId: string | null;
  /**
   * 提示条出现的时间戳（ms）；`null` = 当前不显示。
   *
   * 单独存一个时间戳，是为了让提示有**自己的生命周期**：出现后由组件计时自动收起，
   * 而不是一直挂在屏幕上等用户点 X。持续有流量时不重置它，
   * 否则提示会被无限续命，等于「一直存在」。
   */
  noticeShownAt: number | null;
  connectionState: ConnectionState;
  rules: ProxyRule[];
  deletingRecordId: string | null;
  exporting: boolean;
  clearingRecords: boolean;
  resettingAll: boolean;
  targetModalSubmitting: boolean;
  deleteTargetSubmitting: boolean;
  replaying: boolean;
  initialized: boolean;
  /** 服务端状态（/status），目前只为设置面板提供 dataDir。 */
  serverStatus: ProxyServerStatus | null;
  fetchingStatus: boolean;
  /** 设置面板是否打开。 */
  settingsOpen: boolean;

  bootstrap: () => Promise<void>;
  connectSse: () => void;
  disconnectSse: () => void;

  fetchRecords: () => Promise<void>;
  loadMoreRecords: () => Promise<void>;
  fetchRules: () => Promise<void>;
  saveRule: (input: Record<string, unknown>, ruleId?: string) => Promise<boolean>;
  removeRule: (ruleId: string) => Promise<void>;
  toggleRule: (rule: ProxyRule) => Promise<boolean>;

  switchActiveTarget: (targetId: string) => Promise<void>;
  createTarget: (
    name: string,
    targetBaseUrl: string,
    upstreamTimeoutMs: number | null,
    groups?: { headerPresetIds?: string[]; mockGroupIds?: string[] },
  ) => Promise<boolean>;
  saveActiveTarget: (
    name: string,
    targetBaseUrl: string,
    upstreamTimeoutMs: number | null,
    groups?: { headerPresetIds?: string[]; mockGroupIds?: string[] },
  ) => Promise<boolean>;
  deleteTarget: (target: ProxyGroup) => Promise<boolean>;

  /** 返回新建分组的 id，便于面板立刻选中它；失败返回 null。 */
  createHeaderPreset: (name: string) => Promise<string | null>;
  saveHeaderPreset: (
    presetId: string,
    payload: {
      name?: string;
      customHeaders?: ProxyHeaderEntry[];
      headerRules?: ProxyHeaderRule[];
    },
  ) => Promise<boolean>;
  removeHeaderPreset: (presetId: string) => Promise<void>;
  moveHeaderPreset: (presetId: string, direction: "up" | "down") => Promise<void>;

  /** 返回新建分组的 id，便于面板立刻选中它；失败返回 null。 */
  createMockGroup: (name: string) => Promise<string | null>;
  saveMockGroup: (
    groupId: string,
    payload: { name?: string; enabled?: boolean; rules?: ProxyMockRule[] },
  ) => Promise<boolean>;
  removeMockGroup: (groupId: string) => Promise<void>;
  moveMockGroup: (groupId: string, direction: "up" | "down") => Promise<void>;

  selectRecord: (recordId: string | null) => void;
  /**
   * 收起新请求提示：把水位线推到当前最新一条，并清掉计时。
   * 点 X、点「查看最新」、计时到点都走这里。
   */
  hideNewRecords: () => void;
  removeRecord: (recordId: string) => Promise<void>;
  exportRecords: (filters: { method: string; status: string }) => Promise<void>;
  clearRecords: () => Promise<void>;
  resetAll: () => Promise<boolean>;
  replayRecord: (payload: {
    recordId?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
    useCustomHeaders?: boolean;
  }) => Promise<ReplayResult | null>;

  fetchServerStatus: () => Promise<void>;
  openDataFolder: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
};

// 当前生效的转发地址：没显式选中就回落到第一个。
export const selectCurrentTargetId = (state: ProxiraState): string => {
  if (state.activeTargetId && state.targets.some((t) => t.id === state.activeTargetId)) {
    return state.activeTargetId;
  }
  return state.targets[0]?.id ?? "";
};

export const selectActiveTarget = (state: ProxiraState): ProxyGroup | null =>
  state.targets.find((t) => t.id === selectCurrentTargetId(state)) ?? state.targets[0] ?? null;

const withTargetQuery = (path: string, groupId: string): string => {
  if (!groupId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}groupId=${encodeURIComponent(groupId)}`;
};

let eventSource: EventSource | null = null;

/**
 * 记录列表被整体清空时的状态。提示相关的水位线 / 计时必须一起归零，
 * 否则清空后水位线指向一条已经不存在的记录，未读数永远算成 0。
 */
const emptyRecordsState = (): Pick<
  ProxiraState,
  | "records"
  | "recordsTotal"
  | "selectedRecordId"
  | "newestSeenId"
  | "noticeShownAt"
> => ({
  records: [],
  recordsTotal: 0,
  selectedRecordId: null,
  newestSeenId: null,
  noticeShownAt: null,
});

export const useProxiraStore = create<ProxiraState>((set, get) => {
  const syncConfig = (config: ProxyConfig): void => {
    const matched =
      config.groups.find((entry) => entry.id === config.activeGroupId) ??
      config.groups[0] ??
      null;
    set({
      targets: config.groups,
      activeTargetId: matched?.id ?? "",
      headerPresets: config.headerPresets ?? [],
      mockGroups: config.mockGroups ?? [],
    });
  };

  const fetchConfig = async (): Promise<void> => {
    const response = await apiFetch("/_proxira/api/config");
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "服务已启用访问令牌：请在面板地址后追加 ?token=你的令牌 后重新打开"
          : "加载配置失败",
      );
    }
    syncConfig((await response.json()) as ProxyConfig);
  };

  const fetchRecords = async (): Promise<void> => {
    const groupId = selectCurrentTargetId(get());
    if (!groupId) {
      set(emptyRecordsState());
      return;
    }

    const response = await apiFetch(withTargetQuery("/_proxira/api/records?limit=500", groupId));
    if (!response.ok) throw new Error("加载历史记录失败");

    const payload = (await response.json()) as ProxyRecordsResponse;
    set((state) => {
      // 整体换列表（切换转发地址 / 重连重拉）后水位线可能已经不在列表里，
      // 这时顺手归位到最新一条，否则整个历史都会被算成「新请求」。
      const seenStillThere =
        state.newestSeenId !== null && payload.items.some((item) => item.id === state.newestSeenId);
      return {
        records: payload.items,
        recordsTotal: payload.total,
        newestSeenId: seenStillThere ? state.newestSeenId : (payload.items[0]?.id ?? null),
        noticeShownAt: seenStillThere ? state.noticeShownAt : null,
      };
    });

    if (payload.items.length === 0) {
      set({ selectedRecordId: null });
      return;
    }
    const stillExists = payload.items.some((item) => item.id === get().selectedRecordId);
    if (!stillExists) set({ selectedRecordId: payload.items[0]?.id ?? null });
  };

  const loadMoreRecords = async (): Promise<void> => {
    const state = get();
    const groupId = selectCurrentTargetId(state);
    if (!groupId || state.recordsLoadingMore) return;
    if (state.records.length >= state.recordsTotal) return;

    set({ recordsLoadingMore: true });
    try {
      const response = await apiFetch(
        withTargetQuery(
          `/_proxira/api/records?limit=500&offset=${state.records.length}`,
          groupId,
        ),
      );
      if (!response.ok) throw new Error("加载更多记录失败");
      const payload = (await response.json()) as ProxyRecordsResponse;
      const known = new Set(state.records.map((item) => item.id));
      set({
        records: [...state.records, ...payload.items.filter((item) => !known.has(item.id))],
        recordsTotal: payload.total,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载更多记录失败");
    } finally {
      set({ recordsLoadingMore: false });
    }
  };

  const fetchRules = async (): Promise<void> => {
    const groupId = selectCurrentTargetId(get());
    if (!groupId) {
      set({ rules: [] });
      return;
    }
    const response = await apiFetch(withTargetQuery("/_proxira/api/rules", groupId));
    if (!response.ok) throw new Error("加载规则失败");
    set({ rules: ((await response.json()) as { items: ProxyRule[] }).items });
  };

  const applySseEvent = (event: ProxySseEvent): void => {
    if (event.type === "snapshot" || event.type === "config") {
      const previous = selectCurrentTargetId(get());
      syncConfig(event.config);
      if (previous !== selectCurrentTargetId(get())) {
        void fetchRecords().catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "加载历史记录失败");
        });
      }
      return;
    }

    const groupId = selectCurrentTargetId(get());

    if (event.type === "record") {
      if (event.groupId !== groupId) return;
      set((state) => {
        const index = state.records.findIndex((item) => item.id === event.record.id);
        // 同一条重播（流式响应体补全后）直接替换，不要留下重复项。
        if (index !== -1) {
          const next = state.records.slice();
          next[index] = event.record;
          return { records: next };
        }
        // 刻意**不**自动把选中挪到新记录。
        //
        // 试过自动跟随，结果是：用户只要没主动点过旧记录，就一直停在最新，
        // 「有没有更新」永远是 false，新请求提示一辈子不出现 —— 而盯着面板看
        // 新请求恰恰是最典型的用法。新请求的呈现方式是「底部浮出一条提示，
        // 点它才跳」，所以这里必须让选中留在原地，让「有新请求」这件事可见。
        //
        // 提示的计时只在**首次**出现时打点（?? 而不是 =）：持续有流量时若不断重置，
        // 提示就永远收不起来，又变成「一直存在」。
        const watchingLatest =
          state.selectedRecordId === null || state.selectedRecordId === event.record.id;
        return {
          records: [event.record, ...state.records],
          recordsTotal: state.recordsTotal + 1,
          // 列表本来是空的（或刚被清空）时，第一条自动选中，省得对着空详情发呆。
          selectedRecordId: state.selectedRecordId ?? event.record.id,
          noticeShownAt: watchingLatest ? state.noticeShownAt : (state.noticeShownAt ?? Date.now()),
        };
      });
      return;
    }

    if (event.type === "record_deleted") {
      if (event.groupId !== groupId) return;
      set((state) => {
        const records = state.records.filter((item) => item.id !== event.id);
        // 水位线那条被删掉后就找不到锚点了，重新钉到当前最新一条，
        // 否则未读数会一直算成 0，提示再也不出现。
        const watermarkGone = state.newestSeenId === event.id;
        return {
          records,
          recordsTotal: Math.max(0, state.recordsTotal - 1),
          selectedRecordId: state.selectedRecordId === event.id ? null : state.selectedRecordId,
          ...(watermarkGone
            ? { newestSeenId: records[0]?.id ?? null, noticeShownAt: null }
            : {}),
        };
      });
      return;
    }

    if (event.type === "records_cleared") {
      if (event.groupId !== groupId) return;
      set(emptyRecordsState());
    }
  };

  const connectSse = (): void => {
    eventSource?.close();
    set({ connectionState: "connecting" });

    eventSource = new EventSource(apiUrl("/_proxira/api/events"));
    eventSource.onopen = () => set({ connectionState: "open" });
    eventSource.onerror = () => set({ connectionState: "closed" });
    eventSource.onmessage = (raw) => {
      try {
        applySseEvent(JSON.parse(raw.data) as ProxySseEvent);
      } catch {
        // 坏帧直接忽略，不影响面板。
      }
    };
  };

  return {
    targets: [],
    activeTargetId: "",
    headerPresets: [],
    mockGroups: [],
    records: [],
    recordsTotal: 0,
    recordsLoadingMore: false,
    selectedRecordId: null,
    newestSeenId: null,
    noticeShownAt: null,
    connectionState: "connecting",
    rules: [],
    deletingRecordId: null,
    exporting: false,
    clearingRecords: false,
    resettingAll: false,
    targetModalSubmitting: false,
    deleteTargetSubmitting: false,
    replaying: false,
    initialized: false,
    serverStatus: null,
    fetchingStatus: false,
    settingsOpen: false,

    bootstrap: async () => {
      try {
        await fetchConfig();
        await fetchRecords();
        await fetchRules();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "初始化失败");
      } finally {
        set({ initialized: true });
      }
      connectSse();
    },

    connectSse,
    disconnectSse: () => {
      eventSource?.close();
      eventSource = null;
    },

    fetchRecords,
    loadMoreRecords,
    fetchRules,

    saveRule: async (input, ruleId) => {
      try {
        const response = await apiFetch(
          ruleId
            ? `/_proxira/api/rules/${encodeURIComponent(ruleId)}`
            : withTargetQuery("/_proxira/api/rules", selectCurrentTargetId(get())),
          {
            method: ruleId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        if (!response.ok) throw new Error(await extractErrorMessage(response, "保存规则失败"));
        await fetchRules();
        toast.success(ruleId ? "规则已更新" : "规则已创建");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存规则失败");
        return false;
      }
    },

    removeRule: async (ruleId) => {
      try {
        const response = await apiFetch(`/_proxira/api/rules/${encodeURIComponent(ruleId)}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(await extractErrorMessage(response, "删除规则失败"));
        set((state) => ({ rules: state.rules.filter((rule) => rule.id !== ruleId) }));
        toast.success("规则已删除");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除规则失败");
      }
    },

    toggleRule: async (rule) => get().saveRule({ enabled: !rule.enabled }, rule.id),

    switchActiveTarget: async (targetId) => {
      const state = get();
      if (!targetId || targetId === selectCurrentTargetId(state)) return;
      try {
        const response = await apiFetch("/_proxira/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // wire 契约：请求体键保持 activeGroupId，别改成 activeTargetId。
          body: JSON.stringify({ activeGroupId: targetId }),
        });
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "切换转发地址失败"));
        }
        syncConfig((await response.json()) as ProxyConfig);
        set({ selectedRecordId: null });
        await fetchRecords();
        await fetchRules();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "切换转发地址失败");
      }
    },

    createTarget: async (name, targetBaseUrl, upstreamTimeoutMs, groups) => {
      const nextName = name.trim();
      if (!nextName) {
        toast.error("名称为必填项");
        return false;
      }
      const normalized = normalizeTargetInput(targetBaseUrl);
      if (!normalized) {
        toast.error("转发地址为必填项，且必须是 http/https URL");
        return false;
      }
      if (get().targets.some((entry) => entry.targetBaseUrl === normalized)) {
        toast.error("转发地址不能与已有地址重复");
        return false;
      }

      set({ targetModalSubmitting: true });
      try {
        const response = await apiFetch("/_proxira/api/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nextName,
            targetBaseUrl: normalized,
            // 创建绝不劫持线上流量：不自动切换。
            switchToNew: false,
            upstreamTimeoutMs,
            ...groups,
          }),
        });
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "创建转发地址失败，请检查地址格式"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
        await fetchRecords();
        toast.success("转发地址已创建，需要时可在顶部下拉中切换");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "创建转发地址失败");
        return false;
      } finally {
        set({ targetModalSubmitting: false });
      }
    },

    saveActiveTarget: async (name, targetBaseUrl, upstreamTimeoutMs, groups) => {
      const groupId = selectCurrentTargetId(get());
      if (!groupId) {
        toast.error("当前没有可用转发地址");
        return false;
      }
      const nextName = name.trim();
      if (!nextName) {
        toast.error("名称为必填项");
        return false;
      }
      const normalized = normalizeTargetInput(targetBaseUrl);
      if (!normalized) {
        toast.error("转发地址必须是有效的 http/https URL");
        return false;
      }
      if (
        get().targets.some((entry) => entry.targetBaseUrl === normalized && entry.id !== groupId)
      ) {
        toast.error("转发地址不能与其他地址重复");
        return false;
      }

      set({ targetModalSubmitting: true });
      try {
        const response = await apiFetch(`/_proxira/api/groups/${encodeURIComponent(groupId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nextName,
            targetBaseUrl: normalized,
            makeActive: true,
            upstreamTimeoutMs,
            ...groups,
          }),
        });
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "保存失败，请检查地址格式。"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
        toast.success("转发地址配置已保存");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存失败");
        return false;
      } finally {
        set({ targetModalSubmitting: false });
      }
    },

    createHeaderPreset: async (name) => {
      const nextName = name.trim();
      if (!nextName) {
        toast.error("分组名称为必填项");
        return null;
      }
      try {
        const response = await apiFetch("/_proxira/api/header-presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        });
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "创建分组失败"));
        }
        const payload = (await response.json()) as {
          preset: ProxyHeaderPreset;
          config: ProxyConfig;
        };
        syncConfig(payload.config);
        toast.success("请求头分组已创建");
        return payload.preset.id;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "创建分组失败");
        return null;
      }
    },

    saveHeaderPreset: async (presetId, payload) => {
      try {
        const response = await apiFetch(
          `/_proxira/api/header-presets/${encodeURIComponent(presetId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            // 只带这次真正改了的字段：服务端按「传了什么就替换什么」处理，
            // 不会顺手把别的分组也写一遍。
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "保存请求头分组失败"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
        toast.success("请求头分组已保存");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存请求头分组失败");
        return false;
      }
    },

    removeHeaderPreset: async (presetId) => {
      try {
        const response = await apiFetch(
          `/_proxira/api/header-presets/${encodeURIComponent(presetId)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "删除分组失败"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
        toast.success("请求头分组已删除");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除分组失败");
      }
    },

    moveHeaderPreset: async (presetId, direction) => {
      try {
        const response = await apiFetch(
          `/_proxira/api/header-presets/${encodeURIComponent(presetId)}/move`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ direction }),
          },
        );
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "调整顺序失败"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "调整顺序失败");
      }
    },

    createMockGroup: async (name) => {
      const nextName = name.trim();
      if (!nextName) {
        toast.error("分组名称为必填项");
        return null;
      }
      try {
        const response = await apiFetch("/_proxira/api/mock-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        });
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "创建分组失败"));
        }
        const payload = (await response.json()) as {
          group: ProxyMockGroup;
          config: ProxyConfig;
        };
        syncConfig(payload.config);
        toast.success("Mock 分组已创建");
        return payload.group.id;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "创建分组失败");
        return null;
      }
    },

    saveMockGroup: async (groupId, payload) => {
      try {
        const response = await apiFetch(
          `/_proxira/api/mock-groups/${encodeURIComponent(groupId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "保存 Mock 分组失败"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
        toast.success("Mock 分组已保存");
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存 Mock 分组失败");
        return false;
      }
    },

    removeMockGroup: async (groupId) => {
      try {
        const response = await apiFetch(
          `/_proxira/api/mock-groups/${encodeURIComponent(groupId)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "删除分组失败"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
        toast.success("Mock 分组已删除");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除分组失败");
      }
    },

    moveMockGroup: async (groupId, direction) => {
      try {
        const response = await apiFetch(
          `/_proxira/api/mock-groups/${encodeURIComponent(groupId)}/move`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ direction }),
          },
        );
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "调整顺序失败"));
        }
        syncConfig(((await response.json()) as { config: ProxyConfig }).config);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "调整顺序失败");
      }
    },

    deleteTarget: async (target) => {
      set({ deleteTargetSubmitting: true });
      try {
        const response = await apiFetch(
          `/_proxira/api/groups/${encodeURIComponent(target.id)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "删除转发地址失败"));
        }
        const payload = (await response.json()) as {
          clearedRecords: number;
          config: ProxyConfig;
        };
        syncConfig(payload.config);
        set({ selectedRecordId: null });
        await fetchRecords();
        await fetchRules();
        toast.success(`已删除转发地址「${target.name}」，清除 ${payload.clearedRecords} 条数据`);
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除转发地址失败");
        return false;
      } finally {
        set({ deleteTargetSubmitting: false });
      }
    },

    selectRecord: (recordId) =>
      set((state) => {
        // 主动切到最新那条 = 已经看到了：提示立刻收起，水位线跟着推进。
        // 不推进的话，切回旧请求时未读数又 > 0，气泡会「复活」。
        // 切到别的旧记录则**不动**任何提示状态 —— 气泡不该跟着选中项走。
        return recordId !== null && state.records[0]?.id === recordId
          ? { selectedRecordId: recordId, newestSeenId: recordId, noticeShownAt: null }
          : { selectedRecordId: recordId };
      }),

    hideNewRecords: () =>
      set((state) => ({
        newestSeenId: state.records[0]?.id ?? null,
        noticeShownAt: null,
      })),

    removeRecord: async (recordId) => {
      const groupId = selectCurrentTargetId(get());
      if (!groupId) return;
      set({ deletingRecordId: recordId });
      try {
        const response = await apiFetch(
          withTargetQuery(`/_proxira/api/records/${recordId}`, groupId),
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("删除失败");
        set((state) => {
          const records = state.records.filter((item) => item.id !== recordId);
          // 与 SSE 的 record_deleted 同理：水位线那条被删掉就重新钉到当前最新。
          const watermarkGone = state.newestSeenId === recordId;
          return {
            records,
            recordsTotal: Math.max(0, state.recordsTotal - 1),
            selectedRecordId: state.selectedRecordId === recordId ? null : state.selectedRecordId,
            ...(watermarkGone
              ? { newestSeenId: records[0]?.id ?? null, noticeShownAt: null }
              : {}),
          };
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除失败");
      } finally {
        set({ deletingRecordId: null });
      }
    },

    exportRecords: async (filters) => {
      const groupId = selectCurrentTargetId(get());
      if (!groupId) {
        toast.error("当前没有可导出的转发地址");
        return;
      }
      set({ exporting: true });
      try {
        const query = new URLSearchParams();
        if (filters.method !== "ALL") query.set("method", filters.method);
        if (filters.status === "ERROR") query.set("status", "error");
        else if (filters.status !== "ALL") query.set("status", filters.status);
        const queryText = query.toString();
        const path = queryText
          ? `/_proxira/api/records/export?${queryText}`
          : "/_proxira/api/records/export";
        const response = await apiFetch(withTargetQuery(path, groupId));
        if (!response.ok) throw new Error("导出失败");

        const responseText = await response.text();
        let rawPayload: unknown = {};
        if (responseText.trim().length > 0) {
          try {
            rawPayload = JSON.parse(responseText) as unknown;
          } catch {
            rawPayload = {};
          }
        }
        const targetName = selectActiveTarget(get())?.name?.trim() || "target";
        const payload = normalizeExportPayload(rawPayload, {
          groupId,
          groupName: targetName,
        });

        const blob = new Blob([toPrettyJson(payload)], {
          type: "application/json; charset=utf-8",
        });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const fileToken = payload.exportedAt.replace(/[:.]/g, "-");
        const targetToken =
          payload.groupName
            .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || "target";
        link.href = objectUrl;
        link.download = `proxira-${targetToken}-records-${fileToken}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        toast[payload.total === 0 ? "info" : "success"](
          payload.total === 0
            ? "导出成功，当前筛选条件下无记录（空文件）"
            : `导出成功，共 ${payload.total} 条`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "导出失败");
      } finally {
        set({ exporting: false });
      }
    },

    clearRecords: async () => {
      const groupId = selectCurrentTargetId(get());
      if (!groupId) {
        toast.error("当前没有可清除的转发地址");
        return;
      }
      set({ clearingRecords: true });
      try {
        const response = await apiFetch(withTargetQuery("/_proxira/api/records", groupId), {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("清除历史记录失败");
        const payload = (await response.json()) as { cleared: number };
        set(emptyRecordsState());
        toast.success(`已清除 ${payload.cleared} 条历史记录`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "清除历史记录失败");
      } finally {
        set({ clearingRecords: false });
      }
    },

    resetAll: async () => {
      set({ resettingAll: true });
      try {
        const response = await apiFetch("/_proxira/api/reset", { method: "POST" });
        if (!response.ok) throw new Error("重置失败");
        const payload = (await response.json()) as {
          clearedRecords: number;
          config: ProxyConfig;
        };
        syncConfig(payload.config);
        set({ selectedRecordId: null });
        await fetchRecords();
        await fetchRules();
        toast.success(`已重置全部内容，清除 ${payload.clearedRecords} 条历史`);
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "重置失败");
        return false;
      } finally {
        set({ resettingAll: false });
      }
    },

    replayRecord: async (payload) => {
      set({ replaying: true });
      try {
        const response = await apiFetch("/_proxira/api/replay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await extractErrorMessage(response, "重放失败"));
        const result = (await response.json()) as ReplayResult;
        if (!result.ok) toast.error(`重放失败：${result.error ?? "未知错误"}`);
        return result;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "重放失败");
        return null;
      } finally {
        set({ replaying: false });
      }
    },

    fetchServerStatus: async () => {
      set({ fetchingStatus: true });
      try {
        const response = await apiFetch("/_proxira/api/status");
        if (!response.ok) throw new Error("获取服务状态失败");
        set({ serverStatus: (await response.json()) as ProxyServerStatus });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "获取服务状态失败");
      } finally {
        set({ fetchingStatus: false });
      }
    },

    openDataFolder: async () => {
      try {
        const response = await apiFetch("/_proxira/api/open-folder", { method: "POST" });
        if (!response.ok) {
          throw new Error(await extractErrorMessage(response, "无法打开文件夹"));
        }
        toast.success("已在系统文件管理器中打开数据目录");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "无法打开文件夹");
      }
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
  };
});
