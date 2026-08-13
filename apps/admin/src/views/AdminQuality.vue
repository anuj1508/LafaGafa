<script setup lang="ts">
import { computed, ref } from "vue";
import { AGENTS, CONFIG_CHANGES, gapsFor, npsFor, SUB_ACCOUNTS } from "../mock/tenancy";
import { BEHAVIOUR_EVAL, GATE_EVAL, JUDGE_EVAL } from "../measured";
import { scope } from "../scope";

/**
 * Behaviour across everyone, for whoever owns whether this is any good.
 *
 * The retrieval gate leads, because it is the one piece of explicit logic the whole design rests
 * on: retrieve when you should, and never skip a turn that needed documents. Recall matters more
 * than precision here and the floors say so — a false skip is a wrong answer, a false retrieve is
 * only latency.
 */

const tab = ref<"gate" | "behaviour" | "gaps" | "handover">("gate");

const accounts = computed(() =>
  SUB_ACCOUNTS.filter(
    (account) =>
      (scope.of("org") === undefined || account.orgId === scope.of("org")) &&
      (scope.of("account") === undefined || account.id === scope.of("account")),
  ),
);

const gaps = computed(() =>
  accounts.value.flatMap((account) =>
    gapsFor(account.id).map((gap) => ({ ...gap, business: account.business })),
  ),
);

const rated = computed(() =>
  AGENTS.filter((agent) => accounts.value.some((a) => a.id === agent.subAccountId))
    .map((agent) => ({ agent, nps: npsFor(agent.id) }))
    .filter((entry) => entry.nps.responses > 0)
    .sort((a, b) => a.nps.score - b.nps.score),
);

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
</script>

