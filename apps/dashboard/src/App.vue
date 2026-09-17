<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import JsonPretty from "vue-json-pretty";
import SimpleBar from "simplebar-vue";
import hljs from "highlight.js";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import "highlight.js/styles/github.css";

import TargetPicker from "./components/TargetPicker.vue";
import RuleManagerModal from "./components/RuleManagerModal.vue";
import ReplayDialog from "./components/ReplayDialog.vue";
import FilterPicker from "./components/FilterPicker.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import TargetFormModal from "./components/TargetFormModal.vue";
import ToastMessages from "./components/ToastMessages.vue";
import type { ProxyGroup, ProxyHeaders, ProxyRule } from "@proxira/core";
import { redactHeaders, redactText } from "./utils/redact.js";
import { useProxira } from "./composables/useProxira.js";
import { useToasts } from "./composables/useToasts.js";
import {
  METHOD_FILTER_OPTIONS,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  filterAndSortRecords,
  isMethodFilter,
  isSortMode,
  isStatusFilter,
  type MethodFilter,
  type SortMode,
  type StatusFilter,
} from "./utils/filters.js";
import {
  bodyCodeClass,
  bodyHasRawSource,
  bodyModeLabel,
  bodyUsesCodeBlock,
  bodyUsesCsvTable,
  bodyUsesJsonTree,
  bodyUsesRichPreview,
  bodyUsesSseEvents,
  bodyViewToCopyText,
  parseBody,
  redactBodyView,
  resolveContentType,
} from "./utils/body.js";
import {
  buildCurlCommand,
  formatBytes,
  formatDuration,
  formatTime,
  resolveStatusTone,
  toPrettyJson,
  type StatusTone,
} from "./utils/format.js";

hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);

type DetailTab =
  | "response-body"
  | "response-headers"
  | "request-body"
  | "request-headers"
  | "query";

const DETAIL_TABS: Array<{ value: DetailTab; label: string }> = [
  { value: "response-body", label: "响应 Body" },
  { value: "response-headers", label: "响应 Headers" },
  { value: "request-body", label: "请求 Body" },
  { value: "request-headers", label: "请求 Headers" },
  { value: "query", label: "Query" },
];

const BODY_COLLAPSE_THRESHOLD = 4_096;

const {
  records,
  recordsTotal,
  recordsLoadingMore,
  targets,
  activeTarget,
  currentTargetId,
  selectedRecordId,
  connectionState,
  deletingRecordId,
  exporting,
  clearingRecords,
  resettingAll,
  targetModalSubmitting,
  deleteTargetSubmitting,
  rules,
  replaying,
  fetchRules,
  saveRule,
  removeRule,
  toggleRule,
  replayRecord,
  fetchConfig,
  fetchRecords,
  loadMoreRecords,
  connectSse,
  switchActiveTarget,
  createTarget,
  saveActiveTarget,
  deleteTarget,
  removeRecord,
  exportRecords: exportRecordsRequest,
  clearRecords,
  resetAll: resetAllRequest,
} = useProxira();

const { toastMessages, pushToast, dismissToast, clearAllToasts } = useToasts();

const requestBodyCodeRef = ref<HTMLElement>();
const responseBodyCodeRef = ref<HTMLElement>();

const methodFilter = ref<MethodFilter>("ALL");
const statusFilter = ref<StatusFilter>("ALL");
const sortMode = ref<SortMode>("time_desc");
const searchText = ref("");
const activeDetailTab = ref<DetailTab>("response-body");
const requestBodyExpanded = ref(false);
const responseBodyExpanded = ref(false);

const targetModalOpen = ref(false);
const targetModalMode = ref<"create" | "edit">("create");
const modalTargetName = ref("");
const modalTargetBaseUrl = ref("");
const modalUpstreamTimeoutMs = ref<number | null>(null);
const deleteTargetModalOpen = ref(false);
const pendingDeleteTarget = ref<ProxyGroup | null>(null);
const resetModalOpen = ref(false);

const filteredRecords = computed(() =>
  filterAndSortRecords(records.value, {
    methodFilter: methodFilter.value,
    statusFilter: statusFilter.value,
    sortMode: sortMode.value,
    searchText: searchText.value,
  }),
);

const hasRecords = computed(() => filteredRecords.value.length > 0);
const hasMoreRecords = computed(() => records.value.length < recordsTotal.value);
const emptyRecordsLabel = computed(() => {
  if (records.value.length === 0) {
    return "还没有请求记录。";
  }
  if (searchText.value.trim()) {
    return `没有匹配「${searchText.value.trim()}」的记录。`;
  }
  return "当前筛选条件下没有匹配记录。";
});

const headerCount = (headers: unknown): number =>
  headers && typeof headers === "object" ? Object.keys(headers).length : 0;

