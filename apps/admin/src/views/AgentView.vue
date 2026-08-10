<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  addAgent,
  AGENT_HANDOVER,
  agentById,
  agentFunnelFor,
  handoverReasonsFor,
  METRICS_FOR,
  npsFor,
  reviewsForAgent,
  setAgentStatus,
  SKILL_CATALOGUE,
  TRACE_RETENTION_DAYS,
  subAccountById,
} from "../mock/tenancy";
import { go, route } from "../router";
import DescribeAgent from "./DescribeAgent.vue";
import ModalSheet from "./ModalSheet.vue";

/**
 * One agent, whether it exists yet or not.
 *
 * Creating one used to be a dialog, which was the wrong shape: an agent has a persona, knowledge,
 * skills, rules and channels, and a sheet cannot hold that without becoming a wizard. So a new
 * agent is this same page with everything empty and a Create button — the screen you will spend the
 * next year in is the screen you set it up in, and nothing moves after you save.
 */

const creating = computed(() => route.value.path === "agent" && route.value.params[0] === "new");
const agent = computed(() => (creating.value ? undefined : agentById(route.value.params[0] ?? "")));
const account = computed(() =>
  creating.value
    ? subAccountById(route.value.params[1] ?? "")
    : subAccountById(agent.value?.subAccountId ?? ""),
);

const name = ref("");
const purpose = ref("");
const templateName = ref("Front desk receptionist");
const channels = ref<string[]>(["Web chat"]);

watch(
  agent,
  (value) => {
    if (!value) return;
    name.value = value.name;
    purpose.value = value.purpose;
    templateName.value = value.template;
    channels.value = [...value.channels];
  },
  { immediate: true },
);

const templateKey = computed(() => {
  const template = templateName.value.toLowerCase();
  if (template.includes("out-of-hours")) return "out-of-hours";
  if (template.includes("support")) return "support-desk";
  return "front-desk";
});

const skills = ref(
  SKILL_CATALOGUE.filter((skill) => skill.available).map((skill) => ({ ...skill, on: true })),
);
const enabled = computed(() => skills.value.filter((skill) => skill.on));
const rules = ref((AGENT_HANDOVER["front-desk"] ?? []).map((rule) => ({ ...rule })));

watch(templateKey, (key) => {
  rules.value = (AGENT_HANDOVER[key] ?? []).map((rule) => ({ ...rule }));
});

const TABS = computed(() =>
  creating.value
    ? [
        { id: "persona", label: "Persona" },
        { id: "knowledge", label: "Knowledge" },
        { id: "skills", label: "Skills" },
        { id: "handover", label: "Handover" },
        { id: "channels", label: "Channels" },
      ]
    : [
        { id: "conversations", label: "Conversations" },
        { id: "persona", label: "Persona" },
        { id: "knowledge", label: "Knowledge" },
        { id: "skills", label: "Skills" },
        { id: "handover", label: "Handover" },
        { id: "channels", label: "Channels" },
      ],
);
const tab = ref<string>(creating.value ? "persona" : "conversations");

const funnel = computed(() =>
  agent.value
    ? agentFunnelFor(agent.value.id)
    : { conversations: 0, leads: 0, booked: 0, handed: 0, resolved: 0 },
);
const nps = computed(() => (agent.value ? npsFor(agent.value.id) : { score: 0, responses: 0 }));
const reasons = computed(() => (agent.value ? handoverReasonsFor(agent.value.id) : []));
const reviews = computed(() => (agent.value ? reviewsForAgent(agent.value.id) : []));
const metrics = computed(() => METRICS_FOR[templateKey.value] ?? []);
const isDraft = computed(() => creating.value || agent.value?.status === "draft");

const checks = computed(() => [
  { label: "Has a name", ok: name.value.trim().length > 1, required: true },
  {
    label: `Can read ${account.value?.business ?? "the business"}'s knowledge`,
    ok: (account.value?.knowledge.chunks ?? 0) > 0,
    required: true,
    note: `${account.value?.knowledge.chunks ?? 0} passages`,
  },
  { label: "Handover rules inherited", ok: true, required: true, note: "applied automatically" },
  { label: "At least one skill", ok: enabled.value.length > 0, required: false },
  { label: "A channel to run on", ok: channels.value.length > 0, required: false },
]);
const blocking = computed(() => checks.value.filter((check) => check.required && !check.ok).length);

