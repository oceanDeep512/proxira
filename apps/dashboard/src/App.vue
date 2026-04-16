<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from "vue";
import JsonPretty from "vue-json-pretty";
import SimpleBar from "simplebar-vue";
import hljs from "highlight.js";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github.css";

// Register languages
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

// Refs for code blocks to apply highlighting
const requestBodyCodeRef = ref<HTMLElement>();
const responseBodyCodeRef = ref<HTMLElement>();

import GroupPicker from "./components/GroupPicker.vue";
import FilterPicker from "./components/FilterPicker.vue";
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
const resetModalOpen = ref(false);
const toastMessages = ref<Array<{ id: number; text: string; level: "success" | "error" | "info" }>>([]);

let events: EventSource | null = null;
let toastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

type BodyView = {
  mode: "empty" | "binary" | "json" | "xml" | "form-urlencoded" | "html" | "yaml" | "text";
  jsonData: unknown | null;
  text: string;
  note: string;
  truncated: boolean;
};

const BODY_COLLAPSE_THRESHOLD = 4_096;
const METHOD_FILTER_OPTIONS = [
  { value: "ALL", label: "全部请求", hint: "不过滤 Method" },
  { value: "GET", label: "GET", hint: "读取类请求" },
  { value: "POST", label: "POST", hint: "创建类请求" },
  { value: "PUT", label: "PUT", hint: "覆盖更新" },
  { value: "PATCH", label: "PATCH", hint: "局部更新" },
  { value: "DELETE", label: "DELETE", hint: "删除类请求" },
  { value: "OPTIONS", label: "OPTIONS", hint: "预检与能力探测" },
  { value: "HEAD", label: "HEAD", hint: "只看响应头" },
] as const;
const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "全部状态", hint: "不过滤 Status" },
  { value: "2xx", label: "2xx 成功", hint: "请求成功" },
  { value: "3xx", label: "3xx 重定向", hint: "发生跳转" },
  { value: "4xx", label: "4xx 客户端错误", hint: "请求参数问题" },
  { value: "5xx", label: "5xx 服务端错误", hint: "上游异常" },
  { value: "ERROR", label: "ERR 异常", hint: "代理或网络失败" },
] as const;
const SORT_OPTIONS = [
  { value: "time_desc", label: "时间从新到旧", hint: "按请求时间倒序" },
  { value: "time_asc", label: "时间从旧到新", hint: "按请求时间正序" },
  { value: "duration_desc", label: "耗时从高到低", hint: "优先查看慢请求" },
  { value: "duration_asc", label: "耗时从低到高", hint: "优先查看快请求" },
] as const;

type MethodFilter = (typeof METHOD_FILTER_OPTIONS)[number]["value"];
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number]["value"];
type SortMode = (typeof SORT_OPTIONS)[number]["value"];
type StatusTone = "success" | "redirect" | "client" | "server" | "error" | "pending";

const methodFilter = ref<MethodFilter>("ALL");
const statusFilter = ref<StatusFilter>("ALL");
const sortMode = ref<SortMode>("time_desc");
const requestBodyExpanded = ref(false);
const responseBodyExpanded = ref(false);

const filteredRecords = computed(() => {
  let items = records.value.filter((record) => {
    if (methodFilter.value !== "ALL" && record.method !== methodFilter.value) {
      return false;
    }

    const status = record.responseStatus;
    if (statusFilter.value === "ALL") {
      return true;
    }
    if (statusFilter.value === "ERROR") {
      return record.error !== null;
    }
    if (status === null) {
      return false;
    }
    if (statusFilter.value === "2xx") {
      return status >= 200 && status < 300;
    }
    if (statusFilter.value === "3xx") {
      return status >= 300 && status < 400;
    }
    if (statusFilter.value === "4xx") {
      return status >= 400 && status < 500;
    }
    return status >= 500 && status < 600;
  });

  items = [...items];
  if (sortMode.value === "duration_desc") {
    items.sort((left, right) => right.durationMs - left.durationMs);
  } else if (sortMode.value === "duration_asc") {
    items.sort((left, right) => left.durationMs - right.durationMs);
  } else if (sortMode.value === "time_asc") {
    items.sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );
  } else {
    items.sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    );
  }
  return items;
});

const hasRecords = computed(() => filteredRecords.value.length > 0);
const emptyRecordsLabel = computed(() => {
  if (records.value.length === 0) {
    return "还没有请求记录。";
  }
  return "当前筛选条件下没有匹配记录。";
});
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