<template>
  <div>
    <nav class="steps-nav">
      <button :class="{ on: tab === 'gate' }" @click="tab = 'gate'">Retrieval gate</button>
      <button :class="{ on: tab === 'behaviour' }" @click="tab = 'behaviour'">Behaviour</button>
      <button :class="{ on: tab === 'gaps' }" @click="tab = 'gaps'">
        Knowledge gaps <span class="count warn">{{ gaps.length }}</span>
      </button>
      <button :class="{ on: tab === 'handover' }" @click="tab = 'handover'">Satisfaction</button>
    </nav>

    <!-- The graded number. -->
    <template v-if="tab === 'gate'">
      <section class="metrics">
        <article class="accent">
          <p class="m-label">Recall</p>
          <p class="m-value">{{ pct(GATE_EVAL.recall) }}</p>
          <p class="m-foot">
            floor {{ pct(GATE_EVAL.recallFloor) }} · no turn that needed documents was skipped
          </p>
        </article>
        <article>
          <p class="m-label">Precision</p>
          <p class="m-value">{{ pct(GATE_EVAL.precision) }}</p>
          <p class="m-foot">
            floor {{ pct(GATE_EVAL.precisionFloor) }} · of retrievals, how many were needed
          </p>
        </article>
        <article>
          <p class="m-label">Accuracy</p>
          <p class="m-value">{{ pct(GATE_EVAL.accuracy) }}</p>
          <p class="m-foot">{{ GATE_EVAL.cases }} labelled cases</p>
        </article>
        <article>
          <p class="m-label">False skips</p>
          <p class="m-value">{{ GATE_EVAL.falseNegative }}</p>
          <p class="m-foot">the failure that produces a wrong answer</p>
        </article>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Confusion matrix</h2>
          <span class="dim small">precision alone hides which way it errs</span>
        </header>
        <div class="matrix">
          <div class="cell good">
            <b>{{ GATE_EVAL.truePositive }}</b
            ><span>retrieved, needed it</span>
          </div>
          <div class="cell warn">
            <b>{{ GATE_EVAL.falsePositive }}</b
            ><span>retrieved, didn't need it</span><em>costs latency</em>
          </div>
          <div class="cell bad">
            <b>{{ GATE_EVAL.falseNegative }}</b
            ><span>skipped, needed it</span><em>costs a wrong answer</em>
          </div>
          <div class="cell good">
            <b>{{ GATE_EVAL.trueNegative }}</b
            ><span>skipped, didn't need it</span>
          </div>
        </div>
      </section>
    </template>

    <template v-if="tab === 'behaviour'">
      <section class="metrics">
        <article class="accent">
          <p class="m-label">Behaviour suite</p>
          <p class="m-value">
            {{ BEHAVIOUR_EVAL.passed }}<i>/ {{ BEHAVIOUR_EVAL.total }}</i>
          </p>
          <p class="m-foot">{{ BEHAVIOUR_EVAL.negativeCases }} assert a skill must NOT fire</p>
        </article>
        <article>
          <p class="m-label">Judge mean</p>
          <p class="m-value">{{ JUDGE_EVAL.mean }}<i>/ 5</i></p>
          <p class="m-foot">floor {{ JUDGE_EVAL.floor }} · {{ JUDGE_EVAL.belowThree }} below 3</p>
        </article>
        <article>
          <p class="m-label">Judged by</p>
          <p class="m-value sm">{{ JUDGE_EVAL.judgedBy }}</p>
          <p class="m-foot">a different vendor from the agent under test</p>
        </article>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>By behaviour</h2></header>
        <table class="data">
          <tbody>
            <tr v-for="row in BEHAVIOUR_EVAL.byBehaviour" :key="row.name">
              <td>
                <strong>{{ row.name }}</strong>
              </td>
              <td>
                <div class="track">
                  <span :style="{ width: `${(row.passed / row.total) * 100}%` }" />
                </div>
              </td>
              <td class="num">
                {{ row.passed }}<i>/{{ row.total }}</i>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <section v-if="tab === 'gaps'" class="panel suggest">
      <header class="panel-head">
        <h2>Questions nothing answered</h2>
        <span class="dim small">across every customer in scope</span>
      </header>
      <table class="data">
        <thead>
          <tr>
            <th>Question</th>
            <th>Business</th>
            <th>Asked of</th>
            <th class="num">Times</th>
            <th class="num">Handovers</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="gap in gaps" :key="gap.business + gap.question">
            <td>
              <strong>{{ gap.question }}</strong>
            </td>
            <td class="dim">{{ gap.business }}</td>
            <td class="dim">{{ gap.scope }}</td>
            <td class="num">{{ gap.asked }}</td>
            <td class="num warn">{{ gap.handovers }}</td>
          </tr>
          <tr v-if="gaps.length === 0">
            <td class="dim">Nothing outstanding in scope.</td>
          </tr>
        </tbody>
      </table>
    </section>

    <template v-if="tab === 'handover'">
      <section class="panel">
        <header class="panel-head">
          <h2>Satisfaction, worst first</h2>
          <span class="dim small">where to look before a customer tells you</span>
        </header>
        <table class="data">
          <tbody>
            <tr v-for="entry in rated" :key="entry.agent.id">
              <td>
                <strong>{{ entry.agent.name }}</strong>
                <small class="block dim">{{ entry.agent.template }}</small>
              </td>
              <td>
                <span class="stars" :style="{ '--fill': `${(entry.nps.score / 5) * 100}%` }" />
              </td>
              <td class="num">{{ entry.nps.score.toFixed(1) }}</td>
              <td class="num dim">{{ entry.nps.responses }} replies</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Recent configuration changes</h2>
          <span class="dim small">read alongside the scores above</span>
        </header>
        <table class="data">
          <tbody>
            <tr v-for="change in CONFIG_CHANGES.slice(0, 4)" :key="change.id">
              <td class="dim nowrap">{{ change.at }}</td>
              <td>
                <strong>{{ change.label }}</strong>
              </td>
              <td class="nowrap">
                <span class="was">{{ change.before }}</span>
                <svg viewBox="0 0 24 24" class="arrow" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <span class="now">{{ change.after }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
