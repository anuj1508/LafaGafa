<script setup lang="ts">
import { go } from "../router";

/**
 * The split every signed-out screen shares: form on the left, reason to bother on the right.
 *
 * The right panel is not decoration. Someone on a sign-up page has not yet decided, and a blank
 * indigo field wastes the only moment they are still reading — so it carries the one claim the
 * product is actually built around.
 */

defineProps<{ quote: string; attribution: string; role: string }>();
</script>

<template>
  <div class="auth">
    <section class="auth-form">
      <button class="wordmark auth-mark" @click="go('')"><span>Lafa</span>Gafa</button>
      <div class="auth-body">
        <slot />
      </div>
    </section>

    <aside class="auth-aside">
      <div class="aside-inner">
        <svg class="quote-mark" viewBox="0 0 32 24" aria-hidden="true">
          <path
            d="M13 24V13C13 6 8 1 1 0v5c4 1 6 4 6 8H1v11h12zm18 0V13c0-7-5-12-12-13v5c4 1 6 4 6 8h-6v11h12z"
          />
        </svg>
        <p class="aside-quote">{{ quote }}</p>
        <div class="aside-who">
          <span class="aside-avatar">{{ attribution.charAt(0) }}</span>
          <div>
            <strong>{{ attribution }}</strong>
            <span>{{ role }}</span>
          </div>
        </div>

        <dl class="aside-proof">
          <div>
            <dt>0</dt>
            <dd>prices invented last month</dd>
          </div>
          <div>
            <dt>86%</dt>
            <dd>handled without a person</dd>
          </div>
          <div>
            <dt>2.9s</dt>
            <dd>median reply</dd>
          </div>
        </dl>
      </div>
    </aside>
  </div>
</template>