const headerTabCount = (tab: DetailTab): number => {
  if (!selectedRecord.value) {
    return 0;
  }
  if (tab === "response-headers") {
    return headerCount(selectedRecord.value.responseHeaders);
  }
  if (tab === "request-headers") {
    return headerCount(selectedRecord.value.requestHeaders);
  }
  if (tab === "response-body" && responseBodyView.value.mode === "sse") {
    return responseBodyView.value.sseEvents?.length ?? 0;
  }
  return 0;
};

const selectedRecord = computed(() => {
  if (!hasRecords.value) {
    return null;
  }

  if (!selectedRecordId.value) {
    return filteredRecords.value[0];
  }

  return (
    filteredRecords.value.find((record) => record.id === selectedRecordId.value) ??
    filteredRecords.value[0]
  );
});

const connectionLabel = computed(() => {
  if (connectionState.value === "open") return "SSE 已连接";
  if (connectionState.value === "connecting") return "SSE 连接中";
  return "SSE 已断开";
});

const modalTitle = computed(() =>
  targetModalMode.value === "create" ? "新增转发地址" : "编辑当前转发地址",
);
const modalDesc = computed(() =>
  targetModalMode.value === "create"
    ? "请输入新转发地址的名称和唯一地址。创建后不会自动切换，当前请求仍走现有地址。"
    : "修改当前转发地址的名称与地址，地址仍需保持唯一。",
);
const modalSubmitText = computed(() =>
  targetModalMode.value === "create" ? "创建转发地址" : "保存转发地址",
);
const resetConfirmTips = [
  "会删除所有转发地址配置，仅保留一个默认转发地址。",
  "会清空全部历史请求记录。",
  "操作不可撤销，请确认当前数据已无需保留。",
];

const detailStatusLabel = computed(() => {
  if (!selectedRecord.value) {
    return "-";
  }
  return selectedRecord.value.responseStatus ?? "ERR";
});

const detailStatusTone = computed<StatusTone>(() => {
  const record = selectedRecord.value;
  if (!record) {
    return "pending";
  }
  return resolveStatusTone(record.responseStatus, record.error);
});

const rawRequestBodyView = computed(() =>
  parseBody(selectedRecord.value?.requestBody ?? null, selectedRecord.value?.requestHeaders),
);
const rawResponseBodyView = computed(() =>
  parseBody(selectedRecord.value?.responseBody ?? null, selectedRecord.value?.responseHeaders),
);
const requestBodyContentType = computed(() =>
  resolveContentType(selectedRecord.value?.requestHeaders),
);
const responseBodyContentType = computed(() =>
  resolveContentType(selectedRecord.value?.responseHeaders),
);

const applyHighlighting = () => {
  nextTick(() => {
    if (requestBodyCodeRef.value) {
      hljs.highlightElement(requestBodyCodeRef.value);
    }
    if (responseBodyCodeRef.value) {
      hljs.highlightElement(responseBodyCodeRef.value);
    }
  });
};

watch(selectedRecordId, () => {
  applyHighlighting();
});

watch([requestBodyExpanded, responseBodyExpanded], () => {
  applyHighlighting();
});

watch(
  () => selectedRecord.value?.id ?? null,
  () => {
    requestBodyExpanded.value = false;
    responseBodyExpanded.value = false;
  },
);

const requestBodyCollapsible = computed(() => {
  const body = selectedRecord.value?.requestBody ?? null;
  if (!body || body.size <= BODY_COLLAPSE_THRESHOLD) {
    return false;
  }
  return requestBodyView.value.mode !== "empty" && requestBodyView.value.mode !== "binary";
});

const responseBodyCollapsible = computed(() => {
  const body = selectedRecord.value?.responseBody ?? null;
  if (!body || body.size <= BODY_COLLAPSE_THRESHOLD) {
    return false;
  }
  return responseBodyView.value.mode !== "empty" && responseBodyView.value.mode !== "binary";
});

const requestBodyCollapsed = computed(
  () => requestBodyCollapsible.value && !requestBodyExpanded.value,
);
const responseBodyCollapsed = computed(
  () => responseBodyCollapsible.value && !responseBodyExpanded.value,
);

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

const resetFilters = (): void => {
  methodFilter.value = "ALL";
  statusFilter.value = "ALL";
  sortMode.value = "time_desc";
  searchText.value = "";
};

const updateMethodFilter = (value: string): void => {
  if (isMethodFilter(value)) {
    methodFilter.value = value;
  }
};

const updateStatusFilter = (value: string): void => {
  if (isStatusFilter(value)) {
    statusFilter.value = value;
  }
};

const updateSortMode = (value: string): void => {
  if (isSortMode(value)) {
    sortMode.value = value;
  }
};

const onTargetSelect = (nextTargetId: string): void => {
  void switchActiveTarget(nextTargetId);
};

