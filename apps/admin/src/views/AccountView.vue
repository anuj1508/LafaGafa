<script setup lang="ts">
import { computed, ref } from "vue";
import {
  agentFunnelFor,
  agentsFor,
  BUSINESS_HANDOVER,
  funnelFor,
  gapsFor,
  npsFor,
  reviewsFor,
  TRACE_RETENTION_DAYS,
  subAccountById,
} from "../mock/tenancy";
import { go, route } from "../router";
import { identity } from "../session";
import ModalSheet from "./ModalSheet.vue";

/**
 * One sub-account. Its sections live in the shell's sidebar, so this renders whichever the URL
 * names, and everything editable is edited in place rather than on a page of its own.
 *
 * Nothing agent-specific appears here any more. Agent knowledge and agent handover rules were
 * listed on these screens, which made this look like the place to change them — it is not. Those
 * belong to the agent, and duplicating them created two plausible places to look for one setting.
 */

const account = computed(() => subAccountById(route.value.params[0] ?? ""));
const agents = computed(() => (account.value ? agentsFor(account.value.id) : []));
const section = computed(() => route.value.params[1] ?? "overview");

const TITLES: Record<string, string> = {
  agents: "Agents",
  conversations: "Conversations",
  knowledge: "Knowledge",
  handover: "Handover rules",
};

/** Seeded from fixtures then mutable: a prototype where nothing saves does not test anything. */
const rules = ref(BUSINESS_HANDOVER.map((rule) => ({ ...rule })));
const gaps = ref(account.value ? gapsFor(account.value.id).map((gap) => ({ ...gap })) : []);
const sources = ref(
  (account.value?.knowledge.sources ?? []).map((name) => ({
    name,
    kind: name.includes(".") ? "file" : "website",
    note: name.includes(".") ? "Uploaded" : "Crawled, 19 pages",
  })),
);

const knowledgeTab = ref<"sources" | "gaps">("sources");

const reviews = computed(() => (account.value ? reviewsFor(account.value.id) : []));
const openReview = ref<string | null>(null);
/** An agency reviewing a busy client wants one agent at a time, not everything interleaved. */
const agentFilter = ref("");
const shownReviews = computed(() =>
  agentFilter.value === ""
    ? reviews.value
    : reviews.value.filter((review) => review.agentId === agentFilter.value),
);

const OUTCOME_LABEL: Record<string, string> = {
  booked: "Booked",
  answered: "Answered",
  handed: "To a person",
  unanswered: "Could not answer",
};

const ruleSheet = ref<{ id?: string; label: string; detail: string } | null>(null);
const knowledgeSheet = ref<{ kind: "file" | "text" | "site"; title: string; body: string } | null>(
  null,
);

const funnel = computed(() =>
  account.value
    ? funnelFor(account.value.id)
    : { conversations: 0, leads: 0, booked: 0, handed: 0 },
);
const live = computed(() => agents.value.filter((agent) => agent.status === "live").length);
const plan = computed(() => identity.value?.org?.maxAgentsPerSubAccount ?? 3);
const recoverable = computed(() => gaps.value.reduce((sum, gap) => sum + gap.handovers, 0));

const rate = (part: number, whole: number) =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
const width = (part: number) =>
  funnel.value.conversations === 0
    ? "0%"
    : `${Math.max(8, Math.round((part / funnel.value.conversations) * 100))}%`;

function saveRule() {
  const draft = ruleSheet.value;
  if (!draft || draft.label.trim() === "") return;
  const existing = rules.value.find((rule) => rule.id === draft.id);
  if (existing) Object.assign(existing, { label: draft.label, detail: draft.detail });
  else
    rules.value.push({
      id: `rule_${String(rules.value.length)}`,
      label: draft.label,
      detail: draft.detail,
      on: true,
      locked: false,
    });
  ruleSheet.value = null;
}

