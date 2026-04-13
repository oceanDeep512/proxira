<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
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
          <p class="confirm-message">{{ message }}</p>
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
  background: rgba(15, 23, 42, 0.44);
  display: grid;
  place-items: center;
  padding: 16px;
}

.confirm-card {
  width: min(460px, 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  padding: 14px;
  display: grid;
  gap: 10px;
}

.confirm-title {
  margin: 0;
  font-size: 16px;
}

.confirm-message {
  margin: 0;
  font-size: 13px;
  color: var(--text-soft);
  line-height: 1.45;
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
  font-weight: 700;
  padding: 0 14px;
  cursor: pointer;
}

.confirm-button:disabled {
  opacity: 0.72;
  cursor: default;
}

.confirm-button-ghost {
  border-color: var(--line);
  background: var(--panel-soft);
  color: var(--text);
}

.confirm-button.danger {
  border-color: color-mix(in srgb, var(--error) 60%, var(--line));
  background: color-mix(in srgb, var(--error) 16%, var(--panel));
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
