<script setup lang="ts">
import { computed } from "vue";
import { route } from "./router";
import { identity, signOut, staff } from "./session";
import AccountView from "./views/AccountView.vue";
import AdminEvals from "./views/AdminEvals.vue";
import AdminFleet from "./views/AdminFleet.vue";
import AdminModels from "./views/AdminModels.vue";
import AdminPlatform from "./views/AdminPlatform.vue";
import AdminQuality from "./views/AdminQuality.vue";
import AdminShell from "./views/AdminShell.vue";
import AdminTraces from "./views/AdminTraces.vue";
import AdminSignIn from "./views/AdminSignIn.vue";
import AgentView from "./views/AgentView.vue";
import AppShell from "./views/AppShell.vue";
import DashboardView from "./views/DashboardView.vue";
import MarketingPage from "./views/MarketingPage.vue";
import OnboardingFlow from "./views/OnboardingFlow.vue";
import SignIn from "./views/SignIn.vue";
import SignUpFlow from "./views/SignUpFlow.vue";

/**
 * Three products, one build, kept apart by which door you came through.
 *
 * Marketing is public. The dashboard belongs to a customer — an agency or a single business — and
 * shows only their own organisation. The admin console belongs to LafaGafa and shows every
 * conversation on the platform, so it has its own route and its own sign-in rather than being a
 * role a customer session could hold.
 */

const staffSection = computed(() => route.value.params[0] ?? "traces");

const view = computed(() => {
  const path = route.value.path;
  // The root is the marketing page whether or not anyone is signed in. Everything below is a
  // fallthrough to the dashboard, so without this an existing session moves the product's front
  // door, which is not what a landing page is for.
  if (path === "") return "marketing";
  if (path === "admin") return staff.value ? "admin" : "admin-signin";
  if (path === "signin") return "signin";
  if (path === "signup") return "signup";
  if (!identity.value) return "marketing";
  // Signed up but not set up: there is no dashboard to show yet, so onboarding is the only room.
  if (identity.value.org === null) return "onboarding";
  if (path === "onboarding") return "onboarding";
  if (path === "account") return "account";
  if (path === "agent") return "agent";
  return "dashboard";
});
</script>

<template>
  <MarketingPage v-if="view === 'marketing'" />
  <SignIn v-else-if="view === 'signin'" />
  <SignUpFlow v-else-if="view === 'signup'" />
  <AdminSignIn v-else-if="view === 'admin-signin'" />

  <!-- Staff: the platform console. Real traces. -->
  <template v-else-if="view === 'admin'">
    <AdminShell>
      <AdminFleet
        v-if="staffSection === 'fleet' || staffSection === 'changes'"
        :section="staffSection"
      />
      <AdminEvals
        v-else-if="staffSection === 'evals' || staffSection === 'behaviour'"
        :section="staffSection"
      />
      <AdminModels v-else-if="staffSection === 'models'" />
      <AdminQuality v-else-if="staffSection === 'quality'" />
      <AdminPlatform
        v-else-if="staffSection === 'platform' || staffSection === 'runtime'"
        :section="staffSection"
      />
      <AdminTraces v-else :section="staffSection" />
    </AdminShell>
  </template>

  <!-- Operator: an agency or a single business, seeing only their own organisation. -->
  <template v-else>
    <!-- Onboarding runs without the shell: an account with no org has nowhere to navigate yet. -->
    <div v-if="identity && identity.org === null" class="bare-canvas">
      <button class="wordmark bare-mark" @click="signOut"><span>Lafa</span>Gafa</button>
      <OnboardingFlow />
    </div>
    <AppShell v-else>
      <DashboardView v-if="view === 'dashboard'" />
      <OnboardingFlow v-else-if="view === 'onboarding'" />
      <AccountView v-else-if="view === 'account'" />
      <AgentView v-else-if="view === 'agent'" />
    </AppShell>
  </template>
</template>
