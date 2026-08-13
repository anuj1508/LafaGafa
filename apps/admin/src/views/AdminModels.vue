<script setup lang="ts">
import { onMounted, ref } from "vue";
import DataBadge from "./DataBadge.vue";
import { api, type ModelConfig } from "../api";

/**
 * Which model serves which job, and which vendor is first in line. Promoting one changes this
 * process only — the settings file stays the declared truth.
 */

const config = ref<ModelConfig | null>(null);
const busy = ref("");
const problem = ref("");

async function load() {
  config.value = await api.model().catch(() => null);
}

async function promote(provider: string) {
  busy.value = provider;
  problem.value = "";
  try {
    await api.promote(provider);
    await load();
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div v-if="config">
    <h2 class="section">Chat <DataBadge kind="live" /></h2>
    <p class="dim spaced">
      The agent itself. Tried in order — the first entry is primary, the rest are the failover
      chain. The same messages are replayed against the next one, so a switch is invisible to the
      customer and history carries across untouched.
    </p>

    <section class="panel">
      <table class="data">
        <thead>
          <tr>
            <th />
            <th>Provider</th>
            <th>Model</th>
            <th class="num">Temp</th>
            <th class="num">Max out</th>
            <th class="num">Timeout</th>
            <th>Key</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, index) in config.chain" :key="entry.provider">
            <td class="num dim">{{ index === 0 ? "primary" : index + 1 }}</td>
            <td>
              <strong>{{ entry.provider }}</strong>
            </td>
            <td>
              <code>{{ entry.model }}</code>
            </td>
            <td class="num dim">{{ entry.temperature }}</td>
            <td class="num dim">{{ entry.maxOutputTokens }}</td>
            <td class="num dim">{{ entry.timeoutMs }}ms</td>
            <td>
              <span class="chip" :class="entry.configured ? 'live' : 'bad'">
                {{ entry.configured ? "set" : "missing" }}
              </span>
            </td>
            <td class="chev-cell">
              <button
                v-if="index > 0 && entry.configured"
                class="mini"
                :disabled="busy === entry.provider"
                @click="promote(entry.provider)"
              >
                {{ busy === entry.provider ? "…" : "Make primary" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="problem" class="nudge">{{ problem }}</p>
      <p v-else class="nudge">
        A provider with no key is filtered out of the chain at call time, so deleting a key is
        itself a switch. Promoting one here lasts until the server restarts.
        <template v-if="config.envOverride">
          <b>MODEL_PROVIDER={{ config.envOverride }}</b> is set, and applied at boot.
        </template>
      </p>
    </section>

    <h2 class="section">Internal calls</h2>
    <p class="dim spaced">
      Structured, tiny, and no tools. A frontier model here buys nothing and costs latency on every
      single turn.
    </p>
    <div class="split-2">
      <section class="panel">
        <header class="panel-head">
          <h2>Gate</h2>
          <span class="dim small">does this turn need the knowledge base</span>
        </header>
        <ul class="stat-list">
          <li>
            <span>Provider</span><b class="soft">{{ config.gate.provider }}</b>
          </li>
          <li>
            <span>Model</span><b class="soft">{{ config.gate.model }}</b>
          </li>
          <li>
            <span>Temperature</span><b>{{ config.gate.temperature }}</b>
          </li>
          <li>
            <span>Max output</span><b>{{ config.gate.maxOutputTokens }}</b>
          </li>
          <li>
            <span>Timeout</span><b>{{ config.gate.timeoutMs }}ms</b>
          </li>
        </ul>
        <p class="nudge">
          No failover chain on purpose: it fails open and retrieves, because a false skip is a wrong
          answer and a false retrieve is only latency.
        </p>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Judge</h2>
          <span class="dim small">scores eval rubrics, never runs in production</span>
        </header>
        <ul class="stat-list">
          <li>
            <span>Provider</span><b class="soft">{{ config.judge.provider }}</b>
          </li>
          <li>
            <span>Model</span><b class="soft">{{ config.judge.model }}</b>
          </li>
          <li>
            <span>Temperature</span><b>{{ config.judge.temperature }}</b>
          </li>
          <li>
            <span>Max output</span><b>{{ config.judge.maxOutputTokens }}</b>
          </li>
        </ul>
        <p class="nudge">
          Held on a different vendor from the agent under test. A model grading its own output marks
          generously and the number stops meaning anything.
        </p>
      </section>
    </div>
  </div>
  <p v-else class="empty">Server offline on :3000.</p>
</template>