const activeGroup = computed(() => {
  if (!activeGroupId.value) {
    return groups.value[0] ?? null;
  }
  return groups.value.find((group) => group.id === activeGroupId.value) ?? groups.value[0] ?? null;
});

const currentGroupId = computed(() => activeGroup.value?.id ?? "");
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
const resetConfirmTips = [
  "会删除所有分组配置，仅保留一个默认分组。",
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

// Try to fix truncated JSON by attempting to close unclosed structures
const tryFixTruncatedJson = (text: string): unknown | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Try parsing as-is first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to fix attempts
  }

  // Count unclosed brackets/braces and try to close them
  let stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.length > 0 && stack[stack.length - 1] === expected) {
        stack.pop();
      }
    }
  }

  // If we have unclosed structures, try to close them
  if (stack.length > 0) {
    let fixed = trimmed;

    // If we're inside a string, close it first
    if (inString) {
      fixed += '"';
    }

    // Close all unclosed structures in reverse order
    for (let i = stack.length - 1; i >= 0; i--) {
      fixed += stack[i] === "{" ? "}" : "]";
    }

    try {
      return JSON.parse(fixed);
    } catch {
      // Fix didn't work, return null
    }
  }

  return null;
};

const formatXml = (xmlStr: string): string => {
  let formatted = "";
  let indent = 0;
  const tab = "  ";

  // Remove unnecessary whitespace
  xmlStr = xmlStr.trim().replace(/>\s*</g, "><");

  const tokens = xmlStr.split(/(<[^>]+>)/g).filter((t) => t.trim());

  for (const token of tokens) {
    if (token.match(/^<\//)) {
      // Closing tag
      indent = Math.max(0, indent - 1);
      formatted += tab.repeat(indent) + token + "\n";
    } else if (token.match(/^<[^/][^>]*[^/]>$/) && !token.match(/^<!/)) {
      // Opening tag (not self-closing, not comment/doctype)
      formatted += tab.repeat(indent) + token + "\n";
      indent++;
    } else if (token.match(/^<[^/][^>]*\/>$/) || token.match(/^</)) {
      // Self-closing tag, comment, doctype, etc.
      formatted += tab.repeat(indent) + token + "\n";
    } else {
      // Text content
      formatted += tab.repeat(indent) + token + "\n";
    }
  }

  return formatted.trimEnd();
};

const parseFormUrlEncoded = (text: string): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {};
  const pairs = text.split("&");
  for (const pair of pairs) {
    const [rawKey, rawValue] = pair.split("=", 2);
    if (!rawKey) continue;
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      const value = rawValue !== undefined ? decodeURIComponent(rawValue.replace(/\+/g, " ")) : "";
      const existing = result[key];
      if (existing === undefined) {
        result[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } catch {
      // Skip invalid pairs
    }
  }
  return result;
};

const parseBody = (body: ProxyPayloadBody | null): BodyView => {
  if (!body || body.text === null) {
    if (body?.isBinary) {
      return {
        mode: "binary",
        jsonData: null,
        text: "",
        note: `binary body (${body.size} bytes)`,
        truncated: false,
      };
    }

    return {
      mode: "empty",
      jsonData: null,
      text: "",
      note: "(empty)",
      truncated: false,
    };
  }

  const truncatedNote = body.truncated ? `已截断，原始 ${formatBytes(body.size)}` : "";

  // Prefer the format detected by backend
  switch (body.format) {
    case "json": {
      let jsonData = safeParseJson(body.text);
      // If parsing failed and content was truncated, try to fix truncated JSON
      if (jsonData === null && body.truncated) {
        jsonData = tryFixTruncatedJson(body.text);
      }
      if (jsonData !== null) {
        return {
          mode: "json",
          jsonData,
          text: "",
          note: truncatedNote,
          truncated: body.truncated,
        };
      }
      break;
    }
    case "form-urlencoded": {
      const parsed = parseFormUrlEncoded(body.text);
      if (Object.keys(parsed).length > 0) {
        return {
          mode: "form-urlencoded",
          jsonData: parsed,
          text: "",
          note: truncatedNote,
          truncated: body.truncated,
        };
      }
      break;
    }
    case "xml":
      return {
        mode: "xml",
        jsonData: null,
        text: formatXml(body.text),
        note: truncatedNote,
        truncated: body.truncated,
      };
    case "html":
      return {
        mode: "html",
        jsonData: null,
        text: formatXml(body.text),
        note: truncatedNote,
        truncated: body.truncated,
      };
    case "yaml":
      return {
        mode: "yaml",
        jsonData: null,
        text: body.text,
        note: truncatedNote,
        truncated: body.truncated,
      };
    case "text":
    case "binary":
    default:
      break;
  }

  // Fallback: try to detect again on frontend
  let jsonData = safeParseJson(body.text);
  // If parsing failed and content was truncated, try to fix truncated JSON
  if (jsonData === null && body.truncated) {
    jsonData = tryFixTruncatedJson(body.text);
  }
  if (jsonData !== null) {
    return {
      mode: "json",
      jsonData,
      text: "",
      note: truncatedNote,
      truncated: body.truncated,
    };
  }

  // Try to detect format from content
  const trimmedText = body.text.trimStart();
  let detectedMode: BodyView["mode"] = "text";
  let displayText = body.text;

  if (trimmedText.startsWith("<?xml") || trimmedText.startsWith("<")) {
    const lowerText = trimmedText.toLowerCase();
    if (
      lowerText.includes("<!doctype html") ||
      lowerText.includes("<html") ||
      lowerText.includes("<head") ||
      lowerText.includes("<body")
    ) {
      detectedMode = "html";
    } else {
      detectedMode = "xml";
    }
    displayText = formatXml(body.text);
  } else if (trimmedText.startsWith("---")) {
    detectedMode = "yaml";
  }

  return {
    mode: detectedMode,
    jsonData: null,
    text: displayText,
    note: truncatedNote,
    truncated: body.truncated,
  };
};

// Apply highlighting to code blocks
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

// Watch for record changes and apply highlighting
watch(selectedRecordId, () => {
  applyHighlighting();
});

// Watch for expand/collapse changes
watch([requestBodyExpanded, responseBodyExpanded], () => {
  applyHighlighting();
});

// Also apply highlighting after mount
onMounted(() => {
  applyHighlighting();
});

const requestBodyCollapsible = computed(() => {
  const body = selectedRecord.value?.requestBody ?? null;
  if (!body || body.size <= BODY_COLLAPSE_THRESHOLD) {
    return false;
  }
  const mode = requestBodyView.value.mode;
  return mode === "json" || mode === "text" || mode === "xml" || mode === "html" || mode === "yaml" || mode === "form-urlencoded";
});

const responseBodyCollapsible = computed(() => {
  const body = selectedRecord.value?.responseBody ?? null;
  if (!body || body.size <= BODY_COLLAPSE_THRESHOLD) {
    return false;
  }
  const mode = responseBodyView.value.mode;
  return mode === "json" || mode === "text" || mode === "xml" || mode === "html" || mode === "yaml" || mode === "form-urlencoded";
});

const requestBodyCollapsed = computed(() => requestBodyCollapsible.value && !requestBodyExpanded.value);
const responseBodyCollapsed = computed(
  () => responseBodyCollapsible.value && !responseBodyExpanded.value,
);

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleTimeString();
};

