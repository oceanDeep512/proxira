<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ProxyRule, ProxyRuleActionType } from "@proxira/core";

type RuleDraft = {
  name: string;
  matchPath: string;
  matchMethod: string;
  action: ProxyRuleActionType;
  delayMs: string;
  status: string;
  body: string;
  stream: boolean;
  chunkIntervalMs: string;
  message: string;
  afterChunks: string;
  keepBytes: string;
};

const props = defineProps<{
  open: boolean;
  rules: ProxyRule[];
  loading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  create: [payload: Record<string, unknown>];
  update: [payload: { id: string; patch: Record<string, unknown> }];
  remove: [id: string];
  toggle: [rule: ProxyRule];
}>();

const ACTION_LABELS: Record<ProxyRuleActionType, string> = {
  mock: "Mock 响应",
  error: "模拟错误",
  delay: "仅延迟",
  break_stream: "流式中断",
  truncate: "响应截断",
};

const emptyDraft = (): RuleDraft => ({
  name: "",
  matchPath: "/",
  matchMethod: "",
  action: "mock",
  delayMs: "0",
  status: "200",
  body: '{"ok":true}',
  stream: false,
  chunkIntervalMs: "120",
  message: "Simulated upstream failure.",
  afterChunks: "2",
  keepBytes: "1024",
});

const draft = ref<RuleDraft>(emptyDraft());
const editingId = ref<string | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = emptyDraft();
      editingId.value = null;
    }
  },
);

// Picking "模拟错误" while the status is still the mock default would silently
// return 200, so nudge it to a status that actually looks like a failure.
watch(
  () => draft.value.action,
  (action) => {
    if (action === "error" && draft.value.status === "200") {
      draft.value.status = "500";
    }
  },
);

const startEdit = (rule: ProxyRule): void => {
  editingId.value = rule.id;
  draft.value = {
    name: rule.name,
    matchPath: rule.matchPath,
    matchMethod: rule.matchMethod ?? "",
    action: rule.action,
    delayMs: String(rule.delayMs),
    status: String(rule.status),
    body: rule.body,
    stream: rule.stream,
    chunkIntervalMs: String(rule.chunkIntervalMs),
    message: rule.message,
    afterChunks: String(rule.afterChunks),
    keepBytes: String(rule.keepBytes),
  };
};

const cancelEdit = (): void => {
  editingId.value = null;
  draft.value = emptyDraft();
};

const buildPayload = (): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    name: draft.value.name.trim() || "未命名规则",
    matchPath: draft.value.matchPath.trim() || "/",
    matchMethod: draft.value.matchMethod.trim()
      ? draft.value.matchMethod.trim().toUpperCase()
      : null,
    action: draft.value.action,
    delayMs: Number(draft.value.delayMs) || 0,
    status: Number(draft.value.status) || 200,
    body: draft.value.body,
    stream: draft.value.stream,
    chunkIntervalMs: Number(draft.value.chunkIntervalMs) || 0,
    message: draft.value.message,
    afterChunks: Number(draft.value.afterChunks) || 0,
    keepBytes: Number(draft.value.keepBytes) || 0,
  };
  return payload;
};

const onSubmit = (): void => {
  if (editingId.value) {
    emit("update", { id: editingId.value, patch: buildPayload() });
  } else {
    emit("create", buildPayload());
  }
  cancelEdit();
};