const onSelectRecord = (recordId: string): void => {
  selectedRecordId.value = recordId;
};

const openCreateTargetModal = (): void => {
  targetModalMode.value = "create";
  modalTargetName.value = "";
  modalTargetBaseUrl.value = "";
  modalUpstreamTimeoutMs.value = null;
  targetModalOpen.value = true;
};

const openEditTargetModal = (): void => {
  const target = activeTarget.value;
  if (!target) {
    pushToast("当前没有可编辑的转发地址", "error");
    return;
  }

  targetModalMode.value = "edit";
  modalTargetName.value = target.name;
  modalTargetBaseUrl.value = target.targetBaseUrl;
  modalUpstreamTimeoutMs.value = target.upstreamTimeoutMs ?? null;
  targetModalOpen.value = true;
};

const closeTargetModal = (): void => {
  if (targetModalSubmitting.value) {
    return;
  }
  targetModalOpen.value = false;
};

const submitTargetModal = async (payload: {
  name: string;
  targetBaseUrl: string;
  upstreamTimeoutMs: number | null;
}): Promise<void> => {
  const succeeded =
    targetModalMode.value === "create"
      ? await createTarget(payload.name, payload.targetBaseUrl, payload.upstreamTimeoutMs)
      : await saveActiveTarget(
          payload.name,
          payload.targetBaseUrl,
          payload.upstreamTimeoutMs,
        );
  if (succeeded) {
    targetModalOpen.value = false;
  }
};

const openDeleteTargetModal = (groupId: string): void => {
  const targetEntry = targets.value.find((entry) => entry.id === groupId) ?? null;
  if (!targetEntry) {
    pushToast("转发地址不存在，无法删除", "error");
    return;
  }

  pendingDeleteTarget.value = targetEntry;
  deleteTargetModalOpen.value = true;
};

const closeDeleteTargetModal = (): void => {
  if (deleteTargetSubmitting.value) {
    return;
  }
  deleteTargetModalOpen.value = false;
  pendingDeleteTarget.value = null;
};

const confirmDeleteTarget = async (): Promise<void> => {
  const targetEntry = pendingDeleteTarget.value;
  if (!targetEntry) {
    return;
  }

  const succeeded = await deleteTarget(targetEntry);
  if (succeeded) {
    deleteTargetModalOpen.value = false;
    pendingDeleteTarget.value = null;
  }
};

const exportRecords = (): void => {
  void exportRecordsRequest({
    method: methodFilter.value,
    status: statusFilter.value,
  });
};

const openResetModal = (): void => {
  resetModalOpen.value = true;
};

const closeResetModal = (): void => {
  if (resettingAll.value) {
    return;
  }
  resetModalOpen.value = false;
};

const confirmResetAll = async (): Promise<void> => {
  const succeeded = await resetAllRequest();
  if (succeeded) {
    resetModalOpen.value = false;
  }
};

// ---- 拦截规则与重放 ----------------------------------------------------
const rulesModalOpen = ref(false);
const replayModalOpen = ref(false);
const replayDialogRef = ref<InstanceType<typeof ReplayDialog> | null>(null);

const openRulesModal = (): void => {
  rulesModalOpen.value = true;
  void fetchRules().catch(() => pushToast("加载规则失败", "error"));
};

const closeRulesModal = (): void => {
  rulesModalOpen.value = false;
};

const onCreateRule = async (payload: Record<string, unknown>): Promise<void> => {
  await saveRule(payload);
};

const onUpdateRule = async (payload: {
  id: string;
  patch: Record<string, unknown>;
}): Promise<void> => {
  await saveRule(payload.patch, payload.id);
};

const openReplayModal = (): void => {
  if (!selectedRecord.value) {
    pushToast("请先选择一条请求记录", "error");
    return;
  }
  replayModalOpen.value = true;
};

const closeReplayModal = (): void => {
  replayModalOpen.value = false;
};

