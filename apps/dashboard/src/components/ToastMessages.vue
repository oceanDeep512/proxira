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
  top: 14px;
  right: 14px;
  z-index: 1000;
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
  border-radius: 10px;
  border: 1px solid #c6d4e6;
  background: #f8fbff;
  color: #1f2a37;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
}

.toast-item[data-level="success"] {
  border-color: #86efac;
  background: #f0fdf4;
}

.toast-item[data-level="error"] {
  border-color: #fda4af;
  background: #fff1f2;
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
  border: 1px solid #c6d4e6;
  background: #ffffff;
  color: #4b5f73;
  font-size: 11px;
  font-weight: 700;
  padding: 0 9px;
  cursor: pointer;
}

.toast-close:hover {
  border-color: #3b82f6;
  color: #1d4ed8;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 180ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (prefers-color-scheme: dark) {
  .toast-item {
    border-color: #2a3442;
    background: #161d27;
    color: #e7edf4;
    box-shadow: 0 14px 36px rgba(2, 6, 23, 0.55);
  }

  .toast-item[data-level="success"] {
    border-color: #166534;
    background: #052e1b;
  }

  .toast-item[data-level="error"] {
    border-color: #7f1d1d;
    background: #3f0d17;
  }

  .toast-close {
    border-color: #334155;
    background: #0f172a;
    color: #a7b8cb;
  }

  .toast-close:hover {
    border-color: #60a5fa;
    color: #93c5fd;
  }
}

@media (max-width: 840px) {
  .toast-host {
    top: 8px;
    right: 8px;
    width: min(360px, calc(100vw - 16px));
  }
}
</style>
