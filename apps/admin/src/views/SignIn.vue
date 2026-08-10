<script setup lang="ts">
import { ref } from "vue";
import { go } from "../router";
import { PERSONAS, signIn } from "../session";
import AuthLayout from "./AuthLayout.vue";

const email = ref("");
const showAccounts = ref(false);
</script>

<template>
  <AuthLayout
    quote="It answers the fee questions properly and books the ones that are ready. The rest it hands to us, which is the bit I did not expect to be the good part."
    attribution="Rae Whitfield"
    role="Operations, Brightline Digital"
  >
    <h1>Welcome back</h1>
    <p class="auth-sub">Sign in to your LafaGafa account.</p>

    <div class="sso">
      <button class="sso-btn">
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3.01-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        Continue with Google
      </button>
      <button class="sso-btn">
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
          <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
          <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
          <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
        </svg>
        Continue with Microsoft
      </button>
    </div>

    <div class="divider"><span>or</span></div>

    <label class="field-label">
      <span>Work email</span>
      <input v-model="email" placeholder="you@practice.com" autocomplete="email" />
    </label>
    <label class="field-label">
      <span class="with-aside">Password <button class="link tiny">Forgot?</button></span>
      <input type="password" placeholder="••••••••" autocomplete="current-password" />
    </label>

    <button class="solid full" @click="showAccounts = true">Sign in</button>

    <transition name="panel">
      <div v-if="showAccounts" class="demo-accounts">
        <p class="dim small">
          This is a demonstration. Choose an account — the product is laid out differently for each.
        </p>
        <button v-for="who in PERSONAS" :key="who.email" @click="signIn(who)">
          <span class="avatar">{{ who.name.charAt(0) }}</span>
          <div>
            <strong>{{ who.name }}</strong>
            <span class="dim small">{{ who.blurb }}</span>
          </div>
          <span class="tag" :class="who.org.type">
            {{ who.org.type === "agency" ? "Agency" : "Business" }}
          </span>
        </button>
      </div>
    </transition>

    <p class="auth-foot">
      New to LafaGafa?
      <button class="solid ghost-solid" @click="go('signup')">Sign up</button>
    </p>
  </AuthLayout>
</template>
