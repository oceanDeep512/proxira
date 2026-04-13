<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ProxyGroup } from "@proxira/core";

const props = defineProps<{
  groups: ProxyGroup[];
  modelValue: string;
  allowDelete?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
  "request-delete": [id: string];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

const activeGroup = computed(() => {
  if (!props.modelValue) {
    return props.groups[0] ?? null;
  }
  return props.groups.find((group) => group.id === props.modelValue) ?? props.groups[0] ?? null;
});

const toggle = (): void => {
  if (props.groups.length === 0) {
    return;
  }
  open.value = !open.value;
};

const close = (): void => {
  open.value = false;
};

const selectGroup = (groupId: string): void => {
  if (groupId !== props.modelValue) {
    emit("update:modelValue", groupId);
  }
  close();
};

const requestDelete = (): void => {
  if (props.allowDelete === false) {
    return;
  }
  const groupId = activeGroup.value?.id;
  if (!groupId) {
    return;
  }
  close();
  emit("request-delete", groupId);
};

const handlePointerDown = (event: MouseEvent): void => {
  if (!open.value || !rootRef.value) {
    return;
  }
  const target = event.target as Node | null;
  if (target && !rootRef.value.contains(target)) {
    close();
  }
};

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key === "Escape") {
    close();
  }
};

onMounted(() => {
  document.addEventListener("mousedown", handlePointerDown);
  document.addEventListener("keydown", handleKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handlePointerDown);
  document.removeEventListener("keydown", handleKeyDown);
});
</script>

<template>
  <div ref="rootRef" class="group-picker">
    <div class="group-trigger-wrap">
      <button
        class="group-trigger"
        type="button"
        :aria-expanded="open"
        aria-haspopup="listbox"
        @click="toggle"
      >
        <span class="group-trigger-main">
          <span class="group-name">{{ activeGroup?.name ?? "暂无分组" }}</span>
          <span class="group-target">{{ activeGroup?.targetBaseUrl ?? "-" }}</span>
        </span>
        <span class="group-arrow" :class="{ open }">▾</span>
      </button>
      <button
        v-if="allowDelete !== false && activeGroup"
        class="group-delete"
        type="button"
        title="删除当前分组"
        aria-label="删除当前分组"
        @click.stop="requestDelete"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M7.5 2.5h5l.8 1.5H17a.9.9 0 1 1 0 1.8h-.9l-.7 10.2a1.8 1.8 0 0 1-1.8 1.7H6.4a1.8 1.8 0 0 1-1.8-1.7L3.9 5.8H3a.9.9 0 1 1 0-1.8h3.7l.8-1.5Zm-1.8 3.3.7 10.1h7.2l.7-10.1H5.7Zm2.1 1.6c.5 0 .9.4.9.9v5a.9.9 0 1 1-1.8 0v-5c0-.5.4-.9.9-.9Zm4.4 0c.5 0 .9.4.9.9v5a.9.9 0 1 1-1.8 0v-5c0-.5.4-.9.9-.9Z"
          />
        </svg>
      </button>
    </div>

    <Transition name="picker-fade">
      <ul v-if="open" class="group-panel" role="listbox">
        <li v-for="group in groups" :key="group.id">
          <button
            class="group-option"
            type="button"
            role="option"
            :aria-selected="group.id === modelValue"
            :class="{ active: group.id === modelValue }"
            @click="selectGroup(group.id)"
          >
            <span class="group-option-name">{{ group.name }}</span>
            <span class="group-option-target">{{ group.targetBaseUrl }}</span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.group-picker {
  position: relative;
  width: 100%;
}

.group-trigger {
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-soft);
  color: var(--text);
  padding: 7px 42px 7px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  text-align: left;
  cursor: pointer;
}

.group-trigger-wrap {
  position: relative;
}

.group-trigger:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
}

.group-trigger:focus-visible {
  outline: 3px solid var(--accent-soft);
  outline-offset: 1px;
}

.group-trigger-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.group-name {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
}

.group-target {
  min-width: 0;
  font-size: 11px;
  line-height: 1.2;
  color: var(--text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-arrow {
  font-size: 12px;
  color: var(--text-soft);
  transition: transform 120ms ease;
}

.group-arrow.open {
  transform: rotate(180deg);
}

.group-delete {
  position: absolute;
  top: 50%;
  right: 22px;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.group-delete:hover {
  border-color: color-mix(in srgb, var(--error) 45%, var(--line));
  color: var(--error);
  background: color-mix(in srgb, var(--error) 10%, transparent);
}

.group-delete:focus-visible {
  outline: 3px solid var(--accent-soft);
  outline-offset: 1px;
}

.group-delete svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.group-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 12;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel);
  box-shadow: var(--shadow);
  max-height: 240px;
  overflow: auto;
}

.group-option {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 8px;
  text-align: left;
  display: grid;
  gap: 2px;
  cursor: pointer;
}

.group-option:hover {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--line));
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
}

.group-option.active {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
}

.group-option-name {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.group-option-target {
  font-size: 11px;
  color: var(--text-soft);
  line-height: 1.25;
  word-break: break-all;
}

.picker-fade-enter-active,
.picker-fade-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.picker-fade-enter-from,
.picker-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
