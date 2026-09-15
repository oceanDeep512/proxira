import { computed, onBeforeUnmount, ref } from "vue";
import type {
  ProxyConfig,
  ProxyGroup,
  ProxyRecordsResponse,
  ProxyRule,
  ProxySseEvent,
  ProxyTrafficRecord,
} from "@proxira/core";
import type { ConnectionState } from "../types.js";
import { useToasts } from "./useToasts.js";
import { normalizeTargetInput } from "../utils/filters.js";
import { normalizeExportPayload } from "../utils/body.js";
import { toPrettyJson } from "../utils/format.js";

const apiBase =
  (import.meta.env.VITE_PROXY_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const TOKEN_STORAGE_KEY = "proxira.access-token";

// Optional access token: picked up from ?token=... in the URL once, then kept
// for the session so every request (including EventSource) carries it.
const resolveAccessToken = (): string => {
  if (typeof window === "undefined") {
    return "";
  }
  const fromUrl = new URLSearchParams(window.location.search).get("token")?.trim();
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
    } catch {
      // Private mode: fall back to the URL value only.
    }
    return fromUrl;
  }
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
};

const accessToken = resolveAccessToken();

const withAccessToken = (url: string): string => {
  if (!accessToken) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(accessToken)}`;
};

export type ReplayResult = {
  ok: boolean;
  status: number | null;
  durationMs: number;
  headers: Record<string, string>;
  body: string | null;
  recordId: string | null;
  error: string | null;
};

const extractErrorMessage = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload?.message) {
      return payload.message;
    }
  } catch {
    // Ignore JSON parsing errors.
  }
  return fallback;
};

export const useProxira = () => {
  const { pushToast } = useToasts();

  const records = ref<ProxyTrafficRecord[]>([]);
  const rules = ref<ProxyRule[]>([]);
  const recordsTotal = ref(0);
  const recordsLoadingMore = ref(false);
  const groups = ref<ProxyGroup[]>([]);
  const activeGroupId = ref("");
  const selectedRecordId = ref<string | null>(null);
  const connectionState = ref<ConnectionState>("connecting");

  const deletingRecordId = ref<string | null>(null);
  const exporting = ref(false);
  const clearingRecords = ref(false);
  const resettingAll = ref(false);
  const groupModalSubmitting = ref(false);
  const deleteGroupSubmitting = ref(false);

  let events: EventSource | null = null;

  const activeGroup = computed(() => {
    if (!activeGroupId.value) {
      return groups.value[0] ?? null;
    }
    return (
      groups.value.find((group) => group.id === activeGroupId.value) ??
      groups.value[0] ??
      null
    );
  });

  const currentGroupId = computed(() => activeGroup.value?.id ?? "");

  const withGroupQuery = (path: string): string => {
    const groupId = currentGroupId.value;
    if (!groupId) {
      return `${apiBase}${path}`;
    }
    const separator = path.includes("?") ? "&" : "?";
    return `${apiBase}${path}${separator}groupId=${encodeURIComponent(groupId)}`;
  };

  // Every request carries the access token when the server requires one.
  const apiFetch = (url: string, init?: RequestInit): Promise<Response> =>
    fetch(withAccessToken(url), init);

  const syncConfig = (config: ProxyConfig): void => {
    groups.value = config.groups;
    const matchedGroup =
      config.groups.find((group) => group.id === config.activeGroupId) ??
      config.groups[0] ??
      null;
    activeGroupId.value = matchedGroup?.id ?? "";
  };

  const pushRecord = (record: ProxyTrafficRecord): void => {
    // A re-broadcast of the same id (e.g. a streaming response whose body was
    // filled in after background sampling) replaces the existing entry.
    const existingIndex = records.value.findIndex((item) => item.id === record.id);
    if (existingIndex !== -1) {
      records.value[existingIndex] = record;
      return;
    }
    records.value.unshift(record);
    recordsTotal.value += 1;
    if (!selectedRecordId.value) {
      selectedRecordId.value = record.id;
    }
  };

  const removeRecordLocal = (recordId: string): void => {
    const currentIndex = records.value.findIndex((record) => record.id === recordId);
    if (currentIndex !== -1) {
      records.value.splice(currentIndex, 1);
      recordsTotal.value = Math.max(0, recordsTotal.value - 1);
    }

    if (selectedRecordId.value === recordId) {
      selectedRecordId.value = null;
    }
  };

  const fetchConfig = async (): Promise<void> => {
    const response = await apiFetch(`${apiBase}/_proxira/api/config`);
    if (!response.ok) {
      throw new Error(
        response.status === 401 && !accessToken
          ? "服务已启用访问令牌：请在面板地址后追加 ?token=你的令牌 后重新打开"
          : "加载配置失败",
      );
    }

    const config = (await response.json()) as ProxyConfig;
    syncConfig(config);
  };

  const fetchRecords = async (): Promise<void> => {
    if (!currentGroupId.value) {
      records.value = [];
      recordsTotal.value = 0;
      selectedRecordId.value = null;
      return;
    }

    const response = await apiFetch(withGroupQuery("/_proxira/api/records?limit=500"));
    if (!response.ok) {
      throw new Error("加载历史记录失败");
    }

    const payload = (await response.json()) as ProxyRecordsResponse;
    records.value = payload.items;
    recordsTotal.value = payload.total;
    if (payload.items.length === 0) {
      selectedRecordId.value = null;
      return;
    }

    const currentStillExists = selectedRecordId.value
      ? payload.items.some((item) => item.id === selectedRecordId.value)
      : false;
    if (!currentStillExists) {
      selectedRecordId.value = payload.items[0].id;
    }
  };

  // The server caps a single page, so anything beyond it is fetched on demand
  // instead of silently disappearing from the dashboard.
  const loadMoreRecords = async (): Promise<void> => {
    if (!currentGroupId.value || recordsLoadingMore.value) {
      return;
    }
    if (records.value.length >= recordsTotal.value) {
      return;
    }

    recordsLoadingMore.value = true;
    try {
      const response = await apiFetch(
        withGroupQuery(
          `/_proxira/api/records?limit=500&offset=${records.value.length}`,
        ),
      );
      if (!response.ok) {
        throw new Error("加载更多记录失败");
      }
      const payload = (await response.json()) as ProxyRecordsResponse;
      const knownIds = new Set(records.value.map((item) => item.id));
      const appended = payload.items.filter((item) => !knownIds.has(item.id));
      records.value = [...records.value, ...appended];
      recordsTotal.value = payload.total;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "加载更多记录失败", "error");
    } finally {
      recordsLoadingMore.value = false;
    }
  };

  const fetchRules = async (): Promise<void> => {
    if (!currentGroupId.value) {
      rules.value = [];
      return;
    }
    const response = await apiFetch(withGroupQuery("/_proxira/api/rules"));
    if (!response.ok) {
      throw new Error("加载规则失败");
    }
    const payload = (await response.json()) as { items: ProxyRule[] };
    rules.value = payload.items;
  };

  const saveRule = async (
    input: Record<string, unknown>,
    ruleId?: string,
  ): Promise<boolean> => {
    try {
      const response = await apiFetch(
        ruleId
          ? `${apiBase}/_proxira/api/rules/${encodeURIComponent(ruleId)}`
          : withGroupQuery("/_proxira/api/rules"),
        {
          method: ruleId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(await extractErrorMessage(response, "保存规则失败"));
      }
      await fetchRules();
      pushToast(ruleId ? "规则已更新" : "规则已创建", "success");
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "保存规则失败", "error");
      return false;
    }
  };

  const removeRule = async (ruleId: string): Promise<void> => {
    try {
      const response = await apiFetch(
        `${apiBase}/_proxira/api/rules/${encodeURIComponent(ruleId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(await extractErrorMessage(response, "删除规则失败"));
      }
      rules.value = rules.value.filter((rule) => rule.id !== ruleId);
      pushToast("规则已删除", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "删除规则失败", "error");
    }
  };

  const toggleRule = async (rule: ProxyRule): Promise<void> => {
    await saveRule({ enabled: !rule.enabled }, rule.id);
  };

  const replaying = ref(false);

  const replayRecord = async (payload: {
    recordId?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<ReplayResult | null> => {
    replaying.value = true;
    try {
      const response = await apiFetch(`${apiBase}/_proxira/api/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await extractErrorMessage(response, "重放失败"));
      }
      const result = (await response.json()) as ReplayResult;
      if (!result.ok) {
        pushToast(`重放失败：${result.error ?? "未知错误"}`, "error");
      }
      return result;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "重放失败", "error");
      return null;
    } finally {
      replaying.value = false;
    }
  };

  const applySseEvent = (event: ProxySseEvent): void => {
    if (event.type === "snapshot" || event.type === "config") {
      const previousGroupId = currentGroupId.value;
      syncConfig(event.config);
      const nextGroupId = currentGroupId.value;
      if (previousGroupId !== nextGroupId) {
        void fetchRecords().catch((error) => {
          pushToast(
            error instanceof Error ? error.message : "加载历史记录失败",
            "error",
          );
        });
      }
      return;
    }

    if (event.type === "record") {
      if (event.groupId !== currentGroupId.value) {
        return;
      }
      pushRecord(event.record);
      return;
    }

    if (event.type === "record_deleted") {
      if (event.groupId !== currentGroupId.value) {
        return;
      }
      removeRecordLocal(event.id);
      return;
    }

    if (event.type === "records_cleared") {
      if (event.groupId !== currentGroupId.value) {
        return;
      }
      records.value = [];
      recordsTotal.value = 0;
      selectedRecordId.value = null;
    }
  };

  const connectSse = (): void => {
    events?.close();
    connectionState.value = "connecting";

    events = new EventSource(withAccessToken(`${apiBase}/_proxira/api/events`));
    events.onopen = () => {
      connectionState.value = "open";
    };
    events.onerror = () => {
      connectionState.value = "closed";
    };
    events.onmessage = (rawEvent) => {
      try {
        const parsed = JSON.parse(rawEvent.data) as ProxySseEvent;
        applySseEvent(parsed);
      } catch {
        // Ignore malformed events.
      }
    };
  };

  onBeforeUnmount(() => {
    events?.close();
  });

  const switchActiveGroup = async (nextGroupId: string): Promise<void> => {
    if (!nextGroupId || nextGroupId === activeGroupId.value) {
      return;
    }

    try {
      const response = await apiFetch(`${apiBase}/_proxira/api/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ activeGroupId: nextGroupId }),
      });
      if (!response.ok) {
        throw new Error("切换分组失败");
      }

      const config = (await response.json()) as ProxyConfig;
      syncConfig(config);
      await fetchRecords();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "切换分组失败", "error");
    }
  };

  const isTargetDuplicated = (
    normalizedTarget: string,
    ignoreGroupId?: string,
  ): boolean =>
    groups.value.some((group) => {
      if (ignoreGroupId && group.id === ignoreGroupId) {
        return false;
      }
      return group.targetBaseUrl === normalizedTarget;
    });

  const createGroup = async (
    groupNameRaw: string,
    targetBaseUrlRaw: string,
    upstreamTimeoutMs: number | null = null,
  ): Promise<boolean> => {
    const nextGroupName = groupNameRaw.trim();
    if (!nextGroupName) {
      pushToast("分组名称为必填项", "error");
      return false;
    }

    const normalizedTarget = normalizeTargetInput(targetBaseUrlRaw);
    if (!normalizedTarget) {
      pushToast("分组地址为必填项，且必须是 http/https URL", "error");
      return false;
    }

    if (isTargetDuplicated(normalizedTarget)) {
      pushToast("分组地址不能与已有分组重复", "error");
      return false;
    }

    groupModalSubmitting.value = true;
    try {
      const response = await apiFetch(`${apiBase}/_proxira/api/groups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: nextGroupName,
          targetBaseUrl: normalizedTarget,
          // Never hijack live traffic: creating a group leaves the active
          // group untouched until the user switches on purpose.
          switchToNew: false,
          upstreamTimeoutMs,
        }),
      });
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, "创建分组失败，请检查地址格式"),
        );
      }

      const payload = (await response.json()) as { config: ProxyConfig };
      syncConfig(payload.config);
      // Stay on the current group: fetchRecords refreshes the active group.
      await fetchRecords();
      pushToast("分组已创建，需要时可在分组下拉中切换", "success");
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "创建分组失败", "error");
      return false;
    } finally {
      groupModalSubmitting.value = false;
    }
  };

  const saveActiveGroup = async (
    groupNameRaw: string,
    targetBaseUrlRaw: string,
    upstreamTimeoutMs: number | null = null,
  ): Promise<boolean> => {
    if (!currentGroupId.value) {
      pushToast("当前没有可用分组", "error");
      return false;
    }

    const groupName = groupNameRaw.trim();
    if (!groupName) {
      pushToast("分组名称为必填项", "error");
      return false;
    }

    const normalizedTarget = normalizeTargetInput(targetBaseUrlRaw);
    if (!normalizedTarget) {
      pushToast("分组地址必须是有效的 http/https URL", "error");
      return false;
    }

    if (isTargetDuplicated(normalizedTarget, currentGroupId.value)) {
      pushToast("分组地址不能与其他分组重复", "error");
      return false;
    }

    groupModalSubmitting.value = true;

    try {
      const response = await apiFetch(
        `${apiBase}/_proxira/api/groups/${encodeURIComponent(currentGroupId.value)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: groupName,
            targetBaseUrl: normalizedTarget,
            makeActive: true,
            upstreamTimeoutMs,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, "保存失败，请检查地址格式。"),
        );
      }

      const payload = (await response.json()) as { config: ProxyConfig };
      syncConfig(payload.config);
      pushToast("分组配置已保存", "success");
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "保存失败", "error");
      return false;
    } finally {
      groupModalSubmitting.value = false;
    }
  };

  const deleteGroup = async (targetGroup: ProxyGroup): Promise<boolean> => {
    deleteGroupSubmitting.value = true;
    try {
      const response = await apiFetch(
        `${apiBase}/_proxira/api/groups/${encodeURIComponent(targetGroup.id)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error(await extractErrorMessage(response, "删除分组失败"));
      }

      const payload = (await response.json()) as {
        clearedRecords: number;
        config: ProxyConfig;
      };
      syncConfig(payload.config);
      await fetchRecords();
      pushToast(
        `已删除分组「${targetGroup.name}」，清除 ${payload.clearedRecords} 条数据`,
        "success",
      );
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "删除分组失败", "error");
      return false;
    } finally {
      deleteGroupSubmitting.value = false;
    }
  };

  const removeRecord = async (recordId: string): Promise<void> => {
    if (!currentGroupId.value) {
      return;
    }

    deletingRecordId.value = recordId;
    try {
      const response = await apiFetch(withGroupQuery(`/_proxira/api/records/${recordId}`), {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("删除失败");
      }
      removeRecordLocal(recordId);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "删除失败", "error");
    } finally {
      deletingRecordId.value = null;
    }
  };

  const exportRecords = async (filters: {
    method: string;
    status: string;
  }): Promise<void> => {
    if (!currentGroupId.value) {
      pushToast("当前没有可导出的分组", "error");
      return;
    }

    exporting.value = true;

    try {
      const query = new URLSearchParams();
      if (filters.method !== "ALL") {
        query.set("method", filters.method);
      }
      if (filters.status === "ERROR") {
        query.set("status", "error");
      } else if (filters.status !== "ALL") {
        query.set("status", filters.status);
      }
      const queryText = query.toString();
      const path = queryText
        ? `/_proxira/api/records/export?${queryText}`
        : "/_proxira/api/records/export";
      const response = await apiFetch(withGroupQuery(path));
      if (!response.ok) {
        throw new Error("导出失败");
      }

      const fallbackGroupName = activeGroup.value?.name?.trim() || "group";
      const responseText = await response.text();
      let rawPayload: unknown = {};
      if (responseText.trim().length > 0) {
        try {
          rawPayload = JSON.parse(responseText) as unknown;
        } catch {
          rawPayload = {};
        }
      }
      const payload = normalizeExportPayload(rawPayload, {
        groupId: currentGroupId.value,
        groupName: fallbackGroupName,
      });

      const jsonText = toPrettyJson(payload);
      const blob = new Blob([jsonText], { type: "application/json; charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fileToken = payload.exportedAt.replace(/[:.]/g, "-");
      const groupToken =
        payload.groupName
          .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || "group";
      link.href = objectUrl;
      link.download = `proxira-${groupToken}-records-${fileToken}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      if (payload.total === 0) {
        pushToast("导出成功，当前筛选条件下无记录（空文件）", "info");
      } else {
        pushToast(`导出成功，共 ${payload.total} 条`, "success");
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "导出失败", "error");
    } finally {
      exporting.value = false;
    }
  };

  const clearRecords = async (): Promise<void> => {
    if (!currentGroupId.value) {
      pushToast("当前没有可清除的分组", "error");
      return;
    }

    clearingRecords.value = true;
    try {
      const response = await apiFetch(withGroupQuery("/_proxira/api/records"), {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("清除历史记录失败");
      }

      const payload = (await response.json()) as { cleared: number };
      records.value = [];
      recordsTotal.value = 0;
      selectedRecordId.value = null;
      pushToast(`已清除 ${payload.cleared} 条历史记录`, "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "清除历史记录失败", "error");
    } finally {
      clearingRecords.value = false;
    }
  };

  const resetAll = async (): Promise<boolean> => {
    resettingAll.value = true;
    try {
      const response = await apiFetch(`${apiBase}/_proxira/api/reset`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("重置失败");
      }

      const payload = (await response.json()) as {
        clearedRecords: number;
        config: ProxyConfig;
      };
      syncConfig(payload.config);
      await fetchRecords();
      pushToast(`已重置全部内容，清除 ${payload.clearedRecords} 条历史`, "success");
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "重置失败", "error");
      return false;
    } finally {
      resettingAll.value = false;
    }
  };

  return {
    records,
    recordsTotal,
    rules,
    replaying,
    fetchRules,
    saveRule,
    removeRule,
    toggleRule,
    replayRecord,
    recordsLoadingMore,
    groups,
    activeGroup,
    activeGroupId,
    currentGroupId,
    selectedRecordId,
    connectionState,
    deletingRecordId,
    exporting,
    clearingRecords,
    resettingAll,
    groupModalSubmitting,
    deleteGroupSubmitting,
    fetchConfig,
    fetchRecords,
    loadMoreRecords,
    connectSse,
    switchActiveGroup,
    createGroup,
    saveActiveGroup,
    deleteGroup,
    removeRecord,
    exportRecords,
    clearRecords,
    resetAll,
  };
};
