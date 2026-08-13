<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api } from "../api";
import { LATENCY } from "../measured";

/**
 * Latency against the SLO, and what the agent is running under.
 *
 * Cost and per-release regression belong here too, and are absent because nothing measures them
 * yet — a panel of plausible figures would be worse than the gap.
 */

const props = defineProps<{ section: string }>();
const tab = ref<"latency" | "runtime">(props.section === "runtime" ? "runtime" : "latency");
watch(
  () => props.section,
  (section) => (tab.value = section === "runtime" ? "runtime" : "latency"),
);
const settings = ref<Record<string, unknown> | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    settings.value = await api.settings();
  } catch {
    failed.value = true;
  }
});

const within = (value: number, slo: number) => value <= slo;
</script>

<template>
  <div>
    <nav class="steps-nav">
      <button :class="{ on: tab === 'latency' }" @click="tab = 'latency'">Latency</button>
      <button :class="{ on: tab === 'runtime' }" @click="tab = 'runtime'">Runtime</button>
    </nav>

    <template v-if="tab === 'latency'">
      <section class="metrics">
        <article :class="{ accent: within(LATENCY.p50, LATENCY.p50Slo) }">
          <p class="m-label">p50 webhook to send</p>
          <p class="m-value">{{ LATENCY.p50 }}<i>ms</i></p>
          <p class="m-foot">
            budget {{ LATENCY.p50Slo }}ms ·
            <b :class="within(LATENCY.p50, LATENCY.p50Slo) ? 'good' : 'bad'">
              {{ within(LATENCY.p50, LATENCY.p50Slo) ? "within" : "over" }}
            </b>
            by {{ Math.abs(LATENCY.p50Slo - LATENCY.p50) }}ms
          </p>
        </article>
        <article>
          <p class="m-label">p95</p>
          <p class="m-value">{{ LATENCY.p95 }}<i>ms</i></p>
          <p class="m-foot">
            budget {{ LATENCY.p95Slo }}ms · <b class="good">within</b> by
            {{ LATENCY.p95Slo - LATENCY.p95 }}ms
          </p>
        </article>
        <article>
          <p class="m-label">Margin at p50</p>
          <p class="m-value">{{ LATENCY.p50Slo - LATENCY.p50 }}<i>ms</i></p>
          <p class="m-foot">thin enough to flip between runs</p>
        </article>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>By provider</h2>
          <span class="dim small">{{ LATENCY.note }}</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Provider</th>
              <th />
              <th class="num">p50</th>
              <th class="num">p95</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in LATENCY.byProvider" :key="row.provider">
              <td>
                <strong>{{ row.provider }}</strong>
              </td>
              <td>
                <div class="track">
                  <span :style="{ width: `${(row.p50 / LATENCY.p50Slo) * 100}%` }" />
                </div>
              </td>
              <td class="num">{{ row.p50 }}ms</td>
              <td class="num dim">{{ row.p95 }}ms</td>
            </tr>
          </tbody>
        </table>
        <p class="nudge">
          The turn is one model call: 1152ms of Anthropic's 1161. Nothing else is worth optimising
          on a non-RAG turn.
        </p>
      </section>
    </template>

    <section v-if="tab === 'runtime'" class="panel">
      <header class="panel-head">
        <h2>Runtime settings</h2>
        <span class="dim small">secrets are environment variables and never reach here</span>
      </header>
      <p v-if="failed" class="empty">Server offline on :3000.</p>
      <pre v-else-if="settings">{{ JSON.stringify(settings, null, 2) }}</pre>
    </section>
  </div>
</template>
