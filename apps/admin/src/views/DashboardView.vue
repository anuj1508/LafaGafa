<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type GapRow } from "../api";
import { agentsFor, funnelFor, isActive, subAccountsFor } from "../mock/tenancy";
import { go } from "../router";
import { identity } from "../session";

/**
 * The organisation's dashboard. One layout, both plans: a single business is an agency capped at
 * one sub-account, and upgrading should not move anyone somewhere unfamiliar.
 */

const org = computed(() => identity.value?.org);
const accounts = computed(() => (org.value ? subAccountsFor(org.value.id) : []));

const gaps = ref<GapRow[]>([]);
const gapsFailed = ref(false);

onMounted(async () => {
  try {
    gaps.value = await api.gaps();
  } catch {
    gapsFailed.value = true;
  }
});

const gapsFor = (locationId: string) =>
  gaps.value.filter((gap) => gap.locationId === locationId).length;

const estate = computed(() => {
  const agents = accounts.value.flatMap((account) => agentsFor(account.id));
  return {
    used: accounts.value.length,
    limit: org.value?.maxSubAccounts ?? 1,
    active: accounts.value.filter((account) => isActive(account.id)).length,
    agents: agents.length,
    live: agents.filter((agent) => agent.status === "live").length,
    draft: agents.filter((agent) => agent.status === "draft").length,
  };
});

const totals = computed(() =>
  accounts.value.reduce(
    (acc, account) => {
      const funnel = funnelFor(account.id);
      return {
        conversations: acc.conversations + funnel.conversations,
        leads: acc.leads + funnel.leads,
        booked: acc.booked + funnel.booked,
        handed: acc.handed + funnel.handed,
      };
    },
    { conversations: 0, leads: 0, booked: 0, handed: 0 },
  ),
);

/** Deltas are fixtures, but they are the reason anyone looks twice at a number. */
const METRICS = computed(() => [
  {
    label: "Appointments booked",
    value: totals.value.booked,
    delta: 18,
    note: "last 30 days",
    accent: true,
  },
  { label: "Leads created", value: totals.value.leads, delta: 11, note: "last 30 days" },
  { label: "Conversations", value: totals.value.conversations, delta: 6, note: "last 30 days" },
  {
    label: "Handed to a human",
    value: totals.value.handed,
    delta: -4,
    note: `${rate(totals.value.handed, totals.value.leads)} of leads`,
    good: true,
  },
]);

const atLimit = computed(() => estate.value.used >= estate.value.limit);
const liveIn = (subAccountId: string) =>
  agentsFor(subAccountId).filter((agent) => agent.status === "live").length;

function rate(part: number, whole: number) {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}
const width = (part: number) =>
  totals.value.conversations === 0
    ? "0%"
    : `${Math.max(8, Math.round((part / totals.value.conversations) * 100))}%`;
</script>

<template>
  <div v-if="org" class="view">
    <header class="view-head">
      <div>
        <p class="crumb">{{ org.plan }} plan</p>
        <h1>Overview</h1>
      </div>
      <div class="head-actions">
        <div class="quota" :class="{ full: atLimit }">
          <span>{{ estate.used }} / {{ estate.limit }}</span> sub-accounts
        </div>
        <button class="solid" :disabled="atLimit" @click="go('onboarding')">Add sub-account</button>
      </div>
    </header>

    <section class="metrics">
      <article v-for="metric in METRICS" :key="metric.label" :class="{ accent: metric.accent }">
        <p class="m-label">{{ metric.label }}</p>
        <p class="m-value">{{ metric.value.toLocaleString() }}</p>
        <p class="m-foot">
          <span class="delta" :class="metric.delta > 0 === !metric.good ? 'up' : 'down'">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path v-if="metric.delta > 0" d="M12 19V5M5 12l7-7 7 7" />
              <path v-else d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
            {{ Math.abs(metric.delta) }}%
          </span>
          {{ metric.note }}
        </p>
      </article>
    </section>

    <div class="split-2">
      <section class="panel">
        <header class="panel-head">
          <h2>Where it narrows</h2>
          <span class="dim small">last 30 days</span>
        </header>
        <div class="funnel-bars">
          <div class="fbar">
            <div class="fbar-head">
              <strong>{{ totals.conversations.toLocaleString() }}</strong>
              <span>conversations</span>
            </div>
            <div class="track"><span style="width: 100%" /></div>
          </div>
          <div class="fbar">
            <div class="fbar-head">
              <strong>{{ totals.leads }}</strong>
              <span>leads created</span>
              <em>{{ rate(totals.leads, totals.conversations) }}</em>
            </div>
            <div class="track"><span :style="{ width: width(totals.leads) }" /></div>
          </div>
          <div class="fbar win">
            <div class="fbar-head">
              <strong>{{ totals.booked }}</strong>
              <span>appointments booked</span>
              <em>{{ rate(totals.booked, totals.leads) }} of leads</em>
            </div>
            <div class="track"><span :style="{ width: width(totals.booked) }" /></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>Estate</h2></header>
        <ul class="stat-list">
          <li>
            <span>Sub-accounts active</span>
            <b :class="{ warn: estate.active < estate.used }">
              {{ estate.active }}<i>/ {{ estate.used }}</i>
            </b>
          </li>
          <li>
            <span>Agents live</span>
            <b
              >{{ estate.live }}<i>/ {{ estate.agents }}</i></b
            >
          </li>
          <li>
            <span>Still in draft</span>
            <b :class="{ warn: estate.draft > 0 }">{{ estate.draft }}</b>
          </li>
          <li>
            <span>Unanswered questions</span>
            <b :class="{ warn: gaps.length > 0 }">{{ gapsFailed ? "—" : gaps.length }}</b>
          </li>
        </ul>
        <p v-if="estate.draft > 0" class="nudge">
          {{ estate.draft }} agents built but never switched on.
          <button class="link">Review them</button>
        </p>
      </section>
    </div>

    <section class="panel">
      <header class="panel-head">
        <h2>Sub-accounts</h2>
        <span class="dim small">open one to manage its agents and knowledge</span>
      </header>
      <table class="data">
        <thead>
          <tr>
            <th>Business</th>
            <th>Status</th>
            <th class="num">Agents</th>
            <th class="num">Conversations</th>
            <th class="num">Leads</th>
            <th class="num">Booked</th>
            <th class="num">To a human</th>
            <th class="num">Gaps</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="account in accounts"
            :key="account.id"
            class="click"
            @click="go(`account/${account.id}/overview`)"
          >
            <td>
              <div class="cell-id">
                <span class="avatar-sq">{{ account.business.charAt(0) }}</span>
                <div>
                  <strong>{{ account.business }}</strong>
                  <small>{{ account.website || account.industry }}</small>
                </div>
              </div>
            </td>
            <td>
              <span v-if="isActive(account.id)" class="chip live">Active</span>
              <span v-else-if="account.knowledge.status === 'building'" class="chip building">
                Building
              </span>
              <span v-else class="chip off">Not live</span>
            </td>
            <td class="num">
              {{ liveIn(account.id) }}<i>/{{ agentsFor(account.id).length }}</i>
            </td>
            <td class="num">{{ funnelFor(account.id).conversations }}</td>
            <td class="num">{{ funnelFor(account.id).leads }}</td>
            <td class="num accent">{{ funnelFor(account.id).booked }}</td>
            <td class="num">{{ funnelFor(account.id).handed }}</td>
            <td class="num" :class="{ warn: gapsFor(account.locationId) > 0 }">
              {{ gapsFailed ? "—" : gapsFor(account.locationId) }}
            </td>
            <td class="chev-cell">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
