<script setup lang="ts">
import { computed, ref, watch } from "vue";

type TargetFormPayload = {
  name: string;
  targetBaseUrl: string;
  upstreamTimeoutMs: number | null;
};

const props = defineProps<{
  open: boolean;
  title: string;
  description: string;
  submitText: string;
  loading: boolean;
  initialName: string;
  initialTargetBaseUrl: string;
  initialUpstreamTimeoutMs: number | null;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: TargetFormPayload];
}>();

const name = ref("");
const targetBaseUrl = ref("");
const timeoutMs = ref("");

const canSubmit = computed(() => {
  return !props.loading && name.value.trim().length > 0 && targetBaseUrl.value.trim().length > 0;
});

const syncFormFromProps = (): void => {
  name.value = props.initialName;
  targetBaseUrl.value = props.initialTargetBaseUrl;
  timeoutMs.value =
    props.initialUpstreamTimeoutMs && props.initialUpstreamTimeoutMs > 0
      ? String(props.initialUpstreamTimeoutMs)
      : "";
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      syncFormFromProps();
    }
  },
);

watch(
  () => [props.initialName, props.initialTargetBaseUrl, props.initialUpstreamTimeoutMs] as const,
  () => {
    if (props.open) {
      syncFormFromProps();
    }
  },
);

const closeModal = (): void => {
  if (props.loading) {
    return;
  }
  emit("close");
};

const onOverlayClick = (event: MouseEvent): void => {
  if (event.target === event.currentTarget) {
    closeModal();
  }
};

const onSubmit = (): void => {
  if (!canSubmit.value) {
    return;
  }

  // Vue's v-model on <input type="number"> already casts the value with
  // looseToNumber, so timeoutMs can hold a number once the user types into
  // the field. Normalize through String() first or .trim() would throw.
  const rawTimeout = String(timeoutMs.value ?? "").trim();
  const parsedTimeout = Number(rawTimeout);
  const upstreamTimeoutMs =
    rawTimeout.length > 0 && Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? Math.floor(parsedTimeout)
      : null;

  emit("submit", {
    name: name.value.trim(),
    targetBaseUrl: targetBaseUrl.value.trim(),
    upstreamTimeoutMs,
  });
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="modal-overlay" @click="onOverlayClick">
        <div class="modal-card" role="dialog" aria-modal="true" :aria-label="title">
          <header class="modal-head">
            <h2 class="modal-title">{{ title }}</h2>
            <button class="modal-close" type="button" @click="closeModal">关闭</button>
          </header>

          <p class="modal-desc">{{ description }}</p>

          <div class="modal-field">
            <label class="modal-label">名称</label>
            <input
              v-model="name"
              class="modal-input"
              type="text"
              placeholder="请输入名称（必填）"
            />
          </div>

          <div class="modal-field">
            <label class="modal-label">转发地址</label>
            <input
              v-model="targetBaseUrl"
              class="modal-input"
              type="text"
              placeholder="请输入 http/https 地址（必填且唯一）"
            />
          </div>

          <div class="modal-field">
            <label class="modal-label">上游超时（毫秒，留空用全局默认）</label>
            <input
              v-model="timeoutMs"
              class="modal-input"
              type="number"
              min="1"
              placeholder="例如 60000"
            />
          </div>

          <footer class="modal-actions">
            <button class="modal-button modal-button-ghost" type="button" :disabled="loading" @click="closeModal">
              取消
            </button>
            <button class="modal-button" type="button" :disabled="!canSubmit" @click="onSubmit">
              {{ loading ? "处理中..." : submitText }}
            </button>
          </footer>
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
}

.modal-card {
  width: min(520px, 100%);
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
  transition: border-color 140ms ease, color 140ms ease;
}

.modal-close:hover {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--line));
  color: var(--accent-strong);
}

.modal-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
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
  min-height: 40px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13px;
  padding: 0 12px;
  outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}

.modal-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  background: color-mix(in srgb, var(--accent) 4%, var(--surface-soft));
}

.modal-actions {
  margin-top: 4px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-button {
  min-height: 36px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #f8fbff;
  font-size: 13px;
  font-weight: 600;
  padding: 0 14px;
  cursor: pointer;
  transition: transform 130ms ease, filter 130ms ease;
}

.modal-button:hover {
  transform: translateY(-1px);
  filter: brightness(1.03);
}

.modal-button:disabled {
  opacity: 0.72;
  cursor: default;
  transform: none;
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

@media (max-width: 840px) {
  .modal-card {
    padding: 12px;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .modal-button {
    width: 100%;
  }
}
</style>
