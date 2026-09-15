<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ProxyTrafficRecord } from "@proxira/core";
import type { ReplayResult } from "../composables/useProxira.js";
import { diffLines, diffStats, collapseUnchanged } from "../utils/diff.js";
import { redactText } from "../utils/redact.js";

const props = defineProps<{
  open: boolean;
  record: ProxyTrafficRecord | null;
  loading: boolean;
  redact: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: { method: string; url: string; headersText: string; body: string }];
}>();

const method = ref("GET");
const url = ref("");
const headersText = ref("");
const body = ref("");
const result = ref<ReplayResult | null>(null);

watch(
  () => [props.open, props.record?.id] as const,
  () => {
    if (!props.open || !props.record) {
      return;
    }
    method.value = props.record.method;
    url.value = props.record.upstreamUrl;
    headersText.value = Object.entries(props.record.requestHeaders)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\n");
    body.value = props.record.requestBody.text ?? "";
    result.value = null;
  },
);

const originalBody = computed(() => props.record?.responseBody?.text ?? "");
const replayBody = computed(() => result.value?.body ?? "");

const diffRows = computed(() => {
  if (!result.value) {
    return [];
  }
  const before = props.redact ? redactText(originalBody.value) : originalBody.value;
  const after = props.redact ? redactText(replayBody.value) : replayBody.value;
  return collapseUnchanged(diffLines(before, after));
});

const stats = computed(() => diffStats(diffLines(originalBody.value, replayBody.value)));

const statusTone = computed(() => {
  const status = result.value?.status ?? null;
  if (status === null) return "error";
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "ok";
});

const onSubmit = (): void => {
  emit("submit", {
    method: method.value,
    url: url.value,
    headersText: headersText.value,
    body: body.value,
  });
};

defineExpose({
  setResult: (value: ReplayResult | null) => {
    result.value = value;
  },
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-label="重放请求">
          <header class="modal-head">
            <h2 class="modal-title">重放请求</h2>
            <button class="modal-close" type="button" @click="emit('close')">关闭</button>
          </header>

          <p class="modal-desc">直接向上游重发这条请求，可先修改内容；响应会与新记录一并入历史。</p>

          <div class="replay-grid">
            <label class="modal-field">
              <span class="modal-label">Method</span>
              <input v-model="method" class="modal-input" />
            </label>
            <label class="modal-field replay-url">
              <span class="modal-label">URL</span>
              <input v-model="url" class="modal-input" />
            </label>
          </div>

          <label class="modal-field">
            <span class="modal-label">Headers（每行一个 name: value）</span>
            <textarea v-model="headersText" class="modal-input modal-textarea" rows="3" />
          </label>

          <label class="modal-field">
            <span class="modal-label">Body</span>
            <textarea v-model="body" class="modal-input modal-textarea" rows="5" />
          </label>

          <div class="rule-form-actions">
            <button class="modal-button" type="button" :disabled="loading" @click="onSubmit">
              {{ loading ? "发送中..." : "发送并重放" }}
            </button>
          </div>

          <div v-if="result" class="replay-result">
            <div class="replay-status">
              <span class="badge" :data-tone="statusTone">
                {{ result.ok ? `${result.status}` : "失败" }}
              </span>
              <span class="replay-meta">{{ result.durationMs }} ms</span>
              <span v-if="result.error" class="replay-error">{{ result.error }}</span>
              <span v-else class="replay-meta">
                差异：+{{ stats.added }} / -{{ stats.removed }} 行
              </span>
            </div>

            <div class="diff">
              <template v-for="(row, index) in diffRows" :key="index">
                <div v-if="'count' in row" class="diff-line skip">… 省略 {{ row.count }} 行未变更</div>
                <div v-else class="diff-line" :data-type="row.type">
                  <span class="diff-sign">
                    {{ row.type === "add" ? "+" : row.type === "del" ? "-" : " " }}
                  </span>
                  <span class="diff-text">{{ row.text }}</span>
                </div>
              </template>
              <p v-if="diffRows.length === 0" class="replay-meta">两次响应完全一致。</p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: color-mix(in srgb, var(--text) 24%, transparent);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  padding: 16px;
  overflow: auto;
}

.modal-card-wide {
  width: min(760px, 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-flat), var(--shadow-soft);
  padding: 14px;
  display: grid;
  gap: 10px;
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.modal-close {
  min-height: 30px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 12px;
  padding: 0 10px;
  cursor: pointer;
}

.modal-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}

.replay-grid {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 8px;
}

.modal-field {
  display: grid;
  gap: 6px;
}

.modal-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-soft);
}

.modal-input {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13px;
  padding: 0 10px;
  outline: none;
}

.modal-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.modal-textarea {
  min-height: 60px;
  padding: 8px 10px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  resize: vertical;
}

.rule-form-actions {
  display: flex;
  justify-content: flex-end;
}

.modal-button {
  min-height: 34px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #f8fbff;
  font-size: 13px;
  font-weight: 600;
  padding: 0 14px;
  cursor: pointer;
}

.modal-button:disabled {
  opacity: 0.72;
  cursor: default;
}

.replay-result {
  border-top: 1px solid var(--line);
  padding-top: 10px;
  display: grid;
  gap: 8px;
}

.replay-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.badge {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 700;
}

.badge[data-tone="ok"] {
  background: color-mix(in srgb, var(--success, #2f855a) 18%, transparent);
  color: var(--success, #2f855a);
}

.badge[data-tone="warn"] {
  background: color-mix(in srgb, var(--warning, #b7791f) 20%, transparent);
  color: var(--warning, #b7791f);
}

.badge[data-tone="error"] {
  background: color-mix(in srgb, var(--error) 18%, transparent);
  color: var(--error);
}

.replay-meta {
  font-size: 12px;
  color: var(--text-soft);
}

.replay-error {
  font-size: 12px;
  color: var(--error);
}

.diff {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  padding: 6px 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}

.diff-line {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 6px;
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-line[data-type="add"] {
  background: color-mix(in srgb, var(--success, #2f855a) 12%, transparent);
  color: var(--success, #2f855a);
}

.diff-line[data-type="del"] {
  background: color-mix(in srgb, var(--error) 12%, transparent);
  color: var(--error);
}

.diff-line.skip {
  color: var(--text-soft);
  font-style: italic;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 150ms ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