const skillSheet = ref(false);
const ruleSheet = ref<{ id?: string; label: string; detail: string } | null>(null);
const openReview = ref<string | null>(null);
const offCatalogue = computed(() => SKILL_CATALOGUE.filter((skill) => !skill.available));

function accept(proposal: { name: string; purpose: string; skills: string[]; template: string }) {
  name.value = proposal.name;
  purpose.value = proposal.purpose;
  templateName.value = proposal.template;
  for (const skill of skills.value) skill.on = proposal.skills.includes(skill.id);
}

function create() {
  if (!account.value || blocking.value > 0) return;
  const created = addAgent({
    subAccountId: account.value.id,
    name: name.value.trim(),
    purpose: purpose.value.trim(),
    template: templateName.value,
    channels: channels.value,
    skills: enabled.value.map((skill) => skill.id),
  });
  go(`agent/${created.id}`);
}

function toggleLive() {
  if (!agent.value) return;
  setAgentStatus(agent.value.id, agent.value.status === "live" ? "paused" : "live");
}

function saveRule() {
  const draft = ruleSheet.value;
  if (!draft || draft.label.trim() === "") return;
  const existing = rules.value.find((rule) => rule.id === draft.id);
  if (existing) Object.assign(existing, { label: draft.label, detail: draft.detail });
  else
    rules.value.push({
      id: `r${String(rules.value.length)}`,
      label: draft.label,
      detail: draft.detail,
      on: true,
    });
  ruleSheet.value = null;
}

const value = (key: string) => (funnel.value as unknown as Record<string, number>)[key] ?? 0;
const OUTCOME: Record<string, string> = {
  booked: "Booked",
  answered: "Answered",
  handed: "To a person",
  unanswered: "Could not answer",
};
</script>

