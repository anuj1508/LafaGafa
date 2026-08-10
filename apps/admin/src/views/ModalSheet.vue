<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

/**
 * One dialog, used everywhere something is added or edited.
 *
 * Editing a rule, writing an answer and creating an agent are the same interaction wearing three
 * labels, and giving each its own page would make configuration feel like a journey. A sheet keeps
 * the operator where they were, which is the whole reason settings feel low-friction or not.
 */

const props = defineProps<{ title: string; subtitle?: string; submit?: string; wide?: boolean }>();
const emit = defineEmits<{ close: []; save: [] }>();

const onKey = (event: KeyboardEvent) => {
  if (event.key === "Escape") emit("close");
};
onMounted(() => globalThis.addEventListener("keydown", onKey));
onUnmounted(() => globalThis.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet" :class="{ wide: props.wide }" role="dialog" aria-modal="true">
      <header>
        <div>
          <h2>{{ props.title }}</h2>
          <p v-if="props.subtitle" class="dim small">{{ props.subtitle }}</p>
        </div>
        <button class="icon-btn" aria-label="Close" @click="emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div class="sheet-body"><slot /></div>

      <footer>
        <button class="ghost" @click="emit('close')">Cancel</button>
        <button class="solid" @click="emit('save')">{{ props.submit ?? "Save" }}</button>
      </footer>
    </div>
  </div>
</template>
