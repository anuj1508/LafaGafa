<script setup lang="ts">
/**
 * Says where a panel's numbers came from, because a console that mixes measured results with
 * demo fixtures and does not say which is which is worse than one that shows fewer numbers.
 *
 * `on` is the run date, and measured panels pass it: two suites ran on different days, and one
 * badge claiming both would be wrong on one of them.
 */

const props = defineProps<{ kind: "live" | "measured" | "sample"; on?: string }>();

const LABEL = {
  live: "live",
  measured: "measured",
  sample: "sample data",
} as const;

const TITLE = {
  live: "Queried from Postgres when this page loaded.",
  measured: "Real figures from a recorded run. Not recomputed on load.",
  sample: "Fabricated fixture, so the screen has a shape. Not measured from anything.",
} as const;
</script>

<template>
  <span class="chip" :class="props.kind" :title="TITLE[props.kind]">
    {{ LABEL[props.kind] }}<template v-if="props.on"> {{ props.on }}</template>
  </span>
</template>
