<script setup lang="ts">
import { computed, ref, watch } from "vue";
import JsonView from "./JsonView.vue";
import type { SseEventView } from "../utils/body.js";

const props = defineProps<{
  events: SseEventView[] | null;
  truncated?: boolean;
}>();

const events = computed<SseEventView[]>(() => props.events ?? []);

// 折叠状态按索引存。切换请求记录时必须清空，否则上一条的折叠会串到下一条。
const collapsed = ref<ReadonlySet<number>>(new Set());
watch(
  () => props.events,
  () => {
    collapsed.value = new Set();
  },
);

const isCollapsed = (index: number): boolean => collapsed.value.has(index);

const allCollapsed = computed(
  () => events.value.length > 0 && collapsed.value.size === events.value.length,
);

const toggle = (index: number): void => {
  const next = new Set(collapsed.value);
  if (!next.delete(index)) {
    next.add(index);
  }
  collapsed.value = next;
};

const toggleAll = (): void => {
  collapsed.value = allCollapsed.value
    ? new Set()
    : new Set(events.value.map((_, index) => index));
};
</script>

<template>
  <div v-if="events.length > 0" class="sse-events">
    <div class="sse-toolbar">
      <span class="sse-count">{{ events.length }} 个事件</span>
      <button type="button" class="sse-toggle-all" @click="toggleAll">
        {{ allCollapsed ? "全部展开" : "全部折叠" }}
      </button>
    </div>
    <p v-if="truncated" class="sub-note sse-truncated-note">
      流较长，仅采样了前部分事件，完整内容请用上游日志核对。
    </p>
    <article v-for="(evt, index) in events" :key="index" class="sse-event">
      <button
        type="button"
        class="sse-event-head"
        :aria-expanded="!isCollapsed(index)"
        @click="toggle(index)"
      >
        <span
          class="sse-event-caret"
          :class="{ 'is-collapsed': isCollapsed(index) }"
          aria-hidden="true"
        ></span>
        <span class="sse-event-index">{{ index + 1 }}</span>
        <span
          class="sse-event-name"
          :class="{ 'is-message': evt.event === 'message' }"
          >{{ evt.event }}</span
        >
        <span v-if="evt.id" class="sse-event-id">id: {{ evt.id }}</span>
      </button>
      <div v-show="!isCollapsed(index)" class="sse-event-body">
        <JsonView
          v-if="evt.jsonData !== null"
          :data="evt.jsonData as any"
        />
        <pre v-else class="sse-event-raw">{{ evt.data }}</pre>
      </div>
    </article>
  </div>
</template>
