<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  tips?: string[];
  confirmText: string;
  loading: boolean;
  danger?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const closeDialog = (): void => {
  if (props.loading) {
    return;
  }
  emit("close");
};

const onOverlayClick = (event: MouseEvent): void => {
  if (event.target === event.currentTarget) {
    closeDialog();
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="open" class="confirm-overlay" @click="onOverlayClick">
        <div class="confirm-card" role="dialog" aria-modal="true" :aria-label="title">
          <h3 class="confirm-title">{{ title }}</h3>
          <div class="confirm-body">
            <p class="confirm-message">{{ message }}</p>
            <ul v-if="tips?.length" class="confirm-tips">
              <li v-for="tip in tips" :key="tip" class="confirm-tip-item">{{ tip }}</li>
            </ul>
          </div>
          <div class="confirm-actions">
            <button class="confirm-button confirm-button-ghost" type="button" :disabled="loading" @click="closeDialog">
              取消
            </button>
            <button
              class="confirm-button"
              :class="{ danger }"
              type="button"
              :disabled="loading"
              @click="emit('confirm')"
            >
              {{ loading ? "处理中..." : confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1210;
  background: color-mix(in srgb, var(--text) 24%, transparent);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  padding: 16px;
}

.confirm-card {
  width: min(480px, 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-flat), var(--shadow-soft);
  padding: 16px;
  display: grid;
  gap: 12px;
}

.confirm-title {
  margin: 0;
  font-size: 18px;
}

.confirm-body {
  display: grid;
  gap: 8px;
}

.confirm-message {
  margin: 0;
  font-size: 13px;
  color: var(--text-soft);
  line-height: 1.45;
}

.confirm-tips {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.confirm-tip-item {
  font-size: 12px;
  color: var(--text);
  line-height: 1.4;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--error) 30%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--error) 8%, var(--surface-soft));
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-button {
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

.confirm-button:hover {
  transform: translateY(-1px);
  filter: brightness(1.03);
}

.confirm-button:disabled {
  opacity: 0.72;
  cursor: default;
  transform: none;
}

.confirm-button-ghost {
  border-color: var(--line);
  background: var(--surface-soft);
  color: var(--text);
}

.confirm-button.danger {
  border-color: color-mix(in srgb, var(--error) 60%, var(--line));
  background: color-mix(in srgb, var(--error) 16%, var(--surface));
  color: color-mix(in srgb, var(--error) 85%, var(--text));
}

.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 150ms ease;
}

.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

@media (max-width: 840px) {
  .confirm-actions {
    flex-direction: column-reverse;
  }

  .confirm-button {
    width: 100%;
  }
}
</style>
