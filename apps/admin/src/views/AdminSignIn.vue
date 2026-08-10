<script setup lang="ts">
import { ref } from "vue";
import { go } from "../router";
import { signInAsStaff } from "../session";

/** LafaGafa's own door. Not reachable from the customer sign-in, and not advertised on it. */

const email = ref("toby@lafagafa.example");
</script>

<template>
  <div class="admin-door">
    <div class="door-card">
      <div class="brand-row">
        <div class="wordmark"><span>Lafa</span>Gafa</div>
        <span class="env">admin</span>
      </div>
      <h1>Staff sign in</h1>
      <p class="auth-sub">Internal access.</p>

      <label class="field-label">
        <span>Work email</span>
        <input v-model="email" @keyup.enter="signInAsStaff(email)" />
      </label>
      <label class="field-label">
        <span>Password</span>
        <input type="password" value="mocked" @keyup.enter="signInAsStaff(email)" />
      </label>

      <button class="solid full" @click="signInAsStaff(email)">Sign in</button>
      <button class="back-link door-back" @click="go('')">Return to lafagafa.example</button>
    </div>
  </div>
</template>
