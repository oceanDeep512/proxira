<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import JsonPretty from "vue-json-pretty";
import GroupPicker from "./components/GroupPicker.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import GroupFormModal from "./components/GroupFormModal.vue";
import ToastMessages from "./components/ToastMessages.vue";
import type {
  ProxyConfig,
  ProxyGroup,
  ProxyHeaders,
  ProxyPayloadBody,
  ProxyRecordsExportResponse,
  ProxyRecordsResponse,
  ProxySseEvent,
  ProxyTrafficRecord,
} from "@proxira/core";

const apiBase =
  (import.meta.env.VITE_PROXY_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const records = ref<ProxyTrafficRecord[]>([]);
const groups = ref<ProxyGroup[]>([]);
const activeGroupId = ref("");
const selectedRecordId = ref<string | null>(null);
const deletingRecordId = ref<string | null>(null);
const connectionState = ref<"connecting" | "open" | "closed">("connecting");
const exporting = ref(false);
const clearingRecords = ref(false);
const resettingAll = ref(false);
const groupModalOpen = ref(false);
const groupModalMode = ref<"create" | "edit">("create");
const groupModalSubmitting = ref(false);
const modalGroupName = ref("");
const modalTargetBaseUrl = ref("");
const deleteGroupModalOpen = ref(false);
const deleteGroupSubmitting = ref(false);
const pendingDeleteGroup = ref<ProxyGroup | null>(null);
const toastMessages = ref<Array<{ id: number; text: string; level: "success" | "error" | "info" }>>([]);

let events: EventSource | null = null;
let toastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

type BodyView = {
  mode: "empty" | "binary" | "json" | "text";
  jsonData: unknown | null;
  text: string;
  note: string;
};

const hasRecords = computed(() => records.value.length > 0);
const selectedRecord = computed(() => {
  if (!hasRecords.value) {
    return null;
  }

  if (!selectedRecordId.value) {
    return records.value[0];
  }

  return records.value.find((record) => record.id === selectedRecordId.value) ?? records.value[0];
});

const activeGroup = computed(() => {
  if (!activeGroupId.value) {
    return groups.value[0] ?? null;
  }
  return groups.value.find((group) => group.id === activeGroupId.value) ?? groups.value[0] ?? null;
});

const currentGroupId = computed(() => activeGroup.value?.id ?? "");
const recordsCountLabel = computed(() => `${records.value.length} 条`);
const groupsCountLabel = computed(() => `${groups.value.length} 组`);
const connectionLabel = computed(() => {
  if (connectionState.value === "open") return "SSE 已连接";
  if (connectionState.value === "connecting") return "SSE 连接中";
  return "SSE 已断开";
});
const modalTitle = computed(() => (groupModalMode.value === "create" ? "新增分组" : "编辑当前分组"));
const modalDesc = computed(() =>
  groupModalMode.value === "create"
    ? "请输入新分组的名称和唯一转发地址。"
    : "修改当前分组的名称与转发地址，地址仍需保持唯一。",
);
const modalSubmitText = computed(() => (groupModalMode.value === "create" ? "创建并切换" : "保存分组"));

const detailStatusLabel = computed(() => {
  if (!selectedRecord.value) {
    return "-";
  }
  return selectedRecord.value.responseStatus ?? "ERR";
});

const normalizeTargetInput = (value: string): string | null => {
  const source = value.trim();
  if (!source) {
    return null;
  }

  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const isTargetDuplicated = (normalizedTarget: string, ignoreGroupId?: string): boolean => {
  return groups.value.some((group) => {
    if (ignoreGroupId && group.id === ignoreGroupId) {
      return false;
    }
    return group.targetBaseUrl === normalizedTarget;
  });
};

const safeParseJson = (text: string): unknown | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseBody = (body: ProxyPayloadBody | null): BodyView => {
  if (!body || body.text === null) {
    if (body?.isBinary) {
      return {
        mode: "binary",
        jsonData: null,
        text: "",
        note: `binary body (${body.size} bytes)`,
      };
    }

    return {
      mode: "empty",
      jsonData: null,
      text: "",
      note: "(empty)",
    };
  }

  const jsonData = safeParseJson(body.text);
  if (jsonData !== null) {
    return {
      mode: "json",
      jsonData,
      text: "",
      note: body.truncated ? `已截断，原始 ${body.size} bytes` : "",
    };
  }

  return {
    mode: "text",
    jsonData: null,
    text: body.text,
    note: body.truncated ? `已截断，原始 ${body.size} bytes` : "",
  };
};

const requestBodyView = computed(() => parseBody(selectedRecord.value?.requestBody ?? null));
const responseBodyView = computed(() => parseBody(selectedRecord.value?.responseBody ?? null));

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleTimeString();
};

const formatDuration = (durationMs: number): string => `${durationMs} ms`;

const toPrettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

const bodyViewToCopyText = (body: BodyView): string => {
  if (body.mode === "json") {
    return toPrettyJson(body.jsonData ?? {});
  }
  if (body.mode === "text") {
    return body.text;
  }
  return body.note;
};

const shellEscape = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

const appendHeaderArgs = (parts: string[], headers: ProxyHeaders): void => {
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push("-H", shellEscape(`${key}: ${item}`));
      }
      continue;
    }
    parts.push("-H", shellEscape(`${key}: ${value}`));
  }
};