const formatDuration = (durationMs: number): string => `${durationMs} ms`;
const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
};

const toPrettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

const bodyViewToCopyText = (body: BodyView): string => {
  if (body.mode === "json" || body.mode === "form-urlencoded") {
    return toPrettyJson(body.jsonData ?? {});
  }
  if (body.mode === "text" || body.mode === "xml" || body.mode === "html" || body.mode === "yaml") {
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

const normalizeExportPayload = (
  raw: unknown,
  fallback: { groupId: string; groupName: string },
): ProxyRecordsExportResponse => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const exportedAtRaw = typeof source.exportedAt === "string" ? source.exportedAt.trim() : "";
  const exportedAt =
    exportedAtRaw.length > 0 && !Number.isNaN(Date.parse(exportedAtRaw))
      ? exportedAtRaw
      : new Date().toISOString();
  const groupId =
    typeof source.groupId === "string" && source.groupId.trim().length > 0
      ? source.groupId.trim()
      : fallback.groupId;
  const groupName =
    typeof source.groupName === "string" && source.groupName.trim().length > 0
      ? source.groupName.trim()
      : fallback.groupName;
  const items = Array.isArray(source.items) ? (source.items as ProxyTrafficRecord[]) : [];
  const totalRaw = typeof source.total === "number" ? source.total : Number.NaN;
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : items.length;

  return {
    exportedAt,
    groupId,
    groupName,
    total,
    items,
  };
};

const resolveStatusTone = (status: number | null, error: string | null): StatusTone => {
  if (error || status === null) {
    return "error";
  }
  if (status >= 200 && status < 300) {
    return "success";
  }
  if (status >= 300 && status < 400) {
    return "redirect";
  }
  if (status >= 400 && status < 500) {
    return "client";
  }
  if (status >= 500) {
    return "server";
  }
  return "pending";
};

const resetFilters = (): void => {
  methodFilter.value = "ALL";
  statusFilter.value = "ALL";
  sortMode.value = "time_desc";
};

const isMethodFilter = (value: string): value is MethodFilter =>
  METHOD_FILTER_OPTIONS.some((option) => option.value === value);

const isStatusFilter = (value: string): value is StatusFilter =>
  STATUS_FILTER_OPTIONS.some((option) => option.value === value);

const isSortMode = (value: string): value is SortMode =>
  SORT_OPTIONS.some((option) => option.value === value);

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
  if (selectedRecordId.value === recordId) {
    selectedRecordId.value = null;
  }
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

  const response = await fetch(withGroupQuery("/_proxira/api/records?limit=500"));
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
    const query = new URLSearchParams();
    if (methodFilter.value !== "ALL") {
      query.set("method", methodFilter.value);
    }
    if (statusFilter.value === "ERROR") {
      query.set("status", "error");
    } else if (statusFilter.value !== "ALL") {
      query.set("status", statusFilter.value);
    }
    const queryText = query.toString();
    const path = queryText
      ? `/_proxira/api/records/export?${queryText}`
      : "/_proxira/api/records/export";
    const response = await fetch(withGroupQuery(path));
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
      payload.groupName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") ||
      "group";
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
    closeResetModal();
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "重置失败", "error");
  } finally {
    resettingAll.value = false;
  }
};