const canSubmit = computed(() => draft.value.matchPath.trim().length > 0);
const actionHint = computed(() => {
  switch (draft.value.action) {
    case "mock":
      return draft.value.stream
        ? "按空行拆分 body，逐块以 SSE 形式下发"
        : "直接返回预设状态码与 body，不打上游";
    case "error":
      return "直接以指定状态码失败，不请求上游";
    case "delay":
      return "正常转发，但先延迟指定毫秒";
    case "break_stream":
      return "流式响应下发指定块数后直接断开（模拟连接中断）";
    case "truncate":
      return "响应超过指定字节数后截断";
    default:
      return "";
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-label="拦截规则">
          <header class="modal-head">
            <h2 class="modal-title">拦截规则（Mock / 故障注入）</h2>
            <button class="modal-close" type="button" @click="emit('close')">关闭</button>
          </header>

          <p class="modal-desc">
            命中的请求按规则处理，用来复现超时、断流、5xx 等平时碰不到的场景；禁用后立即恢复真实转发。
          </p>

          <div class="rule-list">
            <p v-if="rules.length === 0" class="rule-empty">还没有规则，先在下面添加一条。</p>
            <div v-for="rule in rules" :key="rule.id" class="rule-row" :class="{ disabled: !rule.enabled }">
              <button
                class="rule-switch"
                type="button"
                :aria-label="rule.enabled ? '停用规则' : '启用规则'"
                @click="emit('toggle', rule)"
              >
                {{ rule.enabled ? "启用" : "停用" }}
              </button>
              <div class="rule-main">
                <strong>{{ rule.name }}</strong>
                <span class="rule-meta">
                  {{ ACTION_LABELS[rule.action] }} · 匹配 “{{ rule.matchPath }}”
                  <template v-if="rule.matchMethod"> · {{ rule.matchMethod }}</template>
                  <template v-if="rule.delayMs > 0"> · 延迟 {{ rule.delayMs }}ms</template>
                </span>
              </div>
              <button class="rule-action" type="button" @click="startEdit(rule)">编辑</button>
              <button class="rule-action danger" type="button" @click="emit('remove', rule.id)">删除</button>
            </div>
          </div>

          <div class="rule-form">
            <h3 class="rule-form-title">{{ editingId ? "编辑规则" : "新增规则" }}</h3>

            <div class="rule-grid">
              <label class="modal-field">
                <span class="modal-label">名称</span>
                <input v-model="draft.name" class="modal-input" placeholder="例如：SSE 第 2 块断流" />
              </label>
              <label class="modal-field">
                <span class="modal-label">匹配路径（包含）</span>
                <input v-model="draft.matchPath" class="modal-input" placeholder="/v1/chat" />
              </label>
              <label class="modal-field">
                <span class="modal-label">方法（留空=全部）</span>
                <input v-model="draft.matchMethod" class="modal-input" placeholder="POST" />
              </label>
              <label class="modal-field">
                <span class="modal-label">动作</span>
                <select v-model="draft.action" class="modal-input">
                  <option v-for="(label, key) in ACTION_LABELS" :key="key" :value="key">{{ label }}</option>
                </select>
              </label>
              <label class="modal-field">
                <span class="modal-label">延迟（毫秒）</span>
                <input v-model="draft.delayMs" class="modal-input" type="number" min="0" />
              </label>
              <label v-if="draft.action === 'mock' || draft.action === 'error'" class="modal-field">
                <span class="modal-label">状态码</span>
                <input v-model="draft.status" class="modal-input" type="number" min="100" max="599" />
              </label>
              <label v-if="draft.action === 'break_stream'" class="modal-field">
                <span class="modal-label">第几块后断开</span>
                <input v-model="draft.afterChunks" class="modal-input" type="number" min="0" />
              </label>
              <label v-if="draft.action === 'truncate'" class="modal-field">
                <span class="modal-label">保留字节数</span>
                <input v-model="draft.keepBytes" class="modal-input" type="number" min="0" />
              </label>
              <label v-if="draft.action === 'error'" class="modal-field">
                <span class="modal-label">错误信息</span>
                <input v-model="draft.message" class="modal-input" />
              </label>
            </div>

            <template v-if="draft.action === 'mock'">
              <label class="modal-field">
                <span class="modal-label">响应 Body</span>
                <textarea v-model="draft.body" class="modal-input modal-textarea" rows="4" />
              </label>
              <div class="rule-inline">
                <label class="rule-check">
                  <input v-model="draft.stream" type="checkbox" />
                  以 SSE 流式下发
                </label>
                <label v-if="draft.stream" class="modal-field rule-inline-field">
                  <span class="modal-label">块间隔（毫秒）</span>
                  <input v-model="draft.chunkIntervalMs" class="modal-input" type="number" min="0" />
                </label>
              </div>
            </template>

            <p class="modal-desc">{{ actionHint }}</p>

            <div class="rule-form-actions">
              <button v-if="editingId" class="modal-button modal-button-ghost" type="button" @click="cancelEdit">
                取消编辑
              </button>
              <button class="modal-button" type="button" :disabled="!canSubmit || loading" @click="onSubmit">
                {{ editingId ? "保存修改" : "添加规则" }}
              </button>
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
  gap: 10px;
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
  font-weight: 600;
  padding: 0 10px;
  cursor: pointer;
}

.modal-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}

.rule-list {
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}

.rule-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}

.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  background: var(--surface-soft);
}

.rule-row.disabled {
  opacity: 0.6;
}

.rule-switch {
  min-height: 24px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 700;
  padding: 0 8px;
  cursor: pointer;
}

.rule-main {
  flex: 1;
  min-width: 0;
  display: grid;
}

.rule-main strong {
  font-size: 12px;
}

.rule-meta {
  font-size: 11px;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-action {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-soft);
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
}

.rule-action.danger {
  color: var(--error);
}

.rule-form {
  border-top: 1px solid var(--line);
  padding-top: 10px;
  display: grid;
  gap: 8px;
}

.rule-form-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}

.rule-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
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
  min-height: 70px;
  padding: 8px 10px;
  font-family: var(--font-mono, ui-monospace, monospace);
  resize: vertical;
}

.rule-inline {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rule-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-soft);
}

.rule-inline-field {
  min-width: 140px;
}

.rule-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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

.modal-button-ghost {
  border-color: var(--line);
  background: var(--surface-soft);
  color: var(--text);
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