const buildCurlCommand = (record: ProxyTrafficRecord): string => {
  const commandParts = ["curl", "-X", record.method];
  appendHeaderArgs(commandParts, record.requestHeaders);
  if (
    record.method !== "GET" &&
    record.method !== "HEAD" &&
    record.requestBody.text &&
    record.requestBody.text.length > 0
  ) {
    commandParts.push("--data-raw", shellEscape(record.requestBody.text));
  }
  commandParts.push(shellEscape(record.upstreamUrl));
  return commandParts.join(" ");
};

const withGroupQuery = (path: string): string => {
  const groupId = currentGroupId.value;
  if (!groupId) {
    return `${apiBase}${path}`;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${apiBase}${path}${separator}groupId=${encodeURIComponent(groupId)}`;
};

const dismissToast = (id: number): void => {
  const timer = toastTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
  toastMessages.value = toastMessages.value.filter((item) => item.id !== id);
};

const pushToast = (text: string, level: "success" | "error" | "info" = "info"): void => {
  const id = ++toastId;
  toastMessages.value = [...toastMessages.value, { id, text, level }];
  const timer = setTimeout(() => {
    dismissToast(id);
  }, 2800);
  toastTimers.set(id, timer);
};

const extractErrorMessage = async (response: Response, fallback: string): Promise<string> => {
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

const copyText = async (label: string, text: string): Promise<void> => {
  if (!text) {
    pushToast(`${label} 为空`, "info");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    pushToast(`已复制 ${label}`, "success");
  } catch {
    pushToast(`复制 ${label} 失败，请检查浏览器权限`, "error");
  }
};

const syncConfig = (config: ProxyConfig): void => {
  groups.value = config.groups;
  const matchedGroup =
    config.groups.find((group) => group.id === config.activeGroupId) ?? config.groups[0] ?? null;
  activeGroupId.value = matchedGroup?.id ?? "";
};

const pushRecord = (record: ProxyTrafficRecord): void => {
  records.value.unshift(record);
  if (!selectedRecordId.value) {
    selectedRecordId.value = record.id;
  }
};

const removeRecordLocal = (recordId: string): void => {
  const currentIndex = records.value.findIndex((record) => record.id === recordId);
  if (currentIndex === -1) {
    return;
  }

  records.value.splice(currentIndex, 1);
  if (selectedRecordId.value !== recordId) {
    return;
  }

  const fallback = records.value[currentIndex] ?? records.value[currentIndex - 1] ?? records.value[0] ?? null;
  selectedRecordId.value = fallback?.id ?? null;
};

const applySseEvent = (event: ProxySseEvent): void => {
  if (event.type === "snapshot" || event.type === "config") {
    const previousGroupId = currentGroupId.value;
    syncConfig(event.config);
    const nextGroupId = currentGroupId.value;
    if (previousGroupId !== nextGroupId) {
      void fetchRecords().catch((error) => {
        pushToast(error instanceof Error ? error.message : "加载历史记录失败", "error");
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
    selectedRecordId.value = null;
  }
};

const fetchConfig = async (): Promise<void> => {
  const response = await fetch(`${apiBase}/_proxira/api/config`);
  if (!response.ok) {
    throw new Error("加载配置失败");
  }

  const config = (await response.json()) as ProxyConfig;
  syncConfig(config);
};

const fetchRecords = async (): Promise<void> => {
  if (!currentGroupId.value) {
    records.value = [];
    selectedRecordId.value = null;
    return;
  }

  const response = await fetch(withGroupQuery("/_proxira/api/records"));
  if (!response.ok) {
    throw new Error("加载历史记录失败");
  }

  const payload = (await response.json()) as ProxyRecordsResponse;
  records.value = payload.items;
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

const connectSse = (): void => {
  events?.close();
  connectionState.value = "connecting";

  events = new EventSource(`${apiBase}/_proxira/api/events`);
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

const switchActiveGroup = async (nextGroupId: string): Promise<void> => {
  if (!nextGroupId || nextGroupId === activeGroupId.value) {
    return;
  }

  try {
    const response = await fetch(`${apiBase}/_proxira/api/config`, {
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

const onGroupSelect = (nextGroupId: string): void => {
  void switchActiveGroup(nextGroupId);
};

const createGroup = async (groupNameRaw: string, targetBaseUrlRaw: string): Promise<void> => {
  const nextGroupName = groupNameRaw.trim();
  if (!nextGroupName) {
    pushToast("分组名称为必填项", "error");
    return;
  }

  const normalizedTarget = normalizeTargetInput(targetBaseUrlRaw);
  if (!normalizedTarget) {
    pushToast("分组地址为必填项，且必须是 http/https URL", "error");
    return;
  }

  if (isTargetDuplicated(normalizedTarget)) {
    pushToast("分组地址不能与已有分组重复", "error");
    return;
  }

  groupModalSubmitting.value = true;
  try {
    const response = await fetch(`${apiBase}/_proxira/api/groups`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: nextGroupName,
        targetBaseUrl: normalizedTarget,
        switchToNew: true,
      }),
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response, "创建分组失败，请检查地址格式"));
    }

    const payload = (await response.json()) as { config: ProxyConfig };
    syncConfig(payload.config);
    await fetchRecords();
    groupModalOpen.value = false;
    pushToast("分组已创建并切换", "success");
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "创建分组失败", "error");
  } finally {
    groupModalSubmitting.value = false;
  }
};

const saveActiveGroup = async (groupNameRaw: string, targetBaseUrlRaw: string): Promise<void> => {
  if (!currentGroupId.value) {
    pushToast("当前没有可用分组", "error");
    return;
  }

  const groupName = groupNameRaw.trim();
  if (!groupName) {
    pushToast("分组名称为必填项", "error");
    return;
  }

  const normalizedTarget = normalizeTargetInput(targetBaseUrlRaw);
  if (!normalizedTarget) {
    pushToast("分组地址必须是有效的 http/https URL", "error");
    return;
  }

  if (isTargetDuplicated(normalizedTarget, currentGroupId.value)) {
    pushToast("分组地址不能与其他分组重复", "error");
    return;
  }

  groupModalSubmitting.value = true;

  try {
    const response = await fetch(`${apiBase}/_proxira/api/groups/${encodeURIComponent(currentGroupId.value)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: groupName,
        targetBaseUrl: normalizedTarget,
        makeActive: true,
      }),
    });

    if (!response.ok) {
      throw new Error(await extractErrorMessage(response, "保存失败，请检查地址格式。"));
    }

    const payload = (await response.json()) as { config: ProxyConfig };
    syncConfig(payload.config);
    groupModalOpen.value = false;
    pushToast("分组配置已保存", "success");
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    groupModalSubmitting.value = false;
  }
};

