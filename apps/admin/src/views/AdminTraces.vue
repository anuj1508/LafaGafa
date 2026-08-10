<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { TraceEventRow } from "../api";
import { scope } from "../scope";
import { failedNodes, nodesAt, nodesUpTo, STAGE } from "../stage";
import { loadTurns, openTurn, store } from "../store";
import PipelineDiagram from "./PipelineDiagram.vue";
import TurnTransparency from "./TurnTransparency.vue";

/**
 * One turn, replayed through the pipeline.
 *
 * Waku animates live only, which is the wrong half: nobody is watching the screen when the turn
 * that gets complained about happens. Replay works on what is already in the database, so an
 * engineer opens yesterday's turn and watches it break.
 */

const props = defineProps<{ section: string }>();

const cursor = ref(0);
const detail = ref<"replay" | "transparency">("replay");

/**
 * Turns group three ways because three questions get asked of them: what happened in this thread,
 * what is this customer doing, and what is this agent doing. A filter bar beats three near-identical
 * pages, and beats a dropdown because the options are few and worth seeing.
 */
const groupBy = ref<"none" | "conversation" | "account" | "agent">("none");
const outcome = ref<"all" | "completed" | "handover" | "failed">("all");
const GROUPS = ["none", "conversation", "account", "agent"] as const;
const OUTCOMES = ["all", "completed", "handover", "failed"] as const;
const playing = ref(false);
let timer: ReturnType<typeof globalThis.setInterval> | undefined;

const events = computed(() => store.events);

const shown = computed(() => {
  let rows = store.turns;
  // The Errors item in the nav is this page with one filter applied, not a second page.
  if (props.section === "errors" || outcome.value === "failed") {
    rows = rows.filter((row) => row.failed || row.stopReason === "error");
  } else if (outcome.value === "completed") {
    rows = rows.filter((row) => row.stopReason === "completed");
  } else if (outcome.value === "handover") {
    rows = rows.filter((row) => row.handoverTrigger !== null);
  }
  return rows;
});

/** Grouped headings inline, so the list stays one scroll rather than becoming a tree. */
const grouped = computed(() => {
  if (groupBy.value === "none") return [{ label: "", rows: shown.value }];
  const key = (row: (typeof shown.value)[number]) =>
    groupBy.value === "conversation"
      ? row.conversationId
      : groupBy.value === "account"
        ? (store.subAccounts.find((entry) => entry.id === row.subAccountId)?.name ?? "unattributed")
        : (row.skills ?? "no skill");
  const map = new Map<string, typeof shown.value>();
  for (const row of shown.value) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return [...map].map(([label, rows]) => ({ label, rows }));
});
const current = computed<TraceEventRow | undefined>(() => events.value[cursor.value]);
const turn = computed(() => store.turns.find((entry) => entry.turnId === store.openTurnId));

const active = computed(() => nodesAt(current.value));
const visited = computed(() => nodesUpTo(events.value, cursor.value));
const failed = computed(() => failedNodes(events.value.slice(0, cursor.value + 1)));

const slowest = computed(() => Math.max(1, ...events.value.map((event) => event.latencyMs ?? 0)));

function stop() {
  playing.value = false;
  if (timer) globalThis.clearInterval(timer);
}

function play() {
  if (events.value.length === 0) return;
  if (cursor.value >= events.value.length - 1) cursor.value = 0;
  playing.value = true;
  timer = globalThis.setInterval(() => {
    if (cursor.value >= events.value.length - 1) return stop();
    cursor.value += 1;
  }, 620);
}

async function select(turnId: string) {
  stop();
  cursor.value = 0;
  await openTurn(turnId);
}

onMounted(async () => {
  await loadTurns();
  const first = store.turns[0];
  if (first && store.openTurnId === null) await select(first.turnId);
});

watch(
  () => [scope.source, scope.of("account")],
  async () => {
    await loadTurns();
    const first = store.turns[0];
    if (first) await select(first.turnId);
  },
);

const ms = (value: number | null | undefined) => (value == null ? "—" : `${String(value)}ms`);
const time = (iso: string) => new Date(iso).toLocaleTimeString();

/** The sixty-second answer, above the detail. */
const summary = computed(() => {
  const find = (type: string) => events.value.find((event) => event.type === type);
  const gate = find("gate");
  const rag = find("rag_retrieve");
  const end = find("turn_end");
  const chunks = (rag?.payload["chunks"] ?? []) as Array<{ score: number }>;
  const tools = events.value.filter((event) => event.type === "tool_result");
  return {
    gate: gate ? String(gate.payload["decision"]) : null,
    gateBy: gate ? String(gate.payload["decidedBy"]) : "",
    kept: chunks.filter((chunk) => chunk.score >= 0.35).length,
    found: chunks.length,
    tools: tools.map(
      (tool) => `${String(tool.payload["skill"])} ${String(tool.payload["outcome"])}`,
    ),
    stop: end ? String(end.payload["stopReason"]) : null,
    total:
      typeof end?.payload["totalLatencyMs"] === "number" ? end.payload["totalLatencyMs"] : null,
  };
});

function phase(type: string): string {
  if (type === "gate") return "gate";
  if (type === "rag_retrieve") return "rag";
  if (type === "llm_call" || type === "provider_failover") return "model";
  if (type.startsWith("tool") || type === "skill_guard") return "tool";
  if (type === "crm_call") return "crm";
  if (type === "error") return "bad";
  return "meta";
}
</script>

