<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

interface Session {
  sessionId: string;
  contactId: string;
  conversationId: string;
}

/**
 * Absolute in deployment, empty in dev where Vite proxies `/api` onto one origin.
 * A CDN proxy buffers the reply stream until it ends, so it has to be reached directly.
 */
const API = import.meta.env.VITE_API_BASE ?? "";

const AGENT_NAME = "Clare";

const OPENERS = [
  "What are your opening hours?",
  "How much is a check-up?",
  "Can I book something for tomorrow morning?",
];

const open = ref(false);
const messages = ref<Array<{ text: string; mine: boolean }>>([]);
const draft = ref("");
const session = ref<Session | null>(null);
const working = ref(false);
const status = ref("online");
const thread = ref<HTMLElement | null>(null);
const field = ref<HTMLInputElement | null>(null);

async function scrollDown() {
  await nextTick();
  thread.value?.scrollTo({ top: thread.value.scrollHeight, behavior: "smooth" });
}

/** Attached before the first message is posted, so a reply cannot arrive before anyone is reading. */
function listen(sessionId: string) {
  const stream = new EventSource(`${API}/api/chat/stream?sessionId=${sessionId}`);
  stream.onmessage = (event: MessageEvent<string>) => {
    const payload = JSON.parse(event.data) as { event: string; text?: string };
    if (payload.event !== "reply") return;
    working.value = false;
    messages.value.push({ text: payload.text ?? "", mine: false });
    void scrollDown();
  };
  stream.onerror = () => {
    status.value = "reconnecting";
  };
  stream.onopen = () => {
    status.value = "online";
  };
}

/*
 * Created on the first message, never on page load.
 *
 * Opening a session mints a real CRM contact and conversation, so doing it eagerly filed an empty
 * conversation against a "Web Visitor" contact every time anybody refreshed the page.
 */
async function ensureSession(): Promise<Session | null> {
  if (session.value) return session.value;
  try {
    const response = await fetch(`${API}/api/chat/session`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    const started = (await response.json()) as Session;
    listen(started.sessionId);
    session.value = started;
    return started;
  } catch (error) {
    status.value = error instanceof Error ? error.message : "could not connect";
    return null;
  }
}

watch(open, async (isOpen) => {
  if (!isOpen) return;
  await nextTick();
  field.value?.focus();
  void scrollDown();
});

async function send(text: string) {
  const body = text.trim();
  if (!body || working.value) return;
  draft.value = "";
  messages.value.push({ text: body, mine: true });
  working.value = true;
  void scrollDown();

  const active = await ensureSession();
  const response = active
    ? await fetch(`${API}/api/chat/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: active.sessionId, text: body }),
      })
    : null;

  if (!response?.ok) {
    working.value = false;
    messages.value.push({ text: "That didn't send. Try again?", mine: false });
  }
}
</script>

<template>
  <div class="widget">
    <transition name="panel">
      <section v-if="open" class="panel" aria-label="Chat with the front desk">
        <header>
          <div class="who">
            <span class="avatar" aria-hidden="true">C</span>
            <div>
              <div class="name">{{ AGENT_NAME }}</div>
              <!-- Named, but never passed off as a person. Someone deciding whether to trust an
                   answer about their own teeth is entitled to know what they are talking to. -->
              <div class="role">Digital front desk &middot; {{ status }}</div>
            </div>
          </div>
          <button class="close" aria-label="Close chat" @click="open = false">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div ref="thread" class="thread">
          <div class="msg them">
            Hello, I'm {{ AGENT_NAME }} — I look after the front desk here. Ask me anything, or tell
            me when you'd like to come in.
          </div>
          <div
            v-for="(message, index) in messages"
            :key="index"
            class="msg"
            :class="message.mine ? 'me' : 'them'"
          >
            {{ message.text }}
          </div>
          <div v-if="working" class="typing" aria-label="Typing"><i /><i /><i /></div>
        </div>

        <div v-if="messages.length === 0" class="openers">
          <button v-for="opener in OPENERS" :key="opener" @click="send(opener)">
            {{ opener }}
          </button>
        </div>

        <form @submit.prevent="send(draft)">
          <input
            ref="field"
            v-model="draft"
            placeholder="Type a message"
            :disabled="working"
            autocomplete="off"
          />
          <button
            class="send"
            :disabled="working || draft.trim().length === 0"
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>

        <p class="disclaimer">
          {{ AGENT_NAME }} is an automated assistant and cannot give clinical advice. Ask for a
          person at any point.
        </p>
      </section>
    </transition>

    <button class="launcher" :class="{ active: open }" @click="open = !open">
      <svg v-if="!open" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12a8 8 0 01-8 8H7l-4 3v-7a8 8 0 018-8h2a8 8 0 018 4z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
      <span v-if="!open">Talk to {{ AGENT_NAME }}</span>
    </button>
  </div>
</template>