<template>
  <div v-if="account" class="view">
    <header class="view-head">
      <div class="agent-title">
        <span class="persona big">{{ (name || "?").charAt(0) }}</span>
        <div>
          <p class="crumb">{{ account.business }} &middot; {{ templateName }}</p>
          <h1>{{ creating ? name || "New agent" : agent?.name }}</h1>
        </div>
      </div>
      <div class="head-actions">
        <template v-if="creating">
          <button class="ghost" @click="go(`account/${account.id}/agents`)">Cancel</button>
          <button class="solid" :disabled="blocking > 0" @click="create">Create, paused</button>
        </template>
        <template v-else>
          <span class="chip" :class="agent?.status === 'live' ? 'live' : 'off'">
            {{ agent?.status }}
          </span>
          <button class="ghost">Test it</button>
          <button class="solid" :disabled="blocking > 0" @click="toggleLive">
            {{ agent?.status === "live" ? "Pause" : "Go live" }}
          </button>
        </template>
      </div>
    </header>

    <DescribeAgent v-if="creating" @proposed="accept" />

    <section v-if="isDraft" class="panel draft-banner">
      <header class="panel-head">
        <h2>{{ blocking === 0 ? "Ready when you are" : `${blocking} thing left` }}</h2>
        <span class="dim small">
          {{ creating ? "nothing is saved yet" : "this agent is not answering anyone" }}
        </span>
      </header>
      <div class="readiness bare">
        <ul>
          <li v-for="check in checks" :key="check.label" :class="{ done: check.ok }">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path v-if="check.ok" d="M4 12l6 6L20 6" />
              <path v-else d="M12 8v5M12 16h.01" />
            </svg>
            <span>{{ check.label }}</span>
            <small v-if="check.note">{{ check.note }}</small>
            <em v-else-if="!check.required">optional</em>
          </li>
        </ul>
      </div>
    </section>

    <template v-if="!isDraft">
      <section class="metrics">
        <article v-for="metric in metrics" :key="metric.label" :class="{ accent: metric.primary }">
          <p class="m-label">{{ metric.label }}</p>
          <p class="m-value">{{ value(metric.key) }}</p>
          <p class="m-foot">{{ metric.hint ?? "last 30 days" }}</p>
        </article>
        <article class="rating">
          <p class="m-label">Satisfaction</p>
          <p class="m-value">{{ nps.responses > 0 ? nps.score.toFixed(1) : "—" }}<i>/ 5</i></p>
          <p class="m-foot">
            <span class="stars" :style="{ '--fill': `${(nps.score / 5) * 100}%` }" />
            {{ nps.responses }} replies
          </p>
        </article>
      </section>
    </template>

    <nav class="steps-nav">
      <button
        v-for="entry in TABS"
        :key="entry.id"
        :class="{ on: tab === entry.id }"
        @click="tab = entry.id"
      >
        {{ entry.label }}
      </button>
    </nav>

    <!-- Conversations: this agent's own trace -->
    <template v-if="tab === 'conversations'">
      <section v-if="reasons.length > 0" class="panel">
        <header class="panel-head">
          <h2>Why it handed over</h2>
          <span class="dim small">which rule fired, so the setup can be judged</span>
        </header>
        <div class="reason-list">
          <div v-for="reason in reasons" :key="reason.label" class="reason">
            <span class="r-label">{{ reason.label }}</span>
            <div class="track">
              <span :style="{ width: `${(reason.count / (reasons[0]?.count ?? 1)) * 100}%` }" />
            </div>
            <span class="r-count">{{ reason.count }}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h2>Recent conversations</h2>
          <span class="dim small">what it decided and why — not a copy of the messages</span>
        </header>
        <table class="data">
          <tbody>
            <template v-for="review in reviews" :key="review.id">
              <tr class="click" @click="openReview = openReview === review.id ? null : review.id">
                <td>
                  <strong>{{ review.customer }}</strong>
                  <small class="block dim">{{ review.turns[0]?.said }}</small>
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
                    {{ OUTCOME[review.outcome] }}
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
                <td colspan="4">
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
                          <button class="mini" @click.stop="tab = 'knowledge'">Add it</button>
                        </span>
                        <span v-if="turn.didSkill" class="why-tag did">
                          used <b>{{ turn.didSkill }}</b>
                        </span>
                        <span v-if="turn.stoppedBy" class="why-tag stop">
                          stopped by <b>{{ turn.stoppedBy }}</b>
                          <button class="mini" @click.stop="tab = 'handover'">See the rule</button>
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
            <tr v-if="reviews.length === 0">
              <td class="dim">Nothing yet.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- Persona -->
    <section v-if="tab === 'persona'" class="panel wrapped">
      <h3>Who it is</h3>
      <p>The name customers see, and how it speaks.</p>
      <label class="field-label">
        <span>Display name</span>
        <input v-model="name" placeholder="Front desk" />
      </label>
      <label class="field-label">
        <span>What it is for</span>
        <input v-model="purpose" placeholder="Answers questions and books appointments" />
      </label>
      <span class="field-label"><span>How it speaks</span></span>
      <div class="chip-row">
        <button class="on">Warm</button>
        <button class="on">Brief</button>
        <button>Formal</button>
        <button>Chatty</button>
      </div>
      <p class="dim small">
        It never narrates its own record-keeping, never claims an action a tool did not confirm, and
        never gives clinical advice. Those are not adjustable.
      </p>
    </section>

    <!-- Knowledge -->
    <section v-if="tab === 'knowledge'" class="panel">
      <header class="panel-head">
        <h2>What it reads</h2>
        <button class="mini">Add knowledge</button>
      </header>
      <table class="data">
        <tbody>
          <tr>
            <td>
              <div class="cell-id">
                <span class="avatar-sq doc">B</span>
                <div>
                  <strong>{{ account.business }} knowledge</strong>
                  <small>{{ account.knowledge.chunks }} passages, shared by every agent</small>
                </div>
              </div>
            </td>
            <td class="chev-cell"><span class="chip off">inherited</span></td>
          </tr>
          <tr v-for="source in agent?.knowledge?.sources ?? []" :key="source">
            <td>
              <div class="cell-id">
                <span class="avatar-sq">{{ (name || "A").charAt(0) }}</span>
                <div>
                  <strong>{{ source }}</strong>
                  <small>This agent only</small>
                </div>
              </div>
            </td>
            <td class="chev-cell"><button class="mini">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <p class="nudge">
        Its own knowledge is added to the business knowledge, never instead of it.
      </p>
    </section>

    <!-- Skills -->
    <section v-if="tab === 'skills'" class="panel">
      <header class="panel-head">
        <h2>What it may do</h2>
        <span class="dim small">{{ enabled.length }} of {{ skills.length }} on</span>
        <button class="mini" @click="skillSheet = true">Add skill</button>
      </header>
      <table class="data">
        <tbody>
          <tr v-for="skill in skills" :key="skill.id">
            <td>
              <strong>{{ skill.name }}</strong>
              <small class="block dim">{{ skill.detail }}</small>
            </td>
            <td class="num">
              <label class="toggle"><input v-model="skill.on" type="checkbox" /><span /></label>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Handover -->
    <section v-if="tab === 'handover'" class="panel">
      <header class="panel-head">
        <h2>What this agent refuses</h2>
        <button class="mini" @click="ruleSheet = { label: '', detail: '' }">Add a rule</button>
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
      <p class="nudge">
        {{ account.business }}'s business rules fire before these, for every agent.
        <button class="link" @click="go(`account/${account.id}/handover`)">See them</button>
      </p>
    </section>

    <!-- Channels -->
    <section v-if="tab === 'channels'" class="panel">
      <header class="panel-head"><h2>Where it runs</h2></header>
      <table class="data">
        <tbody>
          <tr v-for="channel in ['Web chat', 'SMS', 'Live chat', 'Email']" :key="channel">
            <td>{{ channel }}</td>
            <td class="num">
              <label class="toggle">
                <input
                  type="checkbox"
                  :checked="channels.includes(channel)"
                  @change="
                    channels = channels.includes(channel)
                      ? channels.filter((entry) => entry !== channel)
                      : [...channels, channel]
                  "
                /><span />
              </label>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Sheets -->
    <ModalSheet
      v-if="skillSheet"
      title="Add a skill"
      subtitle="What this agent is allowed to do, beyond answering."
      submit="Done"
      @close="skillSheet = false"
      @save="skillSheet = false"
    >
      <div class="skill-picker">
        <label v-for="skill in skills" :key="skill.id" class="skill-row" :class="{ on: skill.on }">
          <input v-model="skill.on" type="checkbox" />
          <span class="check" />
          <div>
            <strong>{{ skill.name }}</strong>
            <small>{{ skill.detail }}</small>
          </div>
        </label>
      </div>

      <p class="field-label"><span>Not available yet</span></p>
      <div class="skill-picker">
        <div v-for="skill in offCatalogue" :key="skill.id" class="skill-row off">
          <span class="check" />
          <div>
            <strong>{{ skill.name }}</strong>
            <small>{{ skill.detail }}</small>
          </div>
          <button class="mini">Request</button>
        </div>
      </div>
      <p class="dim small">
        Skills reach your CRM, so the list is what we have built and tested. Requesting one tells us
        it is wanted.
      </p>
    </ModalSheet>

    <ModalSheet
      v-if="ruleSheet"
      :title="ruleSheet.id ? 'Edit rule' : 'New rule'"
      subtitle="When this agent should stop and fetch a person."
      @close="ruleSheet = null"
      @save="saveRule"
    >
      <label class="field-label">
        <span>Title</span>
        <input v-model="ruleSheet.label" placeholder="Customer disputes a charge" />
      </label>
      <label class="field-label">
        <span>When it fires</span>
        <textarea v-model="ruleSheet.detail" rows="3" placeholder="Describe it in plain words." />
      </label>
    </ModalSheet>
  </div>
</template>
