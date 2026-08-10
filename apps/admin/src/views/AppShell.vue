<script setup lang="ts">
import { computed } from "vue";
import { agentById, agentsFor, subAccountById, subAccountsFor } from "../mock/tenancy";
import { go, route } from "../router";
import { identity, signOut } from "../session";

/**
 * The shell, whose sidebar *becomes* the sub-account's sections once you step into one, rather than
 * growing a second rail beside it. See docs/architecture.md#scope-is-a-place.
 */

const org = computed(() => identity.value?.org);
const accounts = computed(() => (org.value ? subAccountsFor(org.value.id) : []));

/** A sub-account context is entered from its own page or from any agent inside it. */
const account = computed(() => {
  const path = route.value.path;
  const id = route.value.params[0] ?? "";
  if (path === "account") return subAccountById(id);
  if (path === "agent")
    return id === "new"
      ? subAccountById(route.value.params[1] ?? "")
      : subAccountById(agentById(id)?.subAccountId ?? "");
  return undefined;
});

const section = computed(() =>
  route.value.path === "agent" ? "agents" : (route.value.params[1] ?? "overview"),
);

const ORG_NAV = computed(() => [
  { id: "", label: "Overview", count: null },
  { id: "sub-accounts", label: "Sub-accounts", count: accounts.value.length },
  { id: "plan", label: "Plan and billing", count: null },
]);

const ACCOUNT_NAV = computed(() => [
  { id: "overview", label: "Overview", count: null },
  { id: "agents", label: "Agents", count: account.value ? agentsFor(account.value.id).length : 0 },
  { id: "knowledge", label: "Knowledge", count: null },
  { id: "conversations", label: "Conversations", count: null },
  { id: "handover", label: "Handover rules", count: null },
]);
</script>

<template>
  <div class="shell">
    <aside class="side">
      <button class="side-brand" @click="go('dashboard')">
        <span class="wordmark small"><span>Lafa</span>Gafa</span>
      </button>

      <!-- Inside a sub-account: the rail becomes its own, with the way out on top. -->
      <template v-if="account">
        <button class="context-back" @click="go('dashboard')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          {{ org?.name }}
        </button>
        <div class="context-head">
          <span class="avatar-sq">{{ account.business.charAt(0) }}</span>
          <div>
            <strong>{{ account.business }}</strong>
            <small>{{ account.industry }}</small>
          </div>
        </div>
        <nav class="side-nav">
          <button
            v-for="item in ACCOUNT_NAV"
            :key="item.id"
            :class="{ on: section === item.id }"
            @click="go(`account/${account.id}/${item.id}`)"
          >
            {{ item.label }}
            <span v-if="item.count !== null" class="count">{{ item.count }}</span>
          </button>
        </nav>
      </template>

      <!-- Organisation level: what an owner manages. -->
      <template v-else>
        <button class="org-switch" @click="go('dashboard')">
          <span class="org-badge">{{ org?.name.charAt(0) }}</span>
          <span class="org-meta">
            <strong>{{ org?.name ?? "Setting up" }}</strong>
            <small>{{ org?.plan ?? "New account" }}</small>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4-4 4 4M16 15l-4 4-4-4" /></svg>
        </button>
        <nav class="side-nav">
          <button
            v-for="item in ORG_NAV"
            :key="item.label"
            :class="{ on: (route.params[0] ?? '') === item.id && route.path === 'dashboard' }"
            @click="go(item.id === '' ? 'dashboard' : `dashboard/${item.id}`)"
          >
            {{ item.label }}
            <span v-if="item.count !== null" class="count">{{ item.count }}</span>
          </button>
        </nav>
      </template>

      <div class="side-foot">
        <button v-if="!account" class="side-cta" @click="go('onboarding')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New sub-account
        </button>
        <button v-else class="side-cta" @click="go(`agent/new/${account.id}`)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New agent
        </button>
        <div class="side-user">
          <span class="org-badge sm">{{ identity?.name.charAt(0).toUpperCase() }}</span>
          <div>
            <strong>{{ identity?.name }}</strong>
            <small>{{ identity?.email }}</small>
          </div>
          <button class="icon-btn" title="Sign out" @click="signOut">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <main class="canvas">
      <slot />
    </main>
  </div>
</template>