const openCreateGroupModal = (): void => {
  groupModalMode.value = "create";
  modalGroupName.value = "";
  modalTargetBaseUrl.value = "";
  groupModalOpen.value = true;
};

const openEditGroupModal = (): void => {
  const group = activeGroup.value;
  if (!group) {
    pushToast("当前没有可编辑的分组", "error");
    return;
  }

  groupModalMode.value = "edit";
  modalGroupName.value = group.name;
  modalTargetBaseUrl.value = group.targetBaseUrl;
  groupModalOpen.value = true;
};

const closeGroupModal = (): void => {
  if (groupModalSubmitting.value) {
    return;
  }
  groupModalOpen.value = false;
};

const submitGroupModal = async (payload: { name: string; targetBaseUrl: string }): Promise<void> => {
  if (groupModalMode.value === "create") {
    await createGroup(payload.name, payload.targetBaseUrl);
    return;
  }
  await saveActiveGroup(payload.name, payload.targetBaseUrl);
};

const openDeleteGroupModal = (groupId: string): void => {
  const targetGroup = groups.value.find((group) => group.id === groupId) ?? null;
  if (!targetGroup) {
    pushToast("分组不存在，无法删除", "error");
    return;
  }

  pendingDeleteGroup.value = targetGroup;
  deleteGroupModalOpen.value = true;
};

