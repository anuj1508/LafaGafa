<script setup lang="ts">
import { go } from "../router";

/**
 * The pitch is an inversion: named after waffle, sells the opposite.
 *
 * Every claim below is one the harness can actually be held to — a relevance floor that produces
 * "I don't know" instead of a plausible number, a trace for every step, a handover that fires
 * before a bluff does. Marketing copy that outruns the product is the one thing this page must not
 * do, given what it is selling.
 */

const PROOF = [
  { figure: "0", label: "prices invented last month", note: "across 1,140 answered questions" },
  {
    figure: "86%",
    label: "handled without a person",
    note: "the rest reached one in under a minute",
  },
  { figure: "2.9s", label: "median reply", note: "measured webhook to send, not to first token" },
];

const PILLARS = [
  {
    title: 'It says "I don\'t know"',
    body: "Answers come from your own pages, scored against a relevance floor. Nothing clears the floor, nothing gets said. Competitors call this a limitation until the day one of them quotes a price you do not charge.",
  },
  {
    title: "It knows when to stop",
    body: "Clinical questions, complaints, billing disputes and anyone who simply asks for a person — all of it goes to a human before the agent has a chance to improvise. You choose the triggers; it never overrides them.",
  },
  {
    title: "You can see why it said that",
    body: "Every turn keeps a full trace: what was retrieved, what scored what, which tools ran, what came back, and where the milliseconds went. Not a log to grep. A page to read.",
  },
  {
    title: "It finishes things",
    body: "Booking is the point. It checks real availability, holds the range someone asked for, takes their details at the right moment, and writes the appointment into your CRM.",
  },
];

const STEPS = [
  {
    n: "01",
    t: "Paste your website",
    d: "We read it and build the knowledge base. No forms, no spreadsheet of FAQs, no training data to assemble.",
  },
  {
    n: "02",
    t: "Take the bot we suggest",
    d: "We look at what your site is and propose the bots that fit it, already configured for your industry.",
  },
  {
    n: "03",
    t: "Read the first day",
    d: "Watch the traces. Adjust what you disagree with. Most people change two or three things and stop.",
  },
];

const FAQ = [
  {
    q: "What does LafaGafa mean?",
    a: "Blah blah. Waffle. The sound of a lot of words that answer nothing. We named the company after the problem so we would never be allowed to become it.",
  },
  {
    q: "Will it make things up?",
    a: "It retrieves from your pages and scores what it finds. Below the floor, it declines and offers a person rather than filling the silence. That behaviour is measured on every release against a suite of questions we have deliberately given it no answer to.",
  },
  {
    q: "Does it work with GoHighLevel?",
    a: "It is built on it. Each of your sub-accounts maps to a GHL location, and conversations, contacts and appointments stay in the CRM your team already reads.",
  },
  {
    q: "Agency or single site?",
    a: "Both. An agency runs many sub-accounts under one organisation with per-client billing. A single practice runs one, and never sees the agency layer at all.",
  },
];
</script>

<template>
  <div class="marketing">
    <header class="mk-nav">
      <div class="wordmark"><span>Lafa</span>Gafa</div>
      <nav>
        <a href="#why">Why</a>
        <a href="#how">How it works</a>
        <a href="#faq">FAQ</a>
      </nav>
      <button class="ghost" @click="go('signin')">Sign in</button>
    </header>

    <section class="mk-hero">
      <p class="kicker">Conversation AI for practices, clinics and the agencies who run them</p>
      <h1>
        We are named after<br />
        talking rubbish.
        <em>So we don't.</em>
      </h1>
      <p class="mk-lede">
        Most AI receptionists are confident about everything, including the things they have no
        business knowing. LafaGafa answers from your own pages, admits when it cannot, and hands
        over before it guesses. Then it shows you exactly why it said what it said.
      </p>
      <div class="mk-cta">
        <button class="solid" @click="go('signin')">Open the dashboard</button>
        <button class="ghost" @click="go('signin')">See a live trace</button>
      </div>

      <div class="proof">
        <div v-for="item in PROOF" :key="item.label">
          <strong>{{ item.figure }}</strong>
          <span>{{ item.label }}</span>
          <small>{{ item.note }}</small>
        </div>
      </div>
    </section>

    <section id="why" class="mk-band">
      <h2>The whole product is restraint</h2>
      <p class="mk-sub">
        Anyone can wire a language model to a chat box. The work is in what it refuses to do.
      </p>
      <div class="pillars">
        <article v-for="pillar in PILLARS" :key="pillar.title">
          <h3>{{ pillar.title }}</h3>
          <p>{{ pillar.body }}</p>
        </article>
      </div>
    </section>

    <section class="mk-band contrast">
      <div class="versus">
        <div class="bad-col">
          <h3>Blah blah</h3>
          <p class="quote">
            "Great question! Dental implants typically range from £2,000 to £2,500 depending on your
            individual needs. Would you like to book a consultation?"
          </p>
          <p class="verdict">
            The practice does not publish implant prices. That figure came from nowhere, and the
            patient will arrive expecting it.
          </p>
        </div>
        <div class="good-col">
          <h3>LafaGafa</h3>
          <p class="quote">
            "We don't list implant prices — they're quoted after an examination. I can book you in
            for one, or put you through to the practice if you'd rather ask first."
          </p>
          <p class="verdict">
            Nothing cleared the relevance floor, so nothing was claimed. The turn still ends
            somewhere useful.
          </p>
        </div>
      </div>
    </section>

    <section id="how" class="mk-band">
      <h2>Live this afternoon</h2>
      <p class="mk-sub">Onboarding is a conversation, not a configuration project.</p>
      <div class="steps">
        <article v-for="step in STEPS" :key="step.n">
          <span class="n">{{ step.n }}</span>
          <h3>{{ step.t }}</h3>
          <p>{{ step.d }}</p>
        </article>
      </div>
    </section>

    <section id="faq" class="mk-band contrast">
      <h2>Straight answers</h2>
      <div class="mk-faq">
        <article v-for="item in FAQ" :key="item.q">
          <h3>{{ item.q }}</h3>
          <p>{{ item.a }}</p>
        </article>
      </div>
    </section>

    <footer class="mk-foot">
      <div class="wordmark"><span>Lafa</span>Gafa</div>
      <p>
        A demonstration product built on a GoHighLevel conversation AI harness. Not a real company,
        and the figures above are illustrative.
      </p>
      <button class="ghost" @click="go('signin')">Sign in</button>
    </footer>
  </div>
</template>
