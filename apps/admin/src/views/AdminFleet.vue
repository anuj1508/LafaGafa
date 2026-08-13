<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AGENTS,
  agentsFor,
  CONFIG_CHANGES,
  funnelFor,
  ORGS,
  SUB_ACCOUNTS,
  subAccountsFor,
} from "../mock/tenancy";
import { scope } from "../scope";
import DataBadge from "./DataBadge.vue";

/** Who is on the platform. Support opens this to find a customer; sales to see the shape of one. */

const props = defineProps<{ section: string }>();
const tab = ref<"orgs" | "accounts" | "agents" | "changes">(
  props.section === "changes" ? "changes" : "orgs",
);
watch(
  () => props.section,
  (section) => (tab.value = section === "changes" ? "changes" : "orgs"),
);

const accounts = computed(() =>
  SUB_ACCOUNTS.filter(
    (account) =>
      (scope.of("org") === undefined || account.orgId === scope.of("org")) &&
      (scope.of("account") === undefined || account.id === scope.of("account")),
  ),
);
const agents = computed(() =>
  AGENTS.filter(
    (agent) =>
      accounts.value.some((account) => account.id === agent.subAccountId) &&
      (scope.of("agent") === undefined || agent.id === scope.of("agent")),
  ),
);
const orgs = computed(() =>
  ORGS.filter((org) => scope.of("org") === undefined || org.id === scope.of("org")),
);
const changes = computed(() =>
  CONFIG_CHANGES.filter((change) =>
    accounts.value.some((account) => account.id === change.subAccountId),
  ),
);

const nameOf = (id: string) => SUB_ACCOUNTS.find((a) => a.id === id)?.business ?? id;
</script>

<template>
  <div>
    <nav class="steps-nav">
      <button :class="{ on: tab === 'orgs' }" @click="tab = 'orgs'">
        Organisations <span class="count">{{ orgs.length }}</span>
      </button>
      <button :class="{ on: tab === 'accounts' }" @click="tab = 'accounts'">
        Sub-accounts <span class="count">{{ accounts.length }}</span>
      </button>
      <button :class="{ on: tab === 'agents' }" @click="tab = 'agents'">
        Agents <span class="count">{{ agents.length }}</span>
      </button>
      <button :class="{ on: tab === 'changes' }" @click="tab = 'changes'">
        Changes <span class="count">{{ changes.length }}</span>
      </button>
    </nav>

    <section v-if="tab === 'orgs'" class="panel">
      <table class="data">
        <thead>
          <tr>
            <th>Organisation</th>
            <th>Type</th>
            <th>Plan</th>
            <th>Trade</th>
            <th>Came for</th>
            <th class="num">Sub-accounts</th>
            <th class="num">Seats</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="org in orgs" :key="org.id">
            <td>
              <strong>{{ org.name }}</strong
              ><small class="block dim">{{ org.owner }}</small>
            </td>
            <td>
              <span class="chip" :class="org.type === 'agency' ? 'live' : 'off'">{{
                org.type
              }}</span>
            </td>
            <td class="dim">{{ org.plan }}</td>
            <td class="dim">{{ org.industry }}</td>
            <td class="dim">{{ org.useCase }}</td>
            <td class="num">
              {{ subAccountsFor(org.id).length }}<i>/{{ org.maxSubAccounts }}</i>
            </td>
            <td class="num">{{ org.seats }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'accounts'" class="panel">
      <table class="data">
        <thead>
          <tr>
            <th>Sub-account</th>
            <th>GHL location</th>
            <th class="num">Agents</th>
            <th class="num">Passages</th>
            <th class="num">Conversations</th>
            <th class="num">Booked</th>
            <th class="num">Handed</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.id">
            <td>
              <strong>{{ account.business }}</strong>
              <small class="block dim">{{ account.website || account.industry }}</small>
            </td>
            <td class="dim nowrap">
              <code>{{ account.locationId }}</code>
            </td>
            <td class="num">{{ agentsFor(account.id).length }}</td>
            <td class="num">{{ account.knowledge.chunks }}</td>
            <td class="num">{{ funnelFor(account.id).conversations }}</td>
            <td class="num accent">{{ funnelFor(account.id).booked }}</td>
            <td class="num">{{ funnelFor(account.id).handed }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'agents'" class="panel">
      <table class="data">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Sub-account</th>
            <th>Status</th>
            <th>Channels</th>
            <th class="num">Turns 7d</th>
            <th class="num">Self-served</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="agent in agents" :key="agent.id">
            <td>
              <strong>{{ agent.name }}</strong
              ><small class="block dim">{{ agent.template }}</small>
            </td>
            <td class="dim">{{ nameOf(agent.subAccountId) }}</td>
            <td>
              <span class="chip" :class="agent.status === 'live' ? 'live' : 'off'">{{
                agent.status
              }}</span>
            </td>
            <td class="dim">{{ agent.channels.join(", ") }}</td>
            <td class="num">{{ agent.turns7d }}</td>
            <td class="num">{{ Math.round(agent.containment * 100) }}%</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- The audit trail: why a customer's behaviour changed. -->
    <section v-if="tab === 'changes'" class="panel">
      <header class="panel-head">
        <h2>Configuration changes</h2>
        <DataBadge kind="sample" />
        <span class="dim small">the answer to "it started doing that on Tuesday"</span>
      </header>
      <table class="data">
        <thead>
          <tr>
            <th>When</th>
            <th>Sub-account</th>
            <th>Setting</th>
            <th>Change</th>
            <th>Who</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="change in changes" :key="change.id">
            <td class="dim nowrap">{{ change.at }}</td>
            <td>{{ nameOf(change.subAccountId) }}</td>
            <td>
              <strong>{{ change.label }}</strong>
              <small class="block dim"
                ><code>{{ change.setting }}</code></small
              >
            </td>
            <td class="nowrap">
              <span class="was">{{ change.before }}</span>
              <svg viewBox="0 0 24 24" class="arrow" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <span class="now">{{ change.after }}</span>
            </td>
            <td class="dim">{{ change.actor }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