const requestBodyView = computed(() => parseBody(selectedRecord.value?.requestBody ?? null));
const responseBodyView = computed(() => parseBody(selectedRecord.value?.responseBody ?? null));

onMounted(async () => {
  try {
    await fetchConfig();
    await fetchRecords();
  } catch (error) {
    pushToast(error instanceof Error ? error.message : "初始化失败", "error");
  }

  connectSse();
});

watch(
  () => selectedRecord.value?.id ?? null,
  () => {
    requestBodyExpanded.value = false;
    responseBodyExpanded.value = false;
  },
);

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
        <section class="card group-hub">
          <div class="group-hub-row">
            <GroupPicker
              class="group-hub-picker"
              :groups="groups"
              :model-value="currentGroupId"
              @update:modelValue="onGroupSelect"
              @request-delete="openDeleteGroupModal"
            />
            <div class="group-hub-actions">
              <button
                class="round-icon-button"
                type="button"
                aria-label="新增分组"
                data-tooltip="新增分组"
                @click="openCreateGroupModal"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10.9 4a.9.9 0 1 0-1.8 0v5.1H4a.9.9 0 0 0 0 1.8h5.1V16a.9.9 0 0 0 1.8 0v-5.1H16a.9.9 0 1 0 0-1.8h-5.1V4Z" />
                </svg>
              </button>
              <button
                class="round-icon-button"
                type="button"
                :disabled="!activeGroup"
                aria-label="编辑当前分组"
                data-tooltip="编辑当前分组"
                @click="openEditGroupModal"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M14.7 2.8a2.2 2.2 0 0 1 3.1 3.1L8.4 15.4l-3.6.5.5-3.6 9.4-9.5Zm1.8 1.3a.4.4 0 0 0-.6 0l-1 1 1.9 1.9 1-1a.4.4 0 0 0 0-.6l-1.3-1.3ZM13.6 6.4 6.9 13l-.2 1.2 1.2-.2 6.6-6.7-1.9-1.9Z" />
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
                {{ exporting ? "导出 JSON" : "导出 JSON" }}
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
                    <span class="method">{{ record.method }}</span>
                    <div class="record-actions">
                      <span class="status" :data-tone="resolveStatusTone(record.responseStatus, record.error)">
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
                    <span class="duration">{{ formatDuration(record.durationMs) }}</span>
                    <span>{{ formatTime(record.timestamp) }}</span>
                  </div>
                </article>
              </li>
            </ul>
          </SimpleBar>
        </aside>
      </aside>

      <section class="right-column">
        <section class="action-zone card">
          <div class="action-zone-head">
            <h2 class="section-title">工作区</h2>
          </div>
          <div class="workspace-tools">
            <div class="filter-grid">
              <FilterPicker
                class="filter-picker-item"
                label="Method"
                :options="METHOD_FILTER_OPTIONS"
                :model-value="methodFilter"
                @update:modelValue="updateMethodFilter"
              />
              <FilterPicker
                class="filter-picker-item"
                label="Status"
                :options="STATUS_FILTER_OPTIONS"
                :model-value="statusFilter"
                @update:modelValue="updateStatusFilter"
              />
              <FilterPicker
                class="filter-picker-item"
                label="排序"
                :options="SORT_OPTIONS"
                :model-value="sortMode"
                @update:modelValue="updateSortMode"
              />
            </div>
            <button
              class="filter-reset-button round-icon-button"
              type="button"
              aria-label="重置筛选"
              data-tooltip="重置筛选"
              @click="resetFilters"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M10 2a8 8 0 1 1-7.6 10.5.9.9 0 1 1 1.7-.5A6.2 6.2 0 1 0 5.7 5.2l1.5 1.5a.9.9 0 1 1-1.3 1.3L2.8 5a.9.9 0 0 1 0-1.3l3.1-3.1a.9.9 0 0 1 1.3 1.3L5.7 3.4A8 8 0 0 1 10 2Z"
                />
              </svg>
            </button>
          </div>
        </section>

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
                  <span class="chip chip-status" :data-tone="detailStatusTone">状态: {{ detailStatusLabel }}</span>
                  <span class="chip">耗时: {{ formatDuration(selectedRecord.durationMs) }}</span>
                  <span class="chip">时间: {{ formatTime(selectedRecord.timestamp) }}</span>
                </div>
              </header>

              <div class="detail-split">
                <SimpleBar class="detail-column-scroll">
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
                    <JsonPretty
                      v-if="(requestBodyView.mode === 'json' || requestBodyView.mode === 'form-urlencoded') && !requestBodyCollapsed"
                      class="json-view"
                      :data="requestBodyView.jsonData as any"
                    />
                    <pre v-else-if="requestBodyCollapsed">
                      内容较大（{{ formatBytes(selectedRecord.requestBody.size) }}），已折叠，点击"展开"查看。
                    </pre>
                    <pre
                      v-else-if="requestBodyView.mode === 'xml' || requestBodyView.mode === 'html' || requestBodyView.mode === 'yaml'"
                      ref="requestBodyCodeRef"
                      class="hljs"
                    >{{ requestBodyView.text }}</pre>
                    <pre v-else>{{ (requestBodyView.mode === 'text') ? requestBodyView.text : requestBodyView.note }}</pre>
                    <div v-if="requestBodyView.truncated" class="truncated-warning">
                      <p>内容已被截断，仅显示前 256KB。完整内容大小：{{ formatBytes(selectedRecord.requestBody.size) }}</p>
                    </div>
                    <p v-if="requestBodyView.note && requestBodyView.mode !== 'empty' && !requestBodyView.truncated" class="sub-note">
                      {{ requestBodyView.note }}
                    </p>
                  </article>

                  </section>
                </SimpleBar>

                <SimpleBar class="detail-column-scroll">
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
                    <JsonPretty
                      v-if="(responseBodyView.mode === 'json' || responseBodyView.mode === 'form-urlencoded') && !responseBodyCollapsed"
                      class="json-view"
                      :data="responseBodyView.jsonData as any"
                    />
                    <pre v-else-if="responseBodyCollapsed">
                      内容较大（{{ formatBytes(selectedRecord.responseBody?.size ?? 0) }}），已折叠，点击"展开"查看。
                    </pre>
                    <pre
                      v-else-if="responseBodyView.mode === 'xml' || responseBodyView.mode === 'html' || responseBodyView.mode === 'yaml'"
                      ref="responseBodyCodeRef"
                      class="hljs"
                    >{{ responseBodyView.text }}</pre>
                    <pre v-else>{{ (responseBodyView.mode === 'text') ? responseBodyView.text : responseBodyView.note }}</pre>
                    <div v-if="responseBodyView.truncated" class="truncated-warning">
                      <p>内容已被截断，仅显示前 256KB。完整内容大小：{{ formatBytes(selectedRecord.responseBody?.size ?? 0) }}</p>
                    </div>
                    <p v-if="responseBodyView.note && responseBodyView.mode !== 'empty' && !responseBodyView.truncated" class="sub-note">
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
                </SimpleBar>
              </div>
            </div>
          </template>
        </section>
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
  </main>
</template>
