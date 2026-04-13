<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import JsonPretty from "vue-json-pretty";
import type {
  ProxyConfig,
  ProxyHeaders,
  ProxyPayloadBody,
  ProxyRecordsExportResponse,
  ProxyRecordsResponse,
  ProxySseEvent,
  ProxyTrafficRecord,
} from "@proxira/core";

const apiBase =
  (import.meta.env.VITE_PROXY_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

const targetBaseUrl = ref("");
const records = ref<ProxyTrafficRecord[]>([]);
const selectedRecordId = ref<string | null>(null);
const deletingRecordId = ref<string | null>(null);
const connectionState = ref<"connecting" | "open" | "closed">("connecting");
const saving = ref(false);
const exporting = ref(false);
const message = ref("");

let events: EventSource | null = null;

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

const recordsCountLabel = computed(() => `${records.value.length} 条`);
const connectionLabel = computed(() => {
  if (connectionState.value === "open") return "SSE 已连接";
  if (connectionState.value === "connecting") return "SSE 连接中";
  return "SSE 已断开";
});

const detailStatusLabel = computed(() => {
  if (!selectedRecord.value) {
    return "-";
  }
  return selectedRecord.value.responseStatus ?? "ERR";
});

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

const copyText = async (label: string, text: string): Promise<void> => {
  if (!text) {
    message.value = `${label} 为空`;
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    message.value = `已复制 ${label}`;
  } catch {
    message.value = `复制 ${label} 失败，请检查浏览器权限`;
  }
};

const syncConfig = (config: ProxyConfig): void => {
  targetBaseUrl.value = config.targetBaseUrl;
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
    syncConfig(event.config);
    return;
  }

  if (event.type === "record") {
    pushRecord(event.record);
    return;
  }

  if (event.type === "record_deleted") {
    removeRecordLocal(event.id);
    return;
  }

  if (event.type === "records_cleared") {
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
  const response = await fetch(`${apiBase}/_proxira/api/records`);
  if (!response.ok) {
    throw new Error("加载历史记录失败");
  }

  const payload = (await response.json()) as ProxyRecordsResponse;
  records.value = payload.items;
  if (payload.items.length > 0 && !selectedRecordId.value) {
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

const saveTarget = async (): Promise<void> => {
  saving.value = true;
  message.value = "";

  try {
    const response = await fetch(`${apiBase}/_proxira/api/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetBaseUrl: targetBaseUrl.value }),
    });

    if (!response.ok) {
      throw new Error("保存失败，请检查地址格式。");
    }

    const config = (await response.json()) as ProxyConfig;
    syncConfig(config);
    message.value = "保存成功";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "保存失败";
  } finally {
    saving.value = false;
  }
};

const onSelectRecord = (recordId: string): void => {
  selectedRecordId.value = recordId;
};

const removeRecord = async (recordId: string): Promise<void> => {
  deletingRecordId.value = recordId;
  try {
    const response = await fetch(`${apiBase}/_proxira/api/records/${recordId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("删除失败");
    }
    removeRecordLocal(recordId);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "删除失败";
  } finally {
    deletingRecordId.value = null;
  }
};

const exportRecords = async (): Promise<void> => {
  exporting.value = true;
  message.value = "";

  try {
    const response = await fetch(`${apiBase}/_proxira/api/records/export`);
    if (!response.ok) {
      throw new Error("导出失败");
    }

    const payload = (await response.json()) as ProxyRecordsExportResponse;
    const jsonText = toPrettyJson(payload);
    const blob = new Blob([jsonText], { type: "application/json; charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileToken = payload.exportedAt.replace(/[:.]/g, "-");
    link.href = objectUrl;
    link.download = `proxira-records-${fileToken}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    message.value = `导出成功，共 ${payload.total} 条`;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "导出失败";
  } finally {
    exporting.value = false;
  }
};

onMounted(async () => {
  try {
    await Promise.all([fetchConfig(), fetchRecords()]);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "初始化失败";
  }

  connectSse();
});

onBeforeUnmount(() => {
  events?.close();
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
        <span class="badge" :data-state="connectionState">{{ connectionLabel }}</span>
        <span class="counter">{{ recordsCountLabel }}</span>
      </div>
    </header>

    <section class="controls">
      <article class="card control-card">
        <h2 class="section-title">真实转发地址</h2>
        <p class="section-desc">所有请求会转发到此地址。</p>
        <div class="control-row">
          <input
            v-model="targetBaseUrl"
            class="input"
            type="text"
            placeholder="http://localhost:8080"
          />
          <button class="button" :disabled="saving" @click="saveTarget">
            {{ saving ? "保存中..." : "保存配置" }}
          </button>
        </div>
        <p v-if="message" class="hint">{{ message }}</p>
      </article>

      <article class="card control-card compact">
        <h2 class="section-title">连接控制</h2>
        <p class="section-desc">SSE 实时推送请求记录。</p>
        <button class="button button-ghost" @click="connectSse">重连 SSE</button>
      </article>
    </section>

    <section class="workspace">
      <aside class="card list-panel">
        <div class="panel-head">
          <h2 class="section-title">历史请求</h2>
          <div class="panel-actions">
            <span class="panel-meta">最新优先</span>
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
  </main>
</template>