function saveKnowledge() {
  const draft = knowledgeSheet.value;
  if (!draft) return;
  sources.value.unshift({
    name: draft.title.trim() || (draft.kind === "site" ? "website re-read" : "untitled"),
    kind: draft.kind === "site" ? "website" : "file",
    note: draft.kind === "site" ? "Re-read just now" : "Added just now",
  });
  knowledgeSheet.value = null;
}
</script>

<template>
  <div v-if="account" class="view">
    <header class="view-head">
      <div>
        <p class="crumb">{{ account.industry }} &middot; {{ account.website || "no website" }}</p>
        <h1>{{ TITLES[section] ?? account.business }}</h1>
      </div>
      <div class="head-actions">
        <button
          v-if="section === 'agents'"
          class="solid"
          :disabled="agents.length >= plan"
          @click="go(`agent/new/${account.id}`)"
        >
          New agent
        </button>
        <button
          v-if="section === 'handover'"
          class="solid"
          @click="ruleSheet = { label: '', detail: '' }"
        >
          New rule
        </button>
      </div>
    </header>

    <!-- Overview -->
    <template v-if="section === 'overview'">
      <section class="metrics">
        <article class="accent">
          <p class="m-label">Appointments booked</p>
          <p class="m-value">{{ funnel.booked }}</p>
          <p class="m-foot">{{ rate(funnel.booked, funnel.leads) }} of leads</p>
        </article>
        <article>
          <p class="m-label">Leads created</p>
          <p class="m-value">{{ funnel.leads }}</p>
          <p class="m-foot">{{ rate(funnel.leads, funnel.conversations) }} of conversations</p>
        </article>
        <article>
          <p class="m-label">Conversations</p>
          <p class="m-value">{{ funnel.conversations }}</p>
          <p class="m-foot">{{ live }} of {{ agents.length }} agents live</p>
        </article>
        <article>
          <p class="m-label">Handed to a person</p>
          <p class="m-value">{{ funnel.handed }}</p>
          <p class="m-foot">{{ recoverable }} avoidable with knowledge</p>
        </article>
      </section>

      <div class="split-2">
        <section class="panel">
          <header class="panel-head"><h2>Where it narrows</h2></header>
          <div class="funnel-bars">
            <div class="fbar">
              <div class="fbar-head">
                <strong>{{ funnel.conversations }}</strong
                ><span>conversations</span>
              </div>
              <div class="track"><span style="width: 100%" /></div>
            </div>
            <div class="fbar">
              <div class="fbar-head">
                <strong>{{ funnel.leads }}</strong
                ><span>leads</span>
                <em>{{ rate(funnel.leads, funnel.conversations) }}</em>
              </div>
              <div class="track"><span :style="{ width: width(funnel.leads) }" /></div>
            </div>
            <div class="fbar win">
              <div class="fbar-head">
                <strong>{{ funnel.booked }}</strong
                ><span>booked</span>
                <em>{{ rate(funnel.booked, funnel.leads) }} of leads</em>
              </div>
              <div class="track"><span :style="{ width: width(funnel.booked) }" /></div>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel-head"><h2>Knowledge</h2></header>
          <ul class="stat-list">
            <li>
              <span>Passages indexed</span><b>{{ account.knowledge.chunks }}</b>
            </li>
            <li>
              <span>Sources</span><b>{{ sources.length }}</b>
            </li>
            <li>
              <span>Last built</span><b class="soft">{{ account.knowledge.lastBuilt }}</b>
            </li>
            <li>
              <span>Unanswered questions</span>
              <b :class="{ warn: gaps.length > 0 }">{{ gaps.length }}</b>
            </li>
          </ul>
          <p v-if="recoverable > 0" class="nudge">
            {{ recoverable }} handovers came from questions nothing here answers.
            <button class="link" @click="go(`account/${account.id}/knowledge`)">Fix them</button>
          </p>
        </section>
      </div>

      <section class="panel">
        <header class="panel-head"><h2>Agents</h2></header>
        <table class="data">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th class="num">Conversations</th>
              <th class="num">Resolved</th>
              <th class="num">To a person</th>
              <th class="num">Rating</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="agent in agents"
              :key="agent.id"
              class="click"
              @click="go(`agent/${agent.id}`)"
            >
              <td>
                <div class="cell-id">
                  <span class="avatar-sq">{{ agent.name.charAt(0) }}</span>
                  <div>
                    <strong>{{ agent.name }}</strong>
                    <small>{{ agent.purpose }}</small>
                  </div>
                </div>
              </td>
              <td>
                <span class="chip" :class="agent.status === 'live' ? 'live' : 'off'">
                  {{ agent.status }}
                </span>
              </td>
              <td class="num">{{ agentFunnelFor(agent.id).conversations }}</td>
              <td class="num accent">{{ agentFunnelFor(agent.id).resolved }}</td>
              <td class="num">{{ agentFunnelFor(agent.id).handed }}</td>
              <td class="num">
                {{ npsFor(agent.id).responses > 0 ? npsFor(agent.id).score.toFixed(1) : "—" }}
              </td>
              <td class="chev-cell">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- Agents -->
    <section v-if="section === 'agents'" class="panel">
      <header class="panel-head">
        <h2>{{ agents.length }} of {{ plan }} on your plan</h2>
        <span class="dim small">every agent reads this business's knowledge</span>
      </header>
      <table class="data">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Status</th>
            <th>Channels</th>
            <th class="num">Rating</th>
            <th class="num">Turns 7d</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="agent in agents"
            :key="agent.id"
            class="click"
            @click="go(`agent/${agent.id}`)"
          >
            <td>
              <div class="cell-id">
                <span class="avatar-sq">{{ agent.name.charAt(0) }}</span>
                <div>
                  <strong>{{ agent.name }}</strong>
                  <small>{{ agent.template }}</small>
                </div>
              </div>
            </td>
            <td>
              <span class="chip" :class="agent.status === 'live' ? 'live' : 'off'">
                {{ agent.status }}
              </span>
            </td>
            <td class="dim">{{ agent.channels.join(", ") }}</td>
            <td class="num">
              {{ npsFor(agent.id).responses > 0 ? npsFor(agent.id).score.toFixed(1) : "—" }}
            </td>
            <td class="num">{{ agent.turns7d }}</td>
            <td class="chev-cell">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Knowledge: sources and gaps are two views of one thing, so they are tabs -->
    <template v-if="section === 'knowledge'">
      <div class="tabline">
        <nav class="steps-nav">
          <button :class="{ on: knowledgeTab === 'sources' }" @click="knowledgeTab = 'sources'">
            Sources <span class="count">{{ sources.length }}</span>
          </button>
          <button :class="{ on: knowledgeTab === 'gaps' }" @click="knowledgeTab = 'gaps'">
            Worth adding <span class="count warn">{{ gaps.length }}</span>
          </button>
        </nav>
        <div class="head-actions">
          <button class="ghost" @click="knowledgeSheet = { kind: 'site', title: '', body: '' }">
            Re-read website
          </button>
          <button class="ghost" @click="knowledgeSheet = { kind: 'file', title: '', body: '' }">
            Add a file
          </button>
          <button class="solid" @click="knowledgeSheet = { kind: 'text', title: '', body: '' }">
            Write an answer
          </button>
        </div>
      </div>

      <section v-if="knowledgeTab === 'sources'" class="panel">
        <header class="panel-head">
          <h2>Everything true of {{ account.business }}</h2>
          <span class="dim small"
            >{{ account.knowledge.chunks }} passages, read by every agent</span
          >
        </header>
        <table class="data">
          <tbody>
            <tr v-for="source in sources" :key="source.name">
              <td>
                <div class="cell-id">
                  <span class="avatar-sq doc">{{ source.kind === "website" ? "W" : "F" }}</span>
                  <div>
                    <strong>{{ source.name }}</strong>
                    <small>{{ source.note }}</small>
                  </div>
                </div>
              </td>
              <td class="chev-cell"><button class="mini">Replace</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else class="panel suggest">
        <header class="panel-head">
          <h2>Questions nothing here answers</h2>
          <span class="dim small">each one reached a person instead</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Question</th>
              <th>Asked of</th>
              <th class="num">Times</th>
              <th class="num">Handovers</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="gap in gaps" :key="gap.question">
              <td>
                <strong>{{ gap.question }}</strong>
              </td>
              <td class="dim">{{ gap.scope }}</td>
              <td class="num">{{ gap.asked }}</td>
              <td class="num warn">{{ gap.handovers }}</td>
              <td class="chev-cell">
                <button
                  class="mini"
                  @click="knowledgeSheet = { kind: 'text', title: gap.question, body: '' }"
                >
                  Answer it
                </button>
              </td>
            </tr>
            <tr v-if="gaps.length === 0">
              <td class="dim">Nothing outstanding.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- Handover: business tier only -->
    <section v-if="section === 'handover'" class="panel">
      <header class="panel-head">
        <h2>Business rules</h2>
        <span class="dim small">these hold for every agent here</span>
      </header>
      <table class="data">
        <tbody>
          <tr v-for="rule in rules" :key="rule.id">
            <td>
              <strong>{{ rule.label }}</strong>
              <small class="block dim">{{ rule.detail }}</small>
            </td>
            <td class="chev-cell">
              <button
                class="mini"
                @click="ruleSheet = { id: rule.id, label: rule.label, detail: rule.detail }"
              >
                Edit
              </button>
            </td>
            <td class="num">
              <label class="toggle"><input v-model="rule.on" type="checkbox" /><span /></label>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Conversations, read as an operator rather than an engineer -->
    <template v-if="section === 'conversations'">
      <div class="tabline">
        <nav class="steps-nav">
          <button :class="{ on: agentFilter === '' }" @click="agentFilter = ''">
            All <span class="count">{{ reviews.length }}</span>
          </button>
          <button
            v-for="entry in agents"
            :key="entry.id"
            :class="{ on: agentFilter === entry.id }"
            @click="agentFilter = entry.id"
          >
            {{ entry.name }}
            <span class="count">
              {{ reviews.filter((review) => review.agentId === entry.id).length }}
            </span>
          </button>
        </nav>
      </div>

      <section class="panel">
        <header class="panel-head">
          <h2>Recent conversations</h2>
          <span class="dim small">what it decided and why — not a copy of the messages</span>
        </header>
        <table class="data">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Agent</th>
              <th>Outcome</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-for="review in shownReviews" :key="review.id">
              <tr class="click" @click="openReview = openReview === review.id ? null : review.id">
                <td>
                  <strong>{{ review.customer }}</strong>
                  <small class="block dim">{{ review.turns[0]?.said }}</small>
                </td>
                <td class="dim">
                  {{ agents.find((entry) => entry.id === review.agentId)?.name ?? "—" }}
                </td>
                <td>
                  <span
                    class="chip"
                    :class="{
                      live: review.outcome === 'booked',
                      off: review.outcome === 'answered',
                      building: review.outcome === 'handed',
                      bad: review.outcome === 'unanswered',
                    }"
                  >
                    {{ OUTCOME_LABEL[review.outcome] }}
                  </span>
                </td>
                <td class="dim">{{ review.when }}</td>
                <td class="chev-cell">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path :d="openReview === review.id ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'" />
                  </svg>
                </td>
              </tr>
              <tr v-if="openReview === review.id" class="expanded">
                <td colspan="5">
                  <div class="review">
                    <div v-for="(turn, index) in review.turns" :key="index" class="review-turn">
                      <p class="trigger">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M21 12a8 8 0 01-8 8H7l-4 3v-7a8 8 0 018-8h2a8 8 0 018 4z" />
                        </svg>
                        {{ turn.said }}
                      </p>
                      <div class="why">
                        <span v-if="turn.usedSource" class="why-tag source">
                          answered from <b>{{ turn.usedSource }}</b>
                        </span>
                        <span v-else-if="turn.gapQuestion" class="why-tag gap">
                          nothing matched
                          <button
                            class="mini"
                            @click.stop="
                              knowledgeSheet = { kind: 'text', title: turn.gapQuestion, body: '' }
                            "
                          >
                            Add it
                          </button>
                        </span>
                        <span v-if="turn.didSkill" class="why-tag did">
                          used <b>{{ turn.didSkill }}</b>
                        </span>
                        <span v-if="turn.stoppedBy" class="why-tag stop">
                          stopped by <b>{{ turn.stoppedBy }}</b>
                          <button class="mini" @click.stop="go(`agent/${review.agentId}`)">
                            See the rule
                          </button>
                        </span>
                      </div>
                      <p v-if="turn.gapQuestion || turn.stoppedBy" class="what-it-said">
                        <span class="wis-label">What it said</span>{{ turn.replied }}
                      </p>
                    </div>
                    <p class="trace-foot">
                      The conversation itself lives in GoHighLevel — we keep the decisions for
                      {{ TRACE_RETENTION_DAYS }} days, not the messages.
                      <button class="mini">Open in GoHighLevel</button>
                    </p>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="shownReviews.length === 0">
              <td colspan="5" class="dim">No conversations for this agent yet.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- Sheets -->
    <ModalSheet
      v-if="ruleSheet"
      :title="ruleSheet.id ? 'Edit rule' : 'New handover rule'"
      subtitle="When every agent in this business should stop and fetch a person."
      @close="ruleSheet = null"
      @save="saveRule"
    >
      <label class="field-label">
        <span>Title</span>
        <input v-model="ruleSheet.label" placeholder="Customer mentions a legal claim" />
      </label>
      <label class="field-label">
        <span>When it fires</span>
        <textarea
          v-model="ruleSheet.detail"
          rows="3"
          placeholder="Describe it the way you would to a new receptionist."
        />
      </label>
      <p class="dim small">
        Plain language on purpose — the agent reads this, so how you describe it is how it behaves.
      </p>
    </ModalSheet>

    <ModalSheet
      v-if="knowledgeSheet"
      :title="
        knowledgeSheet.kind === 'site'
          ? 'Re-read the website'
          : knowledgeSheet.kind === 'file'
            ? 'Add a file'
            : 'Write an answer'
      "
      :submit="knowledgeSheet.kind === 'site' ? 'Re-read now' : 'Add to knowledge'"
      @close="knowledgeSheet = null"
      @save="saveKnowledge"
    >
      <template v-if="knowledgeSheet.kind === 'site'">
        <label class="field-label">
          <span>Website</span>
          <input v-model="knowledgeSheet.title" :placeholder="account.website" />
        </label>
        <p class="dim small">
          We re-read every page we can reach and replace what changed. Answers you wrote by hand are
          kept.
        </p>
      </template>

      <template v-else>
        <label class="field-label">
          <span>Title</span>
          <input
            v-model="knowledgeSheet.title"
            :placeholder="knowledgeSheet.kind === 'file' ? 'Price list 2026' : 'Do you take Bupa?'"
          />
        </label>
        <label class="field-label">
          <span>{{ knowledgeSheet.kind === "file" ? "Description" : "Answer" }}</span>
          <textarea
            v-model="knowledgeSheet.body"
            rows="4"
            :placeholder="
              knowledgeSheet.kind === 'file'
                ? 'What is in it, so we index it under the right headings.'
                : 'Write it as you would say it. The agent will not embellish.'
            "
          />
        </label>
        <div v-if="knowledgeSheet.kind === 'file'" class="dropzone">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 17V3M6 9l6-6 6 6M4 21h16" />
          </svg>
          Drop a PDF, Word or Markdown file
        </div>
      </template>
    </ModalSheet>
  </div>
</template>
