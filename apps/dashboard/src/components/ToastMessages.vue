<script setup lang="ts">
type ToastLevel = "success" | "error" | "info";

type ToastMessage = {
  id: number;
  text: string;
  level: ToastLevel;
};

defineProps<{
  messages: ToastMessage[];
}>();

const emit = defineEmits<{
  dismiss: [id: number];
}>();
</script>

<template>
  <Teleport to="body">
    <TransitionGroup class="toast-host" tag="ol" name="toast" aria-live="polite" aria-atomic="false">
      <li v-for="message in messages" :key="message.id" class="toast-item" :data-level="message.level">
        <p class="toast-text">{{ message.text }}</p>
        <button class="toast-close" type="button" @click="emit('dismiss', message.id)">关闭</button>
      </li>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1400;
  width: min(360px, calc(100vw - 20px));
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  pointer-events: auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-flat), var(--shadow-soft);
}

.toast-item[data-level="success"] {
  border-color: color-mix(in srgb, var(--success) 52%, var(--line));
  background: color-mix(in srgb, var(--success) 8%, var(--surface));
}

.toast-item[data-level="error"] {
  border-color: color-mix(in srgb, var(--error) 52%, var(--line));
  background: color-mix(in srgb, var(--error) 8%, var(--surface));
}

.toast-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  word-break: break-word;
}

.toast-close {
  min-height: 24px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 11px;
  font-weight: 600;
  padding: 0 9px;
  cursor: pointer;
  transition: border-color 130ms ease, color 130ms ease;
}

.toast-close:hover {
  border-color: color-mix(in srgb, var(--accent) 58%, var(--line));
  color: var(--accent-strong);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 840px) {
  .toast-host {
    top: 8px;
    right: 8px;
    width: min(360px, calc(100vw - 16px));
  }
}
</style>
