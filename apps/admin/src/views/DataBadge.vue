<script setup lang="ts">
/**
 * Says where a panel's numbers came from, because a console that mixes measured results with
 * demo fixtures and does not say which is which is worse than one that shows fewer numbers.
 */

const props = defineProps<{ kind: "live" | "measured" | "sample" }>();

const LABEL = {
  live: "live",
  measured: "measured 10 Aug",
  sample: "sample data",
} as const;

const TITLE = {
  live: "Queried from Postgres when this page loaded.",
  measured: "Real figures from the eval run of 10 August 2026. Not recomputed on load.",
  sample: "Fabricated fixture, so the screen has a shape. Not measured from anything.",
} as const;
</script>

<template>
  <span class="chip" :class="props.kind" :title="TITLE[props.kind]">{{ LABEL[props.kind] }}</span>
</template>