const submitReplay = async (payload: {
  method: string;
  url: string;
  headersText: string;
  body: string;
}): Promise<void> => {
  const headers: Record<string, string> = {};
  for (const line of payload.headersText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }
    headers[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  const result = await replayRecord({
    method: payload.method,
    url: payload.url,
    headers,
    body: payload.body,
  });
  if (result) {
    replayDialogRef.value?.setResult(result);
  }
};

// ---- 敏感信息脱敏 ------------------------------------------------------
const showSensitive = ref(false);

const requestBodyView = computed(() =>
  showSensitive.value ? rawRequestBodyView.value : redactBodyView(rawRequestBodyView.value),
);
const responseBodyView = computed(() =>
  showSensitive.value ? rawResponseBodyView.value : redactBodyView(rawResponseBodyView.value),
);
const displayRequestHeaders = computed<ProxyHeaders>(() =>
  showSensitive.value
    ? (selectedRecord.value?.requestHeaders ?? {})
    : redactHeaders(selectedRecord.value?.requestHeaders ?? {}),
);
const curlCommand = computed(() => {
  const record = selectedRecord.value;
  if (!record) {
    return "";
  }
  return buildCurlCommand({
    ...record,
    requestHeaders: displayRequestHeaders.value,
    ...(record.requestBody.text
      ? {
          requestBody: {
            ...record.requestBody,
            text: showSensitive.value ? record.requestBody.text : redactText(record.requestBody.text),
          },
        }
      : {}),
  });
});
const displayResponseHeaders = computed<ProxyHeaders>(() =>
  showSensitive.value
    ? (selectedRecord.value?.responseHeaders ?? {})
    : redactHeaders(selectedRecord.value?.responseHeaders ?? {}),
);

onMounted(async () => {
  try {
    await fetchConfig();
    await fetchRecords();
    await fetchRules();
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "初始化失败", "error");
  }

  connectSse();
});

onBeforeUnmount(() => {
  clearAllToasts();
});
</script>

