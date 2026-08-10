<script setup lang="ts">
import { nextTick, ref } from "vue";

/**
 * The conversational way in, kept as a card at the top of an empty agent rather than a wizard.
 *
 * Describing what you want is faster than filling a form, but it should not be a different route
 * with a different result — so it fills the form in front of you and then gets out of the way. You
 * can always ignore it and type into the fields yourself.
 */

const emit = defineEmits<{
  proposed: [value: { name: string; purpose: string; skills: string[]; template: string }];
}>();

const said = ref("");
const thinking = ref(false);
const done = ref(false);
const transcript = ref<Array<{ mine: boolean; text: string }>>([]);
const thread = ref<HTMLElement | null>(null);

/** Keyword matching, so the mock answers what was typed instead of ignoring it. */
function propose(text: string) {
  const lower = text.toLowerCase();
  if (/bill|invoice|payment|refund|membership|account/.test(lower)) {
    return {
      name: "Billing support",
      purpose: "Payments, memberships and invoices. Never approves a refund.",
      skills: ["update_contact", "human_handover"],
      template: "Support desk",
    };
  }
  if (/night|evening|weekend|out of hours|emergency|urgent|after hours/.test(lower)) {
    return {
      name: "Out of hours",
      purpose: "Covers evenings and weekends, routes anything urgent to on-call.",
      skills: ["update_contact", "human_handover"],
      template: "Out-of-hours triage",
    };
  }
  return {
    name: "Front desk",
    purpose: "Answers questions, books appointments, hands over when it should not.",
    skills: ["update_contact", "book_appointment", "human_handover"],
    template: "Front desk receptionist",
  };
}

async function send() {
  const text = said.value.trim();
  if (text === "") return;
  transcript.value.push({ mine: true, text });
  said.value = "";
  thinking.value = true;
  await nextTick();
  thread.value?.scrollTo({ top: thread.value.scrollHeight });

  globalThis.setTimeout(() => {
    const proposal = propose(text);
    thinking.value = false;
    done.value = true;
    transcript.value.push({
      mine: false,
      text: `A ${proposal.name.toLowerCase()} agent, then. I have filled everything in below — change whatever you disagree with.`,
    });
    emit("proposed", proposal);
  }, 1000);
}
</script>

<template>
  <section class="panel describe">
    <header class="panel-head">
      <h2>Describe what you need</h2>
      <span class="dim small">or ignore this and fill in the tabs yourself</span>
    </header>

    <div v-if="transcript.length > 0" ref="thread" class="mini-thread">
      <div
        v-for="(line, index) in transcript"
        :key="index"
        :class="['bubble', line.mine ? 'me' : 'them']"
      >
        {{ line.text }}
      </div>
      <div v-if="thinking" class="bubble them typing"><i /><i /><i /></div>
    </div>

    <form v-if="!done" class="mini-composer padded" @submit.prevent="send">
      <input v-model="said" placeholder="Someone to handle billing questions after hours" />
      <button class="solid" :disabled="said.trim() === ''">Send</button>
    </form>
  </section>
</template>
