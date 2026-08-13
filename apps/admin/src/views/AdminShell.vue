<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { scope } from "../scope";
import { go, route } from "../router";
import { signOut, staff } from "../session";
import { loadEvals, loadSubAccounts, store } from "../store";
import CommandPalette from "./CommandPalette.vue";

/**
 * LafaGafa's own console. Four groups, because "admin" is four jobs, and the nav carries the value
 * next to the label so triage happens before the click. See #scope-is-a-place.
 */

const section = computed(() => route.value.params[0] ?? "traces");
const paletteOpen = ref(false);
const SOURCES = ["live", "eval", "all"] as const;

const errors = computed(() => store.turns.filter((turn) => turn.failed).length);
const gateAccuracy = computed(() =>
  store.evals?.gate ? `${(store.evals.gate.accuracy * 100).toFixed(1)}%` : "—",
);
const behaviourPass = computed(() => {
  const cases = store.evals?.behaviour;
  if (!cases) return "—";
  return `${String(cases.filter((entry) => entry.passed).length)}/${String(cases.length)}`;
});

const GROUPS = computed(() => [
  {
    name: "Live",
    items: [
      { id: "traces", label: "Traces", value: String(store.turns.length) },
      { id: "errors", label: "Errors", value: String(errors.value), bad: errors.value > 0 },
    ],
  },
  {
    name: "Customers",
    items: [
      { id: "fleet", label: "Fleet", value: String(store.subAccounts.length) },
      { id: "changes", label: "Changes", value: "" },
    ],
  },
  {
    name: "Quality",
    items: [
      { id: "evals", label: "Evals", value: gateAccuracy.value },
      { id: "behaviour", label: "Behaviour", value: behaviourPass.value },
      { id: "quality", label: "Gaps and ratings", value: "" },
    ],
  },
  {
    name: "Platform",
    items: [
      { id: "platform", label: "Latency", value: "1161ms" },
      { id: "models", label: "Models", value: "" },
      { id: "runtime", label: "Runtime", value: "" },
    ],
  },
]);

function onKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    paletteOpen.value = true;
  }
}

onMounted(() => {
  globalThis.addEventListener("keydown", onKey);
  void loadSubAccounts();
  void loadEvals();
});
onUnmounted(() => globalThis.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="cn-shell">
    <aside class="cn-side">
      <div class="cn-brand">
        <span class="wordmark small"><span>Lafa</span>Gafa</span>
        <span class="env">admin</span>
      </div>

      <button class="cn-search-btn" @click="paletteOpen = true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35" />
        </svg>
        Search
        <kbd>⌘K</kbd>
      </button>

      <nav class="cn-nav">
        <template v-for="group in GROUPS" :key="group.name">
          <p class="cn-group">{{ group.name }}</p>
          <button
            v-for="item in group.items"
            :key="item.id"
            :class="{ on: section === item.id }"
            @click="go(`admin/${item.id}`)"
          >
            {{ item.label }}
            <span v-if="item.value" class="n" :class="{ bad: item.bad }">{{ item.value }}</span>
          </button>
        </template>
      </nav>

      <div class="cn-user">
        <div>
          <strong>{{ staff?.name }}</strong>
          <small>{{ staff?.email }}</small>
        </div>
        <button class="icon-btn" title="Sign out" @click="signOut">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>

    <div class="cn-main">
      <!-- Only rendered once you are inside something. No permanent chrome saying "All". -->
      <div v-if="scope.crumbs.length > 0 || scope.source !== 'live'" class="cn-crumbs">
        <button class="crumb-root" @click="scope.clear()">All customers</button>
        <template v-for="(crumb, index) in scope.crumbs" :key="crumb.id">
          <svg viewBox="0 0 24 24" class="crumb-sep" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
          <button
            class="crumb"
            :class="{ last: index === scope.crumbs.length - 1 }"
            @click="scope.upTo(index)"
          >
            {{ crumb.label }}
          </button>
        </template>

        <div class="crumb-right">
          <div class="seg">
            <button
              v-for="option in SOURCES"
              :key="option"
              :class="{ on: scope.source === option }"
              @click="scope.source = option"
            >
              {{ option }}
            </button>
          </div>
          <button class="mini" @click="scope.clear()">Exit</button>
        </div>
      </div>

      <main class="cn-canvas">
        <p v-if="store.offline" class="offline">
          Server offline on :3000 — start it with <code>pnpm dev</code>.
        </p>
        <slot />
      </main>
    </div>

    <CommandPalette v-if="paletteOpen" @close="paletteOpen = false" />
  </div>
</template>
