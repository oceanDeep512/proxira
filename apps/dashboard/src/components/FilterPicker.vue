<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { CSSProperties } from "vue";

type PickerOption = {
  value: string;
  label: string;
  hint?: string;
};

const props = defineProps<{
  label: string;
  modelValue: string;
  options: readonly PickerOption[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const open = ref(false);
const panelStyle = ref<CSSProperties>({});
const panelPlacement = ref<"below" | "above">("below");

const hasOptions = computed(() => props.options.length > 0);
const isDisabled = computed(() => props.disabled === true || !hasOptions.value);
const activeOption = computed(() => {
  return props.options.find((option) => option.value === props.modelValue) ?? props.options[0] ?? null;
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
  if (isDisabled.value) {
    return;
  }
  open.value = !open.value;
};

const close = (): void => {
  open.value = false;
};

const selectOption = (value: string): void => {
  if (value !== props.modelValue) {
    emit("update:modelValue", value);
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
  <div ref="rootRef" class="filter-picker" :class="{ open }">
    <button
      ref="triggerRef"
      class="filter-trigger"
      :class="{ disabled: isDisabled }"
      type="button"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :disabled="isDisabled"
      @click="toggle"
    >
      <span class="filter-trigger-main">
        <span class="filter-prefix">{{ label }}</span>
        <span class="filter-value">{{ activeOption?.label ?? "暂无选项" }}</span>
        <span class="filter-hint">{{ activeOption?.hint ?? "请选择筛选项" }}</span>
      </span>
      <span class="filter-arrow" :class="{ open }" aria-hidden="true">
        <svg viewBox="0 0 20 20">
          <path d="M5.2 7.6a.9.9 0 0 1 1.3 0L10 11.1l3.5-3.5a.9.9 0 1 1 1.3 1.3l-4.1 4.1a.9.9 0 0 1-1.3 0L5.2 8.9a.9.9 0 0 1 0-1.3Z" />
        </svg>
      </span>
    </button>

    <Teleport to="body">
      <Transition name="picker-fade">
        <ul
          v-if="open"
          ref="panelRef"
          class="filter-panel filter-panel-layer"
          :class="{ 'is-above': panelPlacement === 'above' }"
          :style="panelStyle"
          role="listbox"
        >
          <li v-for="option in options" :key="option.value">
            <button
              class="filter-option"
              type="button"
              role="option"
              :aria-selected="option.value === modelValue"
              :class="{ active: option.value === modelValue }"
              @click="selectOption(option.value)"
            >
              <span class="filter-option-main">
                <span class="filter-option-label">{{ option.label }}</span>
                <span class="filter-option-hint">{{ option.hint ?? label }}</span>
              </span>
              <span v-if="option.value === modelValue" class="filter-option-check" aria-hidden="true">✓</span>
            </button>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.filter-picker {
  position: relative;
  width: 100%;
  z-index: 1;
}

.filter-picker.open {
  z-index: 48;
}

.filter-trigger {
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
  transition: border-color 140ms ease, background-color 140ms ease;
}

.filter-trigger:hover {
  border-color: color-mix(in srgb, var(--accent) 52%, var(--line));
  background: color-mix(in srgb, var(--accent) 6%, var(--surface-soft));
}

.filter-trigger.disabled {
  cursor: default;
  opacity: 0.68;
}

.filter-trigger:focus-visible {
  outline: 3px solid var(--accent-soft);
  outline-offset: 1px;
}

.filter-trigger-main {
  min-width: 0;
  display: grid;
  gap: 2px;
  width: 100%;
}

.filter-prefix {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-soft);
  line-height: 1.2;
}

.filter-value {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.filter-hint {
  min-width: 0;
  font-size: 10px;
  line-height: 1.2;
  color: var(--text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.filter-arrow {
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

.filter-arrow svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.filter-arrow.open {
  transform: translateY(-50%) rotate(180deg);
}

.filter-panel {
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-flat), var(--shadow-soft);
  overflow: auto;
}

.filter-panel-layer {
  position: fixed;
  z-index: 4200;
}

.filter-panel-layer.is-above {
  transform: translateY(-100%);
}

.filter-option {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
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

.filter-option-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.filter-option:hover {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--line));
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
}

.filter-option.active {
  border-color: color-mix(in srgb, var(--accent) 64%, var(--line));
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
}

.filter-option-label {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}

.filter-option-hint {
  font-size: 10px;
  color: var(--text-soft);
  line-height: 1.25;
  font-family: var(--font-mono);
}

.filter-option-check {
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
