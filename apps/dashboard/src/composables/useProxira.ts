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
  const targets = ref<ProxyGroup[]>([]);
  const activeTargetId = ref("");
  const selectedRecordId = ref<string | null>(null);
  const connectionState = ref<ConnectionState>("connecting");

  const deletingRecordId = ref<string | null>(null);
  const exporting = ref(false);
  const clearingRecords = ref(false);
  const resettingAll = ref(false);
  const targetModalSubmitting = ref(false);
  const deleteTargetSubmitting = ref(false);

  let events: EventSource | null = null;

  const activeTarget = computed(() => {
    if (!activeTargetId.value) {
      return targets.value[0] ?? null;
    }
    return (
      targets.value.find((entry) => entry.id === activeTargetId.value) ??
      targets.value[0] ??
      null
    );
  });

  const currentTargetId = computed(() => activeTarget.value?.id ?? "");

  const withTargetQuery = (path: string): string => {
    const targetId = currentTargetId.value;
    if (!targetId) {
      return `${apiBase}${path}`;
    }
    const separator = path.includes("?") ? "&" : "?";
    // Wire contract: the query key stays groupId for backward compatibility.
    return `${apiBase}${path}${separator}groupId=${encodeURIComponent(targetId)}`;
  };

  // Every request carries the access token when the server requires one.
  const apiFetch = (url: string, init?: RequestInit): Promise<Response> =>
    fetch(withAccessToken(url), init);

  const syncConfig = (config: ProxyConfig): void => {
    // Wire contract: config.groups / config.activeGroupId keep their persisted names.
    targets.value = config.groups;
    const matchedTarget =
      config.groups.find((entry) => entry.id === config.activeGroupId) ??
      config.groups[0] ??
      null;
    activeTargetId.value = matchedTarget?.id ?? "";
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
    if (!currentTargetId.value) {
      records.value = [];
      recordsTotal.value = 0;
      selectedRecordId.value = null;
      return;
    }

    const response = await apiFetch(withTargetQuery("/_proxira/api/records?limit=500"));
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
    if (!currentTargetId.value || recordsLoadingMore.value) {
      return;
    }
    if (records.value.length >= recordsTotal.value) {
      return;
    }

    recordsLoadingMore.value = true;
    try {
      const response = await apiFetch(
        withTargetQuery(
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
    if (!currentTargetId.value) {
      rules.value = [];
      return;
    }
    const response = await apiFetch(withTargetQuery("/_proxira/api/rules"));
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
          : withTargetQuery("/_proxira/api/rules"),
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
      const previousTargetId = currentTargetId.value;
      syncConfig(event.config);
      const nextTargetId = currentTargetId.value;
      if (previousTargetId !== nextTargetId) {
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
      if (event.groupId !== currentTargetId.value) {
        return;
      }
      pushRecord(event.record);
      return;
    }

    if (event.type === "record_deleted") {
      if (event.groupId !== currentTargetId.value) {
        return;
      }
      removeRecordLocal(event.id);
      return;
    }

    if (event.type === "records_cleared") {
      if (event.groupId !== currentTargetId.value) {
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

  const switchActiveTarget = async (nextTargetId: string): Promise<void> => {
    if (!nextTargetId || nextTargetId === activeTargetId.value) {
      return;
    }

    try {
      const response = await apiFetch(`${apiBase}/_proxira/api/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        // Wire contract: the payload key stays activeGroupId for backward
        // compatibility, even though the UI now calls these "转发地址".
        body: JSON.stringify({ activeGroupId: nextTargetId }),
      });
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, "切换转发地址失败"),
        );
      }

      const config = (await response.json()) as ProxyConfig;
      syncConfig(config);
      await fetchRecords();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "切换转发地址失败", "error");
    }
  };

  const isTargetDuplicated = (
    normalizedTarget: string,
    ignoreTargetId?: string,
  ): boolean =>
    targets.value.some((entry) => {
      if (ignoreTargetId && entry.id === ignoreTargetId) {
        return false;
      }
      return entry.targetBaseUrl === normalizedTarget;
    });

  const createTarget = async (
    targetNameRaw: string,
    targetBaseUrlRaw: string,
    upstreamTimeoutMs: number | null = null,
  ): Promise<boolean> => {
    const nextTargetName = targetNameRaw.trim();
    if (!nextTargetName) {
      pushToast("名称为必填项", "error");
      return false;
    }

    const normalizedTarget = normalizeTargetInput(targetBaseUrlRaw);
    if (!normalizedTarget) {
      pushToast("转发地址为必填项，且必须是 http/https URL", "error");
      return false;
    }

    if (isTargetDuplicated(normalizedTarget)) {
      pushToast("转发地址不能与已有地址重复", "error");
      return false;
    }

    targetModalSubmitting.value = true;
    try {
      const response = await apiFetch(`${apiBase}/_proxira/api/groups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: nextTargetName,
          targetBaseUrl: normalizedTarget,
          // Never hijack live traffic: creating a target leaves the active
          // target untouched until the user switches on purpose.
          switchToNew: false,
          upstreamTimeoutMs,
        }),
      });
      if (!response.ok) {
        throw new Error(
          await extractErrorMessage(response, "创建转发地址失败，请检查地址格式"),
        );
      }

      const payload = (await response.json()) as { config: ProxyConfig };
      syncConfig(payload.config);
      // Stay on the current target: fetchRecords refreshes the active target.
      await fetchRecords();
      pushToast("转发地址已创建，需要时可在顶部下拉中切换", "success");
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "创建转发地址失败", "error");
      return false;
    } finally {
      targetModalSubmitting.value = false;
    }
  };

  const saveActiveTarget = async (
    targetNameRaw: string,
    targetBaseUrlRaw: string,
    upstreamTimeoutMs: number | null = null,
  ): Promise<boolean> => {
    if (!currentTargetId.value) {
      pushToast("当前没有可用转发地址", "error");
      return false;
    }

    const targetName = targetNameRaw.trim();
    if (!targetName) {
      pushToast("名称为必填项", "error");
      return false;
    }

    const normalizedTarget = normalizeTargetInput(targetBaseUrlRaw);
    if (!normalizedTarget) {
      pushToast("转发地址必须是有效的 http/https URL", "error");
      return false;
    }

    if (isTargetDuplicated(normalizedTarget, currentTargetId.value)) {
      pushToast("转发地址不能与其他地址重复", "error");
      return false;
    }

    targetModalSubmitting.value = true;

    try {
      const response = await apiFetch(
        `${apiBase}/_proxira/api/groups/${encodeURIComponent(currentTargetId.value)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: targetName,
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
      pushToast("转发地址配置已保存", "success");
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "保存失败", "error");
      return false;
    } finally {
      targetModalSubmitting.value = false;
    }
  };

  const deleteTarget = async (targetEntry: ProxyGroup): Promise<boolean> => {
    deleteTargetSubmitting.value = true;
    try {
      const response = await apiFetch(
        `${apiBase}/_proxira/api/groups/${encodeURIComponent(targetEntry.id)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error(await extractErrorMessage(response, "删除转发地址失败"));
      }

      const payload = (await response.json()) as {
        clearedRecords: number;
        config: ProxyConfig;
      };
      syncConfig(payload.config);
      await fetchRecords();
      pushToast(
        `已删除转发地址「${targetEntry.name}」，清除 ${payload.clearedRecords} 条数据`,
        "success",
      );
      return true;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "删除转发地址失败", "error");
      return false;
    } finally {
      deleteTargetSubmitting.value = false;
    }
  };

  const removeRecord = async (recordId: string): Promise<void> => {
    if (!currentTargetId.value) {
      return;
    }

    deletingRecordId.value = recordId;
    try {
      const response = await apiFetch(withTargetQuery(`/_proxira/api/records/${recordId}`), {
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
    if (!currentTargetId.value) {
      pushToast("当前没有可导出的转发地址", "error");
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
      const response = await apiFetch(withTargetQuery(path));
      if (!response.ok) {
        throw new Error("导出失败");
      }

      const fallbackTargetName = activeTarget.value?.name?.trim() || "target";
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
        groupId: currentTargetId.value,
        groupName: fallbackTargetName,
      });

      const jsonText = toPrettyJson(payload);
      const blob = new Blob([jsonText], { type: "application/json; charset=utf-8" });
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
    if (!currentTargetId.value) {
      pushToast("当前没有可清除的转发地址", "error");
      return;
    }

    clearingRecords.value = true;
    try {
      const response = await apiFetch(withTargetQuery("/_proxira/api/records"), {
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
    targets,
    activeTarget,
    activeTargetId,
    currentTargetId,
    selectedRecordId,
    connectionState,
    deletingRecordId,
    exporting,
    clearingRecords,
    resettingAll,
    targetModalSubmitting,
    deleteTargetSubmitting,
    fetchConfig,
    fetchRecords,
    loadMoreRecords,
    connectSse,
    switchActiveTarget,
    createTarget,
    saveActiveTarget,
    deleteTarget,
    removeRecord,
    exportRecords,
    clearRecords,
    resetAll,
  };
};
