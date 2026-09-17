<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { CSSProperties } from "vue";
import type { ProxyGroup } from "@proxira/core";

const props = defineProps<{
  targets: ProxyGroup[];
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
}>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const panelStyle = ref<CSSProperties>({});
const panelPlacement = ref<"below" | "above">("below");

const hasTargets = computed(() => props.targets.length > 0);

const activeTarget = computed(() => {
  if (!props.modelValue) {
    return props.targets[0] ?? null;
  }
  return (
    props.targets.find((entry) => entry.id === props.modelValue) ??
    props.targets[0] ??
    null
  );
});

const updatePanelPosition = (): void => {
  const trigger = triggerRef.value;
  if (!open.value || !trigger) {
    return;
  }

  const rect = trigger.getBoundingClientRect();
  const viewportPadding = 8;
  const gap = 7;

  const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - width - viewportPadding,
  );

  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const spaceAbove = rect.top - viewportPadding;
  const showAbove = spaceBelow < 180 && spaceAbove > spaceBelow;

  panelPlacement.value = showAbove ? "above" : "below";
  panelStyle.value = {
    left: `${left}px`,
    top: `${showAbove ? Math.max(viewportPadding, rect.top - gap) : rect.bottom + gap}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(120, showAbove ? spaceAbove - gap : spaceBelow - gap)}px`,
  };
};

const bindViewportListeners = (): void => {
  window.addEventListener("resize", updatePanelPosition);
  window.addEventListener("scroll", updatePanelPosition, true);
};

const unbindViewportListeners = (): void => {
  window.removeEventListener("resize", updatePanelPosition);
  window.removeEventListener("scroll", updatePanelPosition, true);
};

watch(open, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    updatePanelPosition();
    bindViewportListeners();
    return;
  }
  unbindViewportListeners();
});

const toggle = (): void => {
  if (!hasTargets.value) {
    return;
  }
  open.value = !open.value;
};

const close = (): void => {
  open.value = false;
};

const selectTarget = (targetId: string): void => {
  if (targetId !== props.modelValue) {
    emit("update:modelValue", targetId);
  }
  close();
};

const handlePointerDown = (event: MouseEvent): void => {
  if (!open.value) {
    return;
  }
  const target = event.target as Node | null;
  if (!target) {
    return;
  }
  if (rootRef.value?.contains(target) || panelRef.value?.contains(target)) {
    return;
  }
  close();
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
  unbindViewportListeners();
});
</script>

<template>
  <div ref="rootRef" class="target-picker" :class="{ open }">
    <div class="target-trigger-wrap">
      <button
        ref="triggerRef"
        class="target-trigger"
        :class="{ disabled: !hasTargets }"
        type="button"
        :aria-expanded="open"
        aria-haspopup="listbox"
        :disabled="!hasTargets"
        @click="toggle"
      >
        <span class="target-trigger-main">
          <span class="target-prefix">当前转发地址</span>
          <span class="target-name">{{ activeTarget?.name ?? "暂无转发地址" }}</span>
          <span class="target-target">{{
            activeTarget?.targetBaseUrl ?? "-"
          }}</span>
        </span>
        <span class="target-arrow" :class="{ open }" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path
              d="M5.2 7.6a.9.9 0 0 1 1.3 0L10 11.1l3.5-3.5a.9.9 0 1 1 1.3 1.3l-4.1 4.1a.9.9 0 0 1-1.3 0L5.2 8.9a.9.9 0 0 1 0-1.3Z"
            />
          </svg>
        </span>
      </button>
    </div>

    <Teleport to="body">
      <Transition name="picker-fade">
        <ul
          v-if="open"
          ref="panelRef"
          class="target-panel target-panel-layer"
          :class="{ 'is-above': panelPlacement === 'above' }"
          :style="panelStyle"
          role="listbox"
        >
          <li v-for="target in targets" :key="target.id">
            <button
              class="target-option"
              type="button"
              role="option"
              :aria-selected="target.id === modelValue"
              :class="{ active: target.id === modelValue }"
              @click="selectTarget(target.id)"
            >
              <span class="target-option-main">
                <span class="target-option-name">{{ target.name }}</span>
                <span class="target-option-target">{{
                  target.targetBaseUrl
                }}</span>
              </span>
              <span
                v-if="target.id === modelValue"
                class="target-option-check"
                aria-hidden="true"
                >✓</span
              >
            </button>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.target-picker {
  position: relative;
  width: 100%;
  z-index: 1;
}

.target-picker.open {
  z-index: 48;
}

.target-trigger {
  width: 100%;
  min-height: 46px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--text);
  padding: 8px 36px 8px 11px;
  display: flex;
  justify-content: flex-start;
  align-items: center;
  text-align: left;
  cursor: pointer;
  position: relative;
  transition:
    border-color 140ms ease,
    background-color 140ms ease;
}

.target-trigger-wrap {
  position: relative;
}

.target-trigger:hover {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--line));
  background: color-mix(in srgb, var(--accent) 6%, var(--surface-soft));
}

.target-trigger.disabled {
  cursor: default;
  opacity: 0.68;
}

.target-trigger:focus-visible {
  outline: 3px solid var(--accent-soft);
  outline-offset: 1px;
}

.target-trigger-main {
  min-width: 0;
  display: grid;
  gap: 2px;
  width: 100%;
}

.target-prefix {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-soft);
  line-height: 1.2;
}

.target-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.target-target {
  min-width: 0;
  font-size: 10px;
  line-height: 1.2;
  color: var(--text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.target-arrow {
  width: 16px;
  height: 16px;
  color: var(--text-soft);
  transition: transform 120ms ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  pointer-events: none;
}

.target-arrow svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.target-arrow.open {
  transform: translateY(-50%) rotate(180deg);
}

.target-panel {
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-flat), var(--shadow-soft);
  overflow: auto;
}

.target-panel-layer {
  position: fixed;
  z-index: 4200;
}

.target-panel-layer.is-above {
  transform: translateY(-100%);
}

.target-option {
  width: 100%;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  padding: 8px;
  text-align: left;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
}

.target-option-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.target-option:hover {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--line));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}

.target-option.active {
  border-color: color-mix(in srgb, var(--accent) 64%, var(--line));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
}

.target-option-name {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}

.target-option-target {
  font-size: 10px;
  color: var(--text-soft);
  line-height: 1.25;
  word-break: break-all;
  font-family: var(--font-mono);
}

.target-option-check {
  font-size: 12px;
  line-height: 1.2;
  font-weight: 800;
  color: var(--accent-strong);
  margin-top: 2px;
}

.picker-fade-enter-active,
.picker-fade-leave-active {
  transition: opacity 140ms ease;
}

.picker-fade-enter-from,
.picker-fade-leave-to {
  opacity: 0;
}
</style>
