<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { scope } from "../scope";
import { go } from "../router";
import { openTurn, store } from "../store";

/**
 * One box instead of four selects.
 *
 * Everything a console filter row could express — a customer, a turn id someone pasted from a
 * support ticket, "show me the failures" — is faster to type than to click through, and costs no
 * permanent screen. It also degrades well: an id you do not recognise is still pasteable.
 */

const emit = defineEmits<{ close: [] }>();
const query = ref("");
const field = ref<HTMLInputElement | null>(null);
const cursor = ref(0);

interface Hit {
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

const results = computed<Hit[]>(() => {
  const term = query.value.trim().toLowerCase();
  const hits: Hit[] = [];

  for (const account of store.subAccounts) {
    if (term === "" || account.name.toLowerCase().includes(term)) {
      hits.push({
        group: "Customers",
        label: account.name,
        hint: account.ghlLocationId ?? "not connected",
        run: () => {
          scope.enter({ kind: "account", id: account.id, label: account.name });
          go("admin/traces");
        },
      });
    }
  }

  for (const turn of store.turns.slice(0, 40)) {
    const text = `${turn.turnId} ${turn.conversationId} ${turn.input ?? ""}`.toLowerCase();
    if (term !== "" && text.includes(term)) {
      hits.push({
        group: "Turns",
        label: turn.input ?? turn.turnId,
        hint: turn.stopReason ?? "",
        run: () => {
          void openTurn(turn.turnId);
          go("admin/traces");
        },
      });
    }
  }

  const jumps: Array<[string, string]> = [
    ["failures", "admin/errors"],
    ["errors", "admin/errors"],
    ["evals", "admin/evals"],
    ["gate", "admin/evals"],
    ["behaviour", "admin/behaviour"],
    ["fleet", "admin/fleet"],
    ["latency", "admin/platform"],
    ["cost", "admin/platform"],
    ["runtime", "admin/runtime"],
    ["changes", "admin/changes"],
  ];
  for (const [word, target] of jumps) {
    if (term !== "" && word.startsWith(term)) {
      hits.push({ group: "Go to", label: word, run: () => go(target) });
    }
  }

  return hits.slice(0, 12);
});

function choose(index: number) {
  const hit = results.value[index];
  if (!hit) return;
  hit.run();
  emit("close");
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
  if (event.key === "ArrowDown") {
    event.preventDefault();
    cursor.value = Math.min(cursor.value + 1, results.value.length - 1);
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    cursor.value = Math.max(cursor.value - 1, 0);
  }
  if (event.key === "Enter") choose(cursor.value);
}

onMounted(async () => {
  await nextTick();
  field.value?.focus();
});
</script>

<template>
  <div class="palette-scrim" @click.self="emit('close')">
    <div class="palette" role="dialog" aria-modal="true">
      <div class="palette-input">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35" />
        </svg>
        <input
          ref="field"
          v-model="query"
          placeholder="Customer, turn id, conversation id, or a page"
          @keydown="onKey"
        />
        <kbd>esc</kbd>
      </div>

      <ul v-if="results.length > 0" class="palette-list">
        <li
          v-for="(hit, index) in results"
          :key="hit.group + hit.label + String(index)"
          :class="{ on: index === cursor }"
          @mouseenter="cursor = index"
          @click="choose(index)"
        >
          <span class="p-group">{{ hit.group }}</span>
          <span class="p-label">{{ hit.label }}</span>
          <span v-if="hit.hint" class="p-hint">{{ hit.hint }}</span>
        </li>
      </ul>
      <p v-else class="palette-empty">
        {{ query ? `Nothing matches "${query}".` : "Type a customer, an id, or a page name." }}
      </p>
    </div>
  </div>
</template>
