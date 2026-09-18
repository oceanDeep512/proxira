<script setup lang="ts">
// 统一 JSON 视图的默认配置，避免每处调用点各自重复、也避免新调用点漏配。
// `showIcon` 在 vue-json-pretty 里默认 false —— 不开启就只有括号可点，
// 没有任何折叠三角提示。data / 其它属性通过 $attrs 透传。
import JsonPretty from "vue-json-pretty";
</script>

<template>
  <JsonPretty class="json-view" :show-icon="true" />
</template>
