<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api } from "../api";
import { LATENCY } from "../measured";
import DataBadge from "./DataBadge.vue";

/**
 * Latency against the SLO, from the measured run rather than a live query.
 *
 * Non-RAG and RAG are never averaged together: the target governs the former, and a retrieval turn
 * is slower by design. Cost and per-release regression belong here too and are absent because
 * nothing measures them — a panel of plausible figures would be worse than the gap.
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
const primary = LATENCY.primary;
</script>

<template>
  <div>
    <nav class="steps-nav">
      <button :class="{ on: tab === 'latency' }" @click="tab = 'latency'">Latency</button>
      <button :class="{ on: tab === 'runtime' }" @click="tab = 'runtime'">Runtime</button>
    </nav>

    <template v-if="tab === 'latency'">
      <section class="metrics">
        <article :class="{ accent: within(primary.p50, LATENCY.p50Slo) }">
          <p class="m-label">p50 webhook to send</p>
          <p class="m-value">{{ primary.p50 }}<i>ms</i></p>
          <p class="m-foot">
            budget {{ LATENCY.p50Slo }}ms ·
            <b :class="within(primary.p50, LATENCY.p50Slo) ? 'good' : 'bad'">
              {{ within(primary.p50, LATENCY.p50Slo) ? "within" : "over" }}
            </b>
            by {{ Math.abs(LATENCY.p50Slo - primary.p50) }}ms · {{ primary.provider }}
          </p>
        </article>
        <article>
          <p class="m-label">p95</p>
          <p class="m-value">{{ primary.p95 }}<i>ms</i></p>
          <p class="m-foot">
            budget {{ LATENCY.p95Slo }}ms ·
            <b :class="within(primary.p95, LATENCY.p95Slo) ? 'good' : 'bad'">
              {{ within(primary.p95, LATENCY.p95Slo) ? "within" : "over" }}
            </b>
          </p>
        </article>
        <article>
          <p class="m-label">The send alone</p>
          <p class="m-value">{{ primary.send }}<i>ms</i></p>
          <p class="m-foot">the CRM accepting the reply, on every turn</p>
        </article>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>By provider</h2>
          <DataBadge kind="measured" on="13 Aug" />
          <span class="dim small">{{ LATENCY.note }}</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Provider</th>
              <th class="num">turns</th>
              <th class="num">p50</th>
              <th class="num">p95</th>
              <th class="num">RAG p50</th>
              <th class="num">stalled</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in LATENCY.byProvider" :key="row.provider">
              <td>
                <strong>{{ row.provider }}</strong>
              </td>
              <td class="num dim">{{ row.turns }}</td>
              <td class="num" :class="within(row.p50, LATENCY.p50Slo) ? 'good' : 'bad'">
                {{ row.p50 }}ms
              </td>
              <td class="num" :class="within(row.p95, LATENCY.p95Slo) ? '' : 'bad'">
                {{ row.p95 }}ms
              </td>
              <td class="num dim">{{ row.ragP50 }}ms</td>
              <td class="num dim">{{ row.stalled || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p class="nudge">
          The gate runs on one vendor whatever answers the turn, so the same few hundred
          milliseconds sit in every row and the spread reads narrower than it is. Turns where a
          single CRM call passed {{ LATENCY.stallMs }}ms are counted under "stalled" and left out of
          the percentiles.
        </p>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Where a turn's time goes</h2>
          <DataBadge kind="measured" on="13 Aug" />
          <span class="dim small">p50 per component</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Provider</th>
              <th class="num">queued</th>
              <th class="num">loop</th>
              <th class="num">CRM total</th>
              <th class="num">send</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in LATENCY.byProvider" :key="row.provider">
              <td>
                <strong>{{ row.provider }}</strong>
              </td>
              <td class="num dim">{{ row.queued }}ms</td>
              <td class="num">{{ row.loop }}ms</td>
              <td class="num">{{ row.crm }}ms</td>
              <td class="num dim">{{ row.send }}ms</td>
            </tr>
          </tbody>
        </table>
        <p class="nudge">
          Queued is the debounce window, not work. CRM total overlaps the loop when a skill calls
          the CRM mid-turn, so the columns do not sum to the total. Every difference between vendors
          is the loop.
        </p>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>CRM endpoints</h2>
          <DataBadge kind="measured" on="13 Aug" />
          <span class="dim small">every round trip across the three runs</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th class="num">calls</th>
              <th class="num">p50</th>
              <th class="num">p95</th>
              <th class="num">worst</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in LATENCY.endpoints" :key="row.method + row.path">
              <td>
                <code>{{ row.method }} {{ row.path }}</code>
              </td>
              <td class="num dim">{{ row.calls }}</td>
              <td class="num">{{ row.p50 }}ms</td>
              <td class="num dim">{{ row.p95 }}ms</td>
              <td class="num" :class="row.worst > LATENCY.stallMs ? 'bad' : 'dim'">
                {{ row.worst }}ms
              </td>
            </tr>
          </tbody>
        </table>
        <p class="nudge">
          The reply POST is the most expensive routine call and runs on every turn. free-slots is
          the tail risk: usually 119ms, once 24 seconds.
        </p>
      </section>
    </template>

    <section v-if="tab === 'runtime'" class="panel">
      <header class="panel-head">
        <h2>Runtime settings</h2>
        <DataBadge kind="live" />
        <span class="dim small">secrets are environment variables and never reach here</span>
      </header>
      <p v-if="failed" class="empty">Server offline on :3000.</p>
      <pre v-else-if="settings">{{ JSON.stringify(settings, null, 2) }}</pre>
    </section>
  </div>
</template>
