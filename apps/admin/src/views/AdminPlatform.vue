<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api } from "../api";
import { COST, LATENCY, RELEASES } from "../mock/quality";

/** Latency, cost and releases: whoever owns the SLO and the bill. */

const props = defineProps<{ section: string }>();
const tab = ref<"latency" | "cost" | "releases" | "runtime">(
  props.section === "runtime" ? "runtime" : "latency",
);
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
      <button :class="{ on: tab === 'cost' }" @click="tab = 'cost'">Cost</button>
      <button :class="{ on: tab === 'releases' }" @click="tab = 'releases'">Releases</button>
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
          <h2>Where the time goes</h2>
          <span class="dim small">{{ LATENCY.note }}</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Span</th>
              <th />
              <th class="num">p50</th>
              <th class="num">p95</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="span in LATENCY.spans" :key="span.name">
              <td>
                <code>{{ span.name }}</code>
              </td>
              <td>
                <div class="track">
                  <span :style="{ width: `${(span.p50 / LATENCY.p50Slo) * 100}%` }" />
                </div>
              </td>
              <td class="num">{{ span.p50 }}ms</td>
              <td class="num dim">{{ span.p95 }}ms</td>
            </tr>
          </tbody>
        </table>
        <p class="nudge">
          The turn is one model call: 2996ms of 2998. Nothing else is worth optimising until the
          chat model changes.
        </p>
      </section>
    </template>

    <template v-if="tab === 'cost'">
      <section class="metrics">
        <article class="accent">
          <p class="m-label">Per turn</p>
          <p class="m-value">${{ COST.perTurnUsd.toFixed(4) }}</p>
          <p class="m-foot">across every customer</p>
        </article>
        <article>
          <p class="m-label">This month</p>
          <p class="m-value">${{ COST.monthUsd }}</p>
          <p class="m-foot">model spend only</p>
        </article>
        <article>
          <p class="m-label">Served from cache</p>
          <p class="m-value">{{ Math.round(COST.cachedShare * 100) }}%</p>
          <p class="m-foot">prompt caching on the system block</p>
        </article>
      </section>
      <section class="panel">
        <header class="panel-head"><h2>By provider</h2></header>
        <table class="data">
          <tbody>
            <tr v-for="row in COST.byProvider" :key="row.provider">
              <td>
                <strong>{{ row.provider }}</strong>
              </td>
              <td>
                <div class="track"><span :style="{ width: `${row.share * 100}%` }" /></div>
              </td>
              <td class="num">${{ row.usd }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <section v-if="tab === 'releases'" class="panel">
      <header class="panel-head">
        <h2>Releases</h2>
        <span class="dim small">did the last deploy make it worse</span>
      </header>
      <table class="data">
        <thead>
          <tr>
            <th>Commit</th>
            <th>When</th>
            <th>Change</th>
            <th class="num">Gate accuracy</th>
            <th class="num">p95</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="release in RELEASES" :key="release.sha">
            <td>
              <code>{{ release.sha }}</code>
            </td>
            <td class="dim">{{ release.when }}</td>
            <td>{{ release.note }}</td>
            <td class="num">{{ (release.gate * 100).toFixed(1) }}%</td>
            <td class="num" :class="release.p95 > 6000 ? 'warn' : ''">{{ release.p95 }}ms</td>
          </tr>
        </tbody>
      </table>
    </section>

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