<template>
  <main class="dashboard">
    <header class="topbar card">
      <div class="topbar-brand">
        <div class="title-row">
          <h1 class="title">Proxira 管理面板</h1>
          <p class="title-note">轻量级实时代理观测面板</p>
        </div>
      </div>
      <div class="status-group">
        <span class="badge" :data-state="connectionState">{{ connectionLabel }}</span>
        <div class="status-actions">
          <button class="button button-ghost topbar-action-button" type="button" @click="connectSse">重连</button>
          <button class="button button-danger topbar-action-button" type="button" :disabled="resettingAll" @click="openResetModal">
            {{ resettingAll ? "重置中..." : "重置全部" }}
          </button>
        </div>
      </div>
    </header>

    <section class="workspace">
      <aside class="left-column">
        <section class="card target-hub">
          <div class="target-hub-row">
            <TargetPicker
              class="target-hub-picker"
              :targets="targets"
              :model-value="currentTargetId"
              @update:modelValue="onTargetSelect"
            />
            <div class="target-hub-actions">
              <button
                class="round-icon-button"
                type="button"
                aria-label="新增转发地址"
                data-tooltip="新增转发地址"
                @click="openCreateTargetModal"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10.9 4a.9.9 0 1 0-1.8 0v5.1H4a.9.9 0 0 0 0 1.8h5.1V16a.9.9 0 0 0 1.8 0v-5.1H16a.9.9 0 1 0 0-1.8h-5.1V4Z" />
                </svg>
              </button>
              <button
                class="round-icon-button"
                type="button"
                :disabled="!activeTarget"
                aria-label="编辑当前转发地址"
                data-tooltip="编辑当前转发地址"
                @click="openEditTargetModal"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M14.7 2.8a2.2 2.2 0 0 1 3.1 3.1L8.4 15.4l-3.6.5.5-3.6 9.4-9.5Zm1.8 1.3a.4.4 0 0 0-.6 0l-1 1 1.9 1.9 1-1a.4.4 0 0 0 0-.6l-1.3-1.3ZM13.6 6.4 6.9 13l-.2 1.2 1.2-.2 6.6-6.7-1.9-1.9Z" />
                </svg>
              </button>
              <button
                class="round-icon-button"
                type="button"
                data-tone="danger"
                :disabled="!activeTarget"
                aria-label="删除当前转发地址"
                data-tooltip="删除当前转发地址"
                @click="openDeleteTargetModal(currentTargetId)"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M7.5 2.5h5l.8 1.5H17a.9.9 0 1 1 0 1.8h-.9l-.7 10.2a1.8 1.8 0 0 1-1.8 1.7H6.4a1.8 1.8 0 0 1-1.8-1.7L3.9 5.8H3a.9.9 0 1 1 0-1.8h3.7l.8-1.5Zm-1.8 3.3.7 10.1h7.2l.7-10.1H5.7Zm2.1 1.6c.5 0 .9.4.9.9v5a.9.9 0 1 1-1.8 0v-5c0-.5.4-.9.9-.9Zm4.4 0c.5 0 .9.4.9.9v5a.9.9 0 1 1-1.8 0v-5c0-.5.4-.9.9-.9Z" />
                </svg>
              </button>
              <span class="target-hub-divider" aria-hidden="true"></span>
              <button
                class="round-icon-button"
                type="button"
                aria-label="拦截规则"
                data-tooltip="拦截规则（Mock / 故障注入）"
                @click="openRulesModal"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M3 5.5 10 2l7 3.5v5c0 4.2-2.9 6.6-7 7.5-4.1-.9-7-3.3-7-7.5v-5Zm3.2 4.6 2.4 2.4 4.2-4.6-1.3-1.2-2.9 3.2-1.1-1.1-1.3 1.3Z" />
                </svg>
              </button>
              <button
                class="round-icon-button"
                type="button"
                :aria-label="showSensitive ? '隐藏敏感信息' : '显示敏感信息'"
                :data-tooltip="showSensitive ? '已显示敏感信息' : '已脱敏显示'"
                @click="showSensitive = !showSensitive"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 4c4 0 7 2.6 8.3 6-1.3 3.4-4.3 6-8.3 6s-7-2.6-8.3-6C2.3 6.6 5.3 4 9.3 4H10Zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        <aside class="card list-panel">
          <div class="panel-head">
            <h2 class="section-title">历史请求</h2>
            <div class="panel-actions">
              <button class="button button-ghost panel-button panel-button-danger" :disabled="clearingRecords" @click="clearRecords">
                {{ clearingRecords ? "清除中..." : "清除" }}
              </button>
              <button class="button button-ghost panel-button" :disabled="exporting" @click="exportRecords">
                {{ exporting ? "导出中..." : "导出 JSON" }}
              </button>
            </div>
          </div>

          <div class="list-tools">
            <input
              v-model="searchText"
              class="list-search"
              type="search"
              placeholder="搜索 path…"
              aria-label="按路径搜索请求"
            />
            <div class="list-filter-row">
              <FilterPicker
                class="list-filter-item"
                label="Method"
                compact
                :options="METHOD_FILTER_OPTIONS"
                :model-value="methodFilter"
                @update:modelValue="updateMethodFilter"
              />
              <FilterPicker
                class="list-filter-item"
                label="Status"
                compact
                :options="STATUS_FILTER_OPTIONS"
                :model-value="statusFilter"
                @update:modelValue="updateStatusFilter"
              />
              <FilterPicker
                class="list-filter-item"
                label="排序"
                compact
                :options="SORT_OPTIONS"
                :model-value="sortMode"
                @update:modelValue="updateSortMode"
              />
              <button
                class="list-filter-reset round-icon-button"
                type="button"
                aria-label="重置筛选"
                data-tooltip="重置筛选"
                :disabled="methodFilter === 'ALL' && statusFilter === 'ALL' && sortMode === 'time_desc' && !searchText"
                @click="resetFilters"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M10 2a8 8 0 1 1-7.6 10.5.9.9 0 1 1 1.7-.5A6.2 6.2 0 1 0 5.7 5.2l1.5 1.5a.9.9 0 1 1-1.3 1.3L2.8 5a.9.9 0 0 1 0-1.3l3.1-3.1a.9.9 0 0 1 1.3 1.3L5.7 3.4A8 8 0 0 1 10 2Z"
                  />
                </svg>
              </button>
            </div>
          </div>

          <p v-if="!hasRecords" class="empty">{{ emptyRecordsLabel }}</p>

          <SimpleBar v-else class="record-list-scroll">
            <ul class="record-list">
              <li v-for="record in filteredRecords" :key="record.id">
                <article
                  class="record-item"
                  :class="{ active: selectedRecord?.id === record.id }"
                  @click="onSelectRecord(record.id)"
                >
                  <div class="record-line">
                    <span class="method" :data-method="record.method">{{ record.method }}</span>
                    <code class="path" :title="record.path">{{ record.path }}</code>
                    <span class="status" :data-tone="resolveStatusTone(record.responseStatus, record.error)">
                      {{ record.responseStatus ?? "ERR" }}
                    </span>
                    <button
                      class="record-delete"
                      type="button"
                      aria-label="删除该条记录"
                      :disabled="deletingRecordId === record.id"
                      @click.stop="removeRecord(record.id)"
                    >
                      {{ deletingRecordId === record.id ? "…" : "✕" }}
                    </button>
                  </div>
                  <div class="record-line meta">
                    <span class="duration">{{ formatDuration(record.durationMs) }}</span>
                    <span>{{ formatTime(record.timestamp) }}</span>
                    <span v-if="record.source === 'replay'" class="record-tag" title="由重放产生">重放</span>
                    <span
                      v-else-if="record.appliedRuleId"
                      class="record-tag"
                      data-tone="rule"
                      title="命中了拦截规则"
                    >规则</span>
                  </div>
                </article>
              </li>
            </ul>
          </SimpleBar>

          <button
            v-if="hasMoreRecords"
            class="list-load-more"
            type="button"
            :disabled="recordsLoadingMore"
            @click="loadMoreRecords"
          >
            {{ recordsLoadingMore ? "加载中..." : `加载更多（已显示 ${records.length} / ${recordsTotal}）` }}
          </button>
        </aside>
      </aside>

      <section class="right-column">
        <section class="card detail-panel">
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
                      :disabled="replaying"
                      @click="openReplayModal"
                    >
                      {{ replaying ? "重放中..." : "重放请求" }}
                    </button>
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
                      @click="copyText('cURL', curlCommand)"
                    >
                      复制 cURL
                    </button>
                  </div>
                </div>
                <div class="chips">
                  <span class="chip chip-status" :data-tone="detailStatusTone">状态: {{ detailStatusLabel }}</span>
                  <span class="chip">耗时: {{ formatDuration(selectedRecord.durationMs) }}</span>
                  <span class="chip">时间: {{ formatTime(selectedRecord.timestamp) }}</span>
                </div>
              </header>

              <nav class="detail-tabs" role="tablist" aria-label="请求详情分区">
                <button
                  v-for="tab in DETAIL_TABS"
                  :key="tab.value"
                  class="detail-tab"
                  :class="{ active: activeDetailTab === tab.value }"
                  type="button"
                  role="tab"
                  :aria-selected="activeDetailTab === tab.value"
                  @click="activeDetailTab = tab.value"
                >
                  {{ tab.label }}
                  <span v-if="headerTabCount(tab.value) > 0" class="detail-tab-count">{{ headerTabCount(tab.value) }}</span>
                </button>
              </nav>

              <SimpleBar class="detail-body-scroll">
                <section class="detail-column">
                  <article v-if="activeDetailTab === 'query'" class="detail-card">
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

                  <article v-if="activeDetailTab === 'request-headers'" class="detail-card">
                    <div class="detail-card-head">
                      <h3>Request Headers</h3>
                      <button
                        class="mini-button"
                        type="button"
                        @click="copyText('Request Headers', toPrettyJson(displayRequestHeaders))"
                      >
                        复制
                      </button>
                    </div>
                    <JsonPretty class="json-view" :data="displayRequestHeaders as ProxyHeaders" />
                  </article>

                  <article v-if="activeDetailTab === 'request-body'" class="detail-card">
                    <div class="detail-card-head">
                      <div class="detail-card-title">
                        <h3>Request Body</h3>
                        <span class="format-badge">{{ bodyModeLabel(requestBodyView) }}</span>
                        <span v-if="requestBodyContentType" class="content-type-chip">{{ requestBodyContentType }}</span>
                      </div>
                      <div class="detail-card-actions">
                        <button
                          class="mini-button"
                          type="button"
                          @click="copyText('Request Body', bodyViewToCopyText(requestBodyView))"
                        >
                          复制
                        </button>
                        <button
                          v-if="requestBodyCollapsible"
                          class="mini-button"
                          type="button"
                          @click="requestBodyExpanded = !requestBodyExpanded"
                        >
                          {{ requestBodyCollapsed ? "展开" : "折叠" }}
                        </button>
                      </div>
                    </div>
                    <pre v-if="requestBodyCollapsed">
                      内容较大（{{ formatBytes(selectedRecord.requestBody.size) }}），已折叠，点击"展开"查看。
                    </pre>
                    <div
                      v-else-if="bodyUsesSseEvents(requestBodyView)"
                      class="sse-events"
                    >
                      <article
                        v-for="(evt, evtIndex) in requestBodyView.sseEvents ?? []"
                        :key="`sse-req-${evtIndex}`"
                        class="sse-event"
                      >
                        <div class="sse-event-head">
                          <span class="sse-event-index">{{ evtIndex + 1 }}</span>
                          <span class="sse-event-name" :class="{ 'is-message': evt.event === 'message' }">{{ evt.event }}</span>
                          <span v-if="evt.id" class="sse-event-id">id: {{ evt.id }}</span>
                        </div>
                        <JsonPretty
                          v-if="evt.jsonData !== null"
                          class="json-view"
                          :data="evt.jsonData as any"
                        />
                        <pre v-else class="sse-event-raw">{{ evt.data }}</pre>
                      </article>
                    </div>
                    <JsonPretty
                      v-else-if="bodyUsesJsonTree(requestBodyView)"
                      class="json-view"
                      :data="requestBodyView.jsonData as any"
                    />
                    <div v-else-if="bodyUsesCsvTable(requestBodyView)" class="table-view">
                      <div class="table-wrap">
                        <table class="payload-table">
                          <thead>
                            <tr>
                              <th v-for="(header, headerIndex) in requestBodyView.csvTable?.headers ?? []" :key="`req-header-${headerIndex}`">
                                {{ header || `Column ${headerIndex + 1}` }}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(row, rowIndex) in requestBodyView.csvTable?.rows ?? []" :key="`req-row-${rowIndex}`">
                              <td v-for="(cell, cellIndex) in row" :key="`req-cell-${rowIndex}-${cellIndex}`">
                                {{ cell }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p
                        v-if="(requestBodyView.csvTable?.totalRows ?? 0) > (requestBodyView.csvTable?.visibleRows ?? 0)"
                        class="sub-note table-note"
                      >
                        仅展示前 {{ requestBodyView.csvTable?.visibleRows ?? 0 }} 行，完整行数 {{ requestBodyView.csvTable?.totalRows ?? 0 }}。
                      </p>
                    </div>
                    <div v-else-if="bodyUsesRichPreview(requestBodyView)" class="rich-preview-wrap">
                      <div class="rich-preview" v-html="requestBodyView.previewHtml"></div>
                      <details class="raw-source">
                        <summary>查看原始内容</summary>
                        <pre
                          ref="requestBodyCodeRef"
                          class="hljs"
                          :class="bodyCodeClass(requestBodyView)"
                        >{{ requestBodyView.text }}</pre>
                      </details>
                    </div>
                    <pre
                      v-else-if="bodyUsesCodeBlock(requestBodyView)"
                      ref="requestBodyCodeRef"
                      class="hljs"
                      :class="bodyCodeClass(requestBodyView)"
                    >{{ requestBodyView.text }}</pre>
                    <pre v-else>{{ (requestBodyView.mode === 'text') ? requestBodyView.text : requestBodyView.note }}</pre>
                    <details
                      v-if="!requestBodyCollapsed && bodyHasRawSource(requestBodyView)"
                      class="raw-source"
                    >
                      <summary>查看原始内容</summary>
                      <pre>{{ requestBodyView.text }}</pre>
                    </details>
                    <div v-if="requestBodyView.truncated" class="truncated-warning">
                      <p>内容存在截断标记。记录大小：{{ formatBytes(selectedRecord.requestBody.size) }}</p>
                    </div>
                    <p v-if="requestBodyView.note && requestBodyView.mode !== 'empty' && !requestBodyView.truncated" class="sub-note">
                      {{ requestBodyView.note }}
                    </p>
                  </article>

                  <article v-if="activeDetailTab === 'response-headers'" class="detail-card">
                    <div class="detail-card-head">
                      <h3>Response Headers</h3>
                      <button
                        class="mini-button"
                        type="button"
                        @click="copyText('Response Headers', toPrettyJson(displayResponseHeaders))"
                      >
                        复制
                      </button>
                    </div>
                    <JsonPretty class="json-view" :data="displayResponseHeaders as ProxyHeaders" />
                  </article>

                  <article v-if="activeDetailTab === 'response-body'" class="detail-card">
                    <div class="detail-card-head">
                      <div class="detail-card-title">
                        <h3>Response Body</h3>
                        <span class="format-badge">{{ bodyModeLabel(responseBodyView) }}</span>
                        <span v-if="responseBodyContentType" class="content-type-chip">{{ responseBodyContentType }}</span>
                      </div>
                      <div class="detail-card-actions">
                        <button
                          class="mini-button"
                          type="button"
                          @click="copyText('Response Body', bodyViewToCopyText(responseBodyView))"
                        >
                          复制
                        </button>
                        <button
                          v-if="responseBodyCollapsible"
                          class="mini-button"
                          type="button"
                          @click="responseBodyExpanded = !responseBodyExpanded"
                        >
                          {{ responseBodyCollapsed ? "展开" : "折叠" }}
                        </button>
                      </div>
                    </div>
                    <pre v-if="responseBodyCollapsed">
                      内容较大（{{ formatBytes(selectedRecord.responseBody?.size ?? 0) }}），已折叠，点击"展开"查看。
                    </pre>
                    <div
                      v-else-if="bodyUsesSseEvents(responseBodyView)"
                      class="sse-events"
                    >
                      <p v-if="responseBodyView.truncated" class="sub-note sse-truncated-note">
                        流较长，仅采样了前部分事件，完整内容请用上游日志核对。
                      </p>
                      <article
                        v-for="(evt, evtIndex) in responseBodyView.sseEvents ?? []"
                        :key="`sse-resp-${evtIndex}`"
                        class="sse-event"
                      >
                        <div class="sse-event-head">
                          <span class="sse-event-index">{{ evtIndex + 1 }}</span>
                          <span class="sse-event-name" :class="{ 'is-message': evt.event === 'message' }">{{ evt.event }}</span>
                          <span v-if="evt.id" class="sse-event-id">id: {{ evt.id }}</span>
                        </div>
                        <JsonPretty
                          v-if="evt.jsonData !== null"
                          class="json-view"
                          :data="evt.jsonData as any"
                        />
                        <pre v-else class="sse-event-raw">{{ evt.data }}</pre>
                      </article>
                    </div>
                    <JsonPretty
                      v-else-if="bodyUsesJsonTree(responseBodyView)"
                      class="json-view"
                      :data="responseBodyView.jsonData as any"
                    />
                    <div v-else-if="bodyUsesCsvTable(responseBodyView)" class="table-view">
                      <div class="table-wrap">
                        <table class="payload-table">
                          <thead>
                            <tr>
                              <th
                                v-for="(header, headerIndex) in responseBodyView.csvTable?.headers ?? []"
                                :key="`resp-header-${headerIndex}`"
                              >
                                {{ header || `Column ${headerIndex + 1}` }}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="(row, rowIndex) in responseBodyView.csvTable?.rows ?? []" :key="`resp-row-${rowIndex}`">
                              <td v-for="(cell, cellIndex) in row" :key="`resp-cell-${rowIndex}-${cellIndex}`">
                                {{ cell }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p
                        v-if="(responseBodyView.csvTable?.totalRows ?? 0) > (responseBodyView.csvTable?.visibleRows ?? 0)"
                        class="sub-note table-note"
                      >
                        仅展示前 {{ responseBodyView.csvTable?.visibleRows ?? 0 }} 行，完整行数 {{ responseBodyView.csvTable?.totalRows ?? 0 }}。
                      </p>
                    </div>
                    <div v-else-if="bodyUsesRichPreview(responseBodyView)" class="rich-preview-wrap">
                      <div class="rich-preview" v-html="responseBodyView.previewHtml"></div>
                      <details class="raw-source">
                        <summary>查看原始内容</summary>
                        <pre
                          ref="responseBodyCodeRef"
                          class="hljs"
                          :class="bodyCodeClass(responseBodyView)"
                        >{{ responseBodyView.text }}</pre>
                      </details>
                    </div>
                    <pre
                      v-else-if="bodyUsesCodeBlock(responseBodyView)"
                      ref="responseBodyCodeRef"
                      class="hljs"
                      :class="bodyCodeClass(responseBodyView)"
                    >{{ responseBodyView.text }}</pre>
                    <pre v-else>{{ (responseBodyView.mode === 'text') ? responseBodyView.text : responseBodyView.note }}</pre>
                    <details
                      v-if="!responseBodyCollapsed && bodyHasRawSource(responseBodyView)"
                      class="raw-source"
                    >
                      <summary>查看原始内容</summary>
                      <pre>{{ responseBodyView.text }}</pre>
                    </details>
                    <div v-if="responseBodyView.truncated" class="truncated-warning">
                      <p>内容存在截断标记。记录大小：{{ formatBytes(selectedRecord.responseBody?.size ?? 0) }}</p>
                    </div>
                    <p v-if="responseBodyView.note && responseBodyView.mode !== 'empty' && !responseBodyView.truncated" class="sub-note">
                      {{ responseBodyView.note }}
                    </p>
                  </article>

                  <article v-if="activeDetailTab === 'response-body' && selectedRecord.error" class="detail-card detail-error">
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
              </SimpleBar>
            </div>
          </template>
        </section>
      </section>
    </section>

    <ToastMessages :messages="toastMessages" @dismiss="dismissToast" />
    <TargetFormModal
      :open="targetModalOpen"
      :title="modalTitle"
      :description="modalDesc"
      :submit-text="modalSubmitText"
      :loading="targetModalSubmitting"
      :initial-name="modalTargetName"
      :initial-target-base-url="modalTargetBaseUrl"
      :initial-upstream-timeout-ms="modalUpstreamTimeoutMs"
      @close="closeTargetModal"
      @submit="submitTargetModal"
    />
    <ConfirmDialog
      :open="deleteTargetModalOpen"
      title="确认删除转发地址"
      :message="`将删除转发地址「${pendingDeleteTarget?.name ?? ''}」，并清除该转发地址下的所有历史请求数据。此操作不可恢复。`"
      confirm-text="确认删除"
      :loading="deleteTargetSubmitting"
      :danger="true"
      @close="closeDeleteTargetModal"
      @confirm="confirmDeleteTarget"
    />
    <ConfirmDialog
      :open="resetModalOpen"
      title="确认重置全部内容"
      message="重置后将立即恢复到初始状态。"
      :tips="resetConfirmTips"
      confirm-text="确认重置"
      :loading="resettingAll"
      :danger="true"
      @close="closeResetModal"
      @confirm="confirmResetAll"
    />
    <RuleManagerModal
      :open="rulesModalOpen"
      :rules="rules"
      :loading="false"
      @close="closeRulesModal"
      @create="onCreateRule"
      @update="onUpdateRule"
      @remove="(id: string) => removeRule(id)"
      @toggle="(rule: ProxyRule) => toggleRule(rule)"
    />
    <ReplayDialog
      ref="replayDialogRef"
      :open="replayModalOpen"
      :record="selectedRecord"
      :loading="replaying"
      :redact="!showSensitive"
      @close="closeReplayModal"
      @submit="submitReplay"
    />
  </main>
</template>