const closeDeleteGroupModal = (): void => {
  if (deleteGroupSubmitting.value) {
    return;
  }
  deleteGroupModalOpen.value = false;
  pendingDeleteGroup.value = null;
};

const confirmDeleteGroup = async (): Promise<void> => {
  const targetGroup = pendingDeleteGroup.value;
  if (!targetGroup) {
    return;
  }

  deleteGroupSubmitting.value = true;
  try {
    const response = await fetch(`${apiBase}/_proxira/api/groups/${encodeURIComponent(targetGroup.id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(await extractErrorMessage(response, "删除分组失败"));
    }

    const payload = (await response.json()) as {
      clearedRecords: number;
      config: ProxyConfig;
    };
    syncConfig(payload.config);
    await fetchRecords();
    pushToast(`已删除分组「${targetGroup.name}」，清除 ${payload.clearedRecords} 条数据`, "success");
    closeDeleteGroupModal();
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "删除分组失败", "error");
  } finally {
    deleteGroupSubmitting.value = false;
  }
};

const onSelectRecord = (recordId: string): void => {
  selectedRecordId.value = recordId;
};

const removeRecord = async (recordId: string): Promise<void> => {
  if (!currentGroupId.value) {
    return;
  }

  deletingRecordId.value = recordId;
  try {
    const response = await fetch(withGroupQuery(`/_proxira/api/records/${recordId}`), {
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

const exportRecords = async (): Promise<void> => {
  if (!currentGroupId.value) {
    pushToast("当前没有可导出的分组", "error");
    return;
  }

  exporting.value = true;

  try {
    const response = await fetch(withGroupQuery("/_proxira/api/records/export"));
    if (!response.ok) {
      throw new Error("导出失败");
    }

    const payload = (await response.json()) as ProxyRecordsExportResponse;
    const jsonText = toPrettyJson(payload);
    const blob = new Blob([jsonText], { type: "application/json; charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileToken = payload.exportedAt.replace(/[:.]/g, "-");
    const groupToken =
      payload.groupName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") ||
      "group";
    link.href = objectUrl;
    link.download = `proxira-${groupToken}-records-${fileToken}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    pushToast(`导出成功，共 ${payload.total} 条`, "success");
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
    const response = await fetch(withGroupQuery("/_proxira/api/records"), {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("清除历史记录失败");
    }

    const payload = (await response.json()) as { cleared: number };
    records.value = [];
    selectedRecordId.value = null;
    pushToast(`已清除 ${payload.cleared} 条历史记录`, "success");
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "清除历史记录失败", "error");
  } finally {
    clearingRecords.value = false;
  }
};

const resetAllContent = async (): Promise<void> => {
  if (!window.confirm("确认重置所有分组和历史记录吗？该操作不可恢复。")) {
    return;
  }

  resettingAll.value = true;
  try {
    const response = await fetch(`${apiBase}/_proxira/api/reset`, {
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
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "重置失败", "error");
  } finally {
    resettingAll.value = false;
  }
};

onMounted(async () => {
  try {
    await fetchConfig();
    await fetchRecords();
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "初始化失败", "error");
  }

  connectSse();
});

onBeforeUnmount(() => {
  events?.close();
  for (const timer of toastTimers.values()) {
    clearTimeout(timer);
  }
  toastTimers.clear();
});
</script>

<template>
  <main class="dashboard">
    <header class="topbar card">
      <div>
        <p class="kicker">Proxy Inspector</p>
        <h1 class="title">Proxira 管理面板</h1>
      </div>
      <div class="status-group">
        <span class="counter">当前分组：{{ activeGroup?.name ?? "暂无分组" }}</span>
        <span class="counter">{{ groupsCountLabel }}</span>
        <span class="badge" :data-state="connectionState">{{ connectionLabel }}</span>
        <span class="counter">{{ recordsCountLabel }}</span>
      </div>
    </header>

    <section class="action-zone card">
      <div class="action-zone-head">
        <h2 class="section-title">功能操作区</h2>
        <p class="section-desc">分组管理与连接控制统一放在这里。</p>
      </div>
      <div class="action-zone-controls">
        <GroupPicker
          class="action-group-picker"
          :groups="groups"
          :model-value="currentGroupId"
          @update:modelValue="onGroupSelect"
          @request-delete="openDeleteGroupModal"
        />
        <button class="button button-ghost panel-button" type="button" @click="connectSse">重连</button>
        <button class="button button-ghost panel-button" type="button" @click="openCreateGroupModal">
          新增分组
        </button>
        <button class="button button-ghost panel-button" type="button" :disabled="!activeGroup" @click="openEditGroupModal">
          编辑当前分组
        </button>
        <button class="button panel-button button-danger" type="button" :disabled="resettingAll" @click="resetAllContent">
          {{ resettingAll ? "重置中..." : "重置全部" }}
        </button>
      </div>
    </section>

    <section class="workspace">
      <aside class="card list-panel">
        <div class="panel-head">
          <h2 class="section-title">历史请求</h2>
          <div class="panel-actions">
            <span class="panel-meta">最新优先</span>
            <button class="button button-ghost panel-button panel-button-danger" :disabled="clearingRecords" @click="clearRecords">
              {{ clearingRecords ? "清除中..." : "清除" }}
            </button>
            <button class="button button-ghost panel-button" :disabled="exporting" @click="exportRecords">
              {{ exporting ? "导出中..." : "导出 JSON" }}
            </button>
          </div>
        </div>

        <p v-if="!hasRecords" class="empty">还没有请求记录。</p>

        <ul v-else class="record-list">
          <li v-for="record in records" :key="record.id">
            <article
              class="record-item"
              :class="{ active: selectedRecord?.id === record.id }"
              @click="onSelectRecord(record.id)"
            >
              <div class="record-line">
                <span class="method">{{ record.method }}</span>
                <div class="record-actions">
                  <span class="status" :data-error="Boolean(record.error)">
                    {{ record.responseStatus ?? "ERR" }}
                  </span>
                  <button
                    class="record-delete"
                    type="button"
                    :disabled="deletingRecordId === record.id"
                    @click.stop="removeRecord(record.id)"
                  >
                    {{ deletingRecordId === record.id ? "删除中" : "删除" }}
                  </button>
                </div>
              </div>
              <code class="path">{{ record.path }}</code>
              <div class="record-line meta">
                <span>{{ formatDuration(record.durationMs) }}</span>
                <span>{{ formatTime(record.timestamp) }}</span>
              </div>
            </article>
          </li>
        </ul>
      </aside>

      <section class="card detail-panel">
        <header class="detail-toolbar">
          <div class="detail-toolbar-info">
            <p class="detail-toolbar-label">当前分组</p>
            <p class="detail-toolbar-value">
              {{ activeGroup?.name ?? "暂无分组" }}
              <span class="detail-toolbar-target">{{ activeGroup?.targetBaseUrl ?? "-" }}</span>
            </p>
          </div>
        </header>

        <p v-if="!selectedRecord" class="empty">请选择一条请求记录查看详情。</p>

        <template v-else>
          <div class="detail-layout">
            <header class="detail-head">
              <div class="detail-head-row">
                <h2 class="detail-title">{{ selectedRecord.method }} {{ selectedRecord.path }}</h2>
                <div class="detail-head-actions">
                  <button
                    class="mini-button"
                    type="button"
                    @click="copyText('URL', selectedRecord.upstreamUrl)"
                  >
                    复制 URL
                  </button>
                  <button
                    class="mini-button"
                    type="button"
                    @click="copyText('cURL', buildCurlCommand(selectedRecord))"
                  >
                    复制 cURL
                  </button>
                </div>
              </div>
              <div class="chips">
                <span class="chip">状态: {{ detailStatusLabel }}</span>
                <span class="chip">耗时: {{ formatDuration(selectedRecord.durationMs) }}</span>
                <span class="chip">时间: {{ formatTime(selectedRecord.timestamp) }}</span>
              </div>
            </header>

            <div class="detail-split">
              <section class="detail-column">
                <p class="detail-column-title">请求内容</p>

                <article class="detail-card">
                  <div class="detail-card-head">
                    <h3>Query Params</h3>
                    <button
                      class="mini-button"
                      type="button"
                      @click="copyText('Query Params', toPrettyJson(selectedRecord.query))"
                    >
                      复制
                    </button>
                  </div>
                  <JsonPretty class="json-view" :data="selectedRecord.query" />
                </article>

                <article class="detail-card">
                  <div class="detail-card-head">
                    <h3>Request Headers</h3>
                    <button
                      class="mini-button"
                      type="button"
                      @click="copyText('Request Headers', toPrettyJson(selectedRecord.requestHeaders))"
                    >
                      复制
                    </button>
                  </div>
                  <JsonPretty class="json-view" :data="selectedRecord.requestHeaders as ProxyHeaders" />
                </article>

                <article class="detail-card">
                  <div class="detail-card-head">
                    <h3>Request Body</h3>
                    <button
                      class="mini-button"
                      type="button"
                      @click="copyText('Request Body', bodyViewToCopyText(requestBodyView))"
                    >
                      复制
                    </button>
                  </div>
                  <JsonPretty
                    v-if="requestBodyView.mode === 'json'"
                    class="json-view"
                    :data="requestBodyView.jsonData as any"
                  />
                  <pre v-else>{{ requestBodyView.mode === 'text' ? requestBodyView.text : requestBodyView.note }}</pre>
                  <p v-if="requestBodyView.note && requestBodyView.mode !== 'empty'" class="sub-note">
                    {{ requestBodyView.note }}
                  </p>
                </article>

                <article class="detail-card">
                  <div class="detail-card-head">
                    <h3>Upstream</h3>
                    <button
                      class="mini-button"
                      type="button"
                      @click="copyText('Upstream URL', selectedRecord.upstreamUrl)"
                    >
                      复制
                    </button>
                  </div>
                  <pre>{{ selectedRecord.upstreamUrl }}</pre>
                </article>
              </section>

              <section class="detail-column">
                <p class="detail-column-title">响应内容</p>

                <article class="detail-card">
                  <div class="detail-card-head">
                    <h3>Response Headers</h3>
                    <button
                      class="mini-button"
                      type="button"
                      @click="copyText('Response Headers', toPrettyJson(selectedRecord.responseHeaders))"
                    >
                      复制
                    </button>
                  </div>
                  <JsonPretty class="json-view" :data="selectedRecord.responseHeaders as ProxyHeaders" />
                </article>

                <article class="detail-card">
                  <div class="detail-card-head">
                    <h3>Response Body</h3>
                    <button
                      class="mini-button"
                      type="button"
                      @click="copyText('Response Body', bodyViewToCopyText(responseBodyView))"
                    >
                      复制
                    </button>
                  </div>
                  <JsonPretty
                    v-if="responseBodyView.mode === 'json'"
                    class="json-view"
                    :data="responseBodyView.jsonData as any"
                  />
                  <pre v-else>{{ responseBodyView.mode === 'text' ? responseBodyView.text : responseBodyView.note }}</pre>
                  <p v-if="responseBodyView.note && responseBodyView.mode !== 'empty'" class="sub-note">
                    {{ responseBodyView.note }}
                  </p>
                </article>

                <article v-if="selectedRecord.error" class="detail-card detail-error">
                  <div class="detail-card-head">
                    <h3>Error</h3>
                    <button
                      class="mini-button"
                      type="button"
                      @click="copyText('Error', selectedRecord.error)"
                    >
                      复制
                    </button>
                  </div>
                  <pre>{{ selectedRecord.error }}</pre>
                </article>
              </section>
            </div>
          </div>
        </template>
      </section>
    </section>
    <ToastMessages :messages="toastMessages" @dismiss="dismissToast" />
    <GroupFormModal
      :open="groupModalOpen"
      :title="modalTitle"
      :description="modalDesc"
      :submit-text="modalSubmitText"
      :loading="groupModalSubmitting"
      :initial-name="modalGroupName"
      :initial-target-base-url="modalTargetBaseUrl"
      @close="closeGroupModal"
      @submit="submitGroupModal"
    />
    <ConfirmDialog
      :open="deleteGroupModalOpen"
      title="确认删除分组"
      :message="`将删除分组「${pendingDeleteGroup?.name ?? ''}」，并清除该分组下的所有历史请求数据。此操作不可恢复。`"
      confirm-text="确认删除"
      :loading="deleteGroupSubmitting"
      :danger="true"
      @close="closeDeleteGroupModal"
      @confirm="confirmDeleteGroup"
    />
  </main>
</template>