<template>
  <div>
    <!-- Horizontal, and only the controls that change what a turn list means. -->
    <div class="filter-bar">
      <div class="fb-group">
        <span class="fb-label">Group by</span>
        <div class="seg">
          <button
            v-for="option in GROUPS"
            :key="option"
            :class="{ on: groupBy === option }"
            @click="groupBy = option"
          >
            {{ option }}
          </button>
        </div>
      </div>
      <div class="fb-group">
        <span class="fb-label">Outcome</span>
        <div class="seg">
          <button
            v-for="option in OUTCOMES"
            :key="option"
            :class="{ on: outcome === option }"
            @click="outcome = option"
          >
            {{ option }}
          </button>
        </div>
      </div>
      <span class="fb-count">{{ shown.length }} turns</span>
    </div>

    <div class="trace-3">
      <aside class="pane list">
        <header>
          <h2>{{ props.section === "errors" ? "Errors" : "Turns" }}</h2>
          <span class="dim small">{{ shown.length }}</span>
        </header>
        <p v-if="shown.length === 0" class="empty">
          {{ store.offline ? "Server offline." : "No turns match." }}
        </p>
        <template v-for="group in grouped" :key="group.label">
          <p v-if="group.label" class="group-head">{{ group.label }}</p>
          <button
            v-for="entry in group.rows"
            :key="entry.turnId"
            class="turn-row"
            :class="{ on: entry.turnId === store.openTurnId }"
            @click="select(entry.turnId)"
          >
            <span class="glyph" :class="entry.failed ? 'bad' : (entry.stopReason ?? 'meta')" />
            <span class="turn-body">
              <span class="turn-said">{{ entry.input ?? "—" }}</span>
              <span class="turn-meta">
                {{ time(entry.ts) }} · {{ ms(entry.latencyMs) }}
                <span v-if="entry.source === 'eval'" class="tag-eval">eval</span>
              </span>
            </span>
          </button>
        </template>
      </aside>

      <section class="pane fall">
        <template v-if="turn">
          <header>
            <h2>{{ turn.input }}</h2>
            <code class="dim">{{ turn.turnId.slice(0, 8) }}</code>
          </header>

          <div class="summary-strip">
            <div>
              <span class="s-key">gate</span>
              <span class="s-val">{{ summary.gate ?? "—" }}</span>
              <span class="s-sub">{{ summary.gateBy }}</span>
            </div>
            <div>
              <span class="s-key">retrieved</span>
              <span class="s-val">{{ summary.kept }} of {{ summary.found }}</span>
              <span class="s-sub">cleared the floor</span>
            </div>
            <div>
              <span class="s-key">did</span>
              <span class="s-val">{{ summary.tools.join(", ") || "nothing" }}</span>
              <span class="s-sub">skills</span>
            </div>
            <div>
              <span class="s-key">ended</span>
              <span class="s-val" :class="summary.stop === 'completed' ? 'good' : 'bad'">
                {{ summary.stop ?? "—" }}
              </span>
              <span class="s-sub">{{ ms(summary.total) }}</span>
            </div>
          </div>

          <nav class="detail-tabs">
            <button :class="{ on: detail === 'replay' }" @click="detail = 'replay'">Replay</button>
            <button :class="{ on: detail === 'transparency' }" @click="detail = 'transparency'">
              What it saw
            </button>
          </nav>

          <template v-if="detail === 'replay'">
            <PipelineDiagram :active="active" :visited="visited" :failed="failed" />

            <div class="scrubber">
              <button class="mini" @click="cursor = Math.max(0, cursor - 1)">◀</button>
              <button class="mini play" @click="playing ? stop() : play()">
                {{ playing ? "Pause" : "Replay" }}
              </button>
              <button class="mini" @click="cursor = Math.min(events.length - 1, cursor + 1)">
                ▶
              </button>
              <input
                v-model.number="cursor"
                class="track-input"
                type="range"
                min="0"
                :max="Math.max(0, events.length - 1)"
                @input="stop()"
              />
              <span class="scrub-label">
                {{ STAGE[current?.type ?? ""]?.label ?? current?.type ?? "—" }}
                <b>{{ cursor + 1 }}/{{ events.length }}</b>
              </span>
            </div>

            <div class="lanes">
              <button
                v-for="(event, index) in events"
                :key="event.id"
                class="lane"
                :class="[phase(event.type), { on: index === cursor, past: index < cursor }]"
                @click="
                  stop();
                  cursor = index;
                "
              >
                <span class="lane-seq">{{ event.seq }}</span>
                <span class="lane-type">{{ event.type }}</span>
                <span class="lane-bar-cell">
                  <span
                    class="lane-bar"
                    :style="{ width: `${String(((event.latencyMs ?? 0) / slowest) * 100)}%` }"
                  />
                </span>
                <span class="lane-ms">{{ ms(event.latencyMs) }}</span>
              </button>
            </div>
          </template>

          <TurnTransparency v-else :events="events" :floor="0.35" />
        </template>
        <p v-else class="empty">Select a turn.</p>
      </section>

      <aside class="pane inspect">
        <template v-if="current">
          <header>
            <h2>{{ current.type }}</h2>
            <span class="dim small">seq {{ current.seq }} · {{ ms(current.latencyMs) }}</span>
          </header>
          <pre>{{ JSON.stringify(current.payload, null, 2) }}</pre>
        </template>
        <p v-else class="empty">Scrub the turn — this shows whichever step is selected.</p>
      </aside>
    </div>
  </div>
</template>
