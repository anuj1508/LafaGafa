<script setup lang="ts">
import { computed, onMounted } from "vue";
import { go } from "../router";
import { scope } from "../scope";
import { loadEvals, loadTurns, openTurn, store } from "../store";
import DataBadge from "./DataBadge.vue";

/**
 * The graded numbers, read from what `pnpm gate` actually wrote.
 *
 * Served rather than typed in, so this page can never claim a pass the suite did not produce. Each
 * behaviour case carries the `turnId` of its persisted trace, which is the whole point of making
 * eval turns write to the same table: a failure stops being a line of text and becomes a turn you
 * can replay through the pipeline.
 */

const props = defineProps<{ section: string }>();
const showGate = computed(() => props.section !== "behaviour");
const showBehaviour = computed(() => props.section !== "evals");

const gate = computed(() => (showGate.value ? (store.evals?.gate ?? null) : null));
const cases = computed(() => (showBehaviour.value ? (store.evals?.behaviour ?? []) : []));
const failures = computed(() => cases.value.filter((entry) => !entry.passed));

const byBehaviour = computed(() => {
  const groups = new Map<string, { passed: number; total: number }>();
  for (const entry of cases.value) {
    const row = groups.get(entry.behavior) ?? { passed: 0, total: 0 };
    row.total += 1;
    if (entry.passed) row.passed += 1;
    groups.set(entry.behavior, row);
  }
  return [...groups].sort();
});

async function openCase(turnId: string) {
  if (!turnId) return;
  // Eval turns live in the same table, so the viewer is the same one — it just has to be looking.
  scope.source = "eval";
  await loadTurns();
  await openTurn(turnId);
  go("admin/traces");
}

onMounted(loadEvals);

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
</script>

<template>
  <div>
    <p v-if="!store.evals?.gate && !cases.length" class="empty">
      No results yet — run <code>pnpm gate</code>, and this reads what it writes.
    </p>

    <template v-if="gate">
      <h2 class="section">Retrieval gate <DataBadge kind="measured" /></h2>
      <p class="dim spaced">
        The explicit decision the whole design rests on. Recall matters more than precision: a false
        skip is a wrong answer, a false retrieve is only latency.
      </p>
      <section class="metrics">
        <article class="accent">
          <p class="m-label">Recall</p>
          <p class="m-value">{{ pct(gate.recall) }}</p>
          <p class="m-foot">floor {{ pct(gate.recallFloor) }}</p>
        </article>
        <article>
          <p class="m-label">Precision</p>
          <p class="m-value">{{ pct(gate.precision) }}</p>
          <p class="m-foot">floor {{ pct(gate.precisionFloor) }}</p>
        </article>
        <article>
          <p class="m-label">Accuracy</p>
          <p class="m-value">{{ pct(gate.accuracy) }}</p>
          <p class="m-foot">{{ gate.cases }} labelled cases</p>
        </article>
        <article>
          <p class="m-label">False skips</p>
          <p class="m-value" :class="{ bad: gate.falseNegative > 0 }">{{ gate.falseNegative }}</p>
          <p class="m-foot">the failure that reaches a customer</p>
        </article>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Confusion matrix</h2>
          <span class="dim small">the two errors are not equally bad</span>
        </header>
        <div class="matrix">
          <div class="cell good">
            <b>{{ gate.truePositive }}</b
            ><span>retrieved, needed it</span>
          </div>
          <div class="cell warn">
            <b>{{ gate.falsePositive }}</b
            ><span>retrieved, didn't need it</span><em>costs latency</em>
          </div>
          <div class="cell bad">
            <b>{{ gate.falseNegative }}</b
            ><span>skipped, needed it</span><em>costs a wrong answer</em>
          </div>
          <div class="cell good">
            <b>{{ gate.trueNegative }}</b
            ><span>skipped, didn't need it</span>
          </div>
        </div>
      </section>

      <section v-if="gate.falseSkips.length > 0" class="panel suggest">
        <header class="panel-head"><h2>False skips, named</h2></header>
        <table class="data">
          <tbody>
            <tr v-for="miss in gate.falseSkips" :key="miss.id">
              <td>
                <code>{{ miss.id }}</code>
              </td>
              <td>
                <strong>{{ miss.input }}</strong>
              </td>
              <td class="dim">{{ miss.reason }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <template v-if="cases.length">
      <h2 class="section">Behaviour <DataBadge kind="measured" /></h2>
      <p class="dim spaced">
        {{ cases.filter((entry) => entry.passed).length }} of {{ cases.length }} through the real
        loop. Every row opens the turn it produced.
      </p>

      <section class="panel">
        <header class="panel-head"><h2>By behaviour</h2></header>
        <table class="data">
          <tbody>
            <tr v-for="[name, row] in byBehaviour" :key="name">
              <td>
                <strong>{{ name }}</strong>
              </td>
              <td>
                <div class="track">
                  <span :style="{ width: `${String((row.passed / row.total) * 100)}%` }" />
                </div>
              </td>
              <td class="num">
                {{ row.passed }}<i>/{{ row.total }}</i>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="failures.length > 0" class="panel suggest">
        <header class="panel-head">
          <h2>Failing cases</h2>
          <span class="dim small">open one to watch it break</span>
        </header>
        <table class="data">
          <tbody>
            <tr
              v-for="entry in failures"
              :key="entry.id"
              class="click"
              @click="openCase(entry.turnId)"
            >
              <td>
                <strong>{{ entry.id }}</strong>
                <small class="block dim">{{ entry.input }}</small>
              </td>
              <td class="dim">{{ entry.failures.join("; ") }}</td>
              <td class="chev-cell"><button class="mini">Replay</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Every case</h2>
          <span class="dim small">{{ store.evals?.provider }}</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Case</th>
              <th>Behaviour</th>
              <th>Result</th>
              <th class="num">Latency</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in cases"
              :key="entry.id"
              class="click"
              @click="openCase(entry.turnId)"
            >
              <td>
                <strong>{{ entry.id }}</strong>
                <small class="block dim">{{ entry.input }}</small>
              </td>
              <td class="dim">{{ entry.behavior }}</td>
              <td>
                <span class="chip" :class="entry.passed ? 'live' : 'bad'">
                  {{ entry.passed ? "pass" : "fail" }}
                </span>
              </td>
              <td class="num dim">{{ entry.latencyMs }}ms</td>
              <td class="chev-cell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
