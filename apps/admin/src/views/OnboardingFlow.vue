<script setup lang="ts">
import { computed, ref } from "vue";
import { AGENT_TEMPLATES, HEADCOUNTS, INDUSTRIES, USE_CASES, type OrgType } from "../mock/tenancy";
import { go } from "../router";
import { completeProfile, identity } from "../session";

/**
 * Onboarding, which is two jobs in one coat: qualify a new account, then set up a sub-account.
 * Returning here for "add a client" starts at the second half. The crawl is a timer.
 */

/**
 * Not every page is worth indexing.
 *
 * A privacy notice and a cookie policy are the most confidently worded documents on most sites, and
 * an agent that reads them will answer questions about data retention beautifully and questions
 * about fees badly. Showing what we skipped is also the fastest way for an operator to spot that we
 * have misread their business.
 */
const PAGES: Array<{ path: string; take: boolean; why: string }> = [
  { path: "/", take: true, why: "Overview" },
  { path: "/about", take: true, why: "About the practice" },
  { path: "/treatments", take: true, why: "Treatments" },
  { path: "/fees", take: true, why: "Prices" },
  { path: "/new-patients", take: true, why: "New patients" },
  { path: "/opening-hours", take: true, why: "Hours" },
  { path: "/emergencies", take: true, why: "Urgent care" },
  { path: "/contact", take: true, why: "Contact and parking" },
  { path: "/privacy-policy", take: false, why: "Legal boilerplate" },
  { path: "/cookie-policy", take: false, why: "Legal boilerplate" },
  { path: "/blog/whitening-myths", take: false, why: "Blog post" },
];

const FACTS = [
  "Opening hours",
  "Fee list, 13 treatments",
  "New patient process",
  "Cancellation policy",
  "Parking and access",
  "Out-of-hours cover",
];

/** Null org means signed up but not yet set up, which is what puts someone in the long flow. */
const firstRun = computed(() => identity.value?.org == null);
const org = computed(() => identity.value?.org);

const type = ref<OrgType | null>(null);
const orgName = ref("");
const headcount = ref("");
const useCase = ref("");

const business = ref("");
const industry = ref("Dental");
const website = ref("");
const found = ref(0);
const chosen = ref<string[]>(["front-desk", "out-of-hours"]);
/** Opting out of the recommendations entirely, which has to be a first-class path. */
const diy = ref(false);

/** 1-2 are the profile, 3-5 the sub-account, 45 the crawl between 4 and 5. */
const step = ref(identity.value?.org == null ? 1 : 3);

const isAgency = computed(() =>
  firstRun.value ? type.value === "agency" : org.value?.type === "agency",
);
const canProfile = computed(() => orgName.value.trim().length > 1 && useCase.value !== "");
const canName = computed(() => business.value.trim().length > 1);
const selected = computed(() =>
  AGENT_TEMPLATES.filter((template) => chosen.value.includes(template.id)),
);
const crawlDone = computed(() => found.value >= PAGES.length);
const kept = computed(() => PAGES.slice(0, found.value).filter((page) => page.take).length);
const skipped = computed(() => PAGES.slice(0, found.value).filter((page) => !page.take).length);

const STEPS = computed(() =>
  firstRun.value || step.value < 3
    ? [
        { n: 1, label: "About you" },
        { n: 3, label: isAgency.value ? "First client" : "Your business" },
        { n: 4, label: "Knowledge" },
        { n: 5, label: "Agents" },
      ]
    : [
        { n: 3, label: "Business" },
        { n: 4, label: "Knowledge" },
        { n: 5, label: "Agents" },
      ],
);

function choose(kind: OrgType) {
  type.value = kind;
  step.value = 2;
}

function saveProfile() {
  if (!type.value) return;
  completeProfile({
    name: orgName.value.trim(),
    type: type.value,
    industry: type.value === "agency" ? "Marketing agency" : industry.value,
    headcount: headcount.value || "2-10",
    useCase: useCase.value,
  });
  // A single business is its own sub-account, so it does not get named twice.
  if (type.value === "business") business.value = orgName.value.trim();
  step.value = 3;
}

function crawl() {
  step.value = 45;
  found.value = 0;
  const tick = globalThis.setInterval(() => {
    found.value += 1;
    if (found.value >= PAGES.length) {
      globalThis.clearInterval(tick);
      globalThis.setTimeout(() => (step.value = 5), 900);
    }
  }, 260);
}

function toggle(id: string) {
  if (diy.value) return;
  chosen.value = chosen.value.includes(id)
    ? chosen.value.filter((entry) => entry !== id)
    : [...chosen.value, id];
}
</script>

<template>
  <div class="page narrow onboarding">
    <button v-if="org" class="back-link" @click="go('dashboard')">← {{ org.name }}</button>

    <h1 v-if="firstRun">Welcome, {{ identity?.name }}</h1>
    <h1 v-else>{{ isAgency ? "Add a client" : "Add a site" }}</h1>
    <p v-if="firstRun" class="dim spaced">
      Your account is created. A few questions and one website, and you will have an agent
      answering.
    </p>

    <ol class="rail">
      <li
        v-for="(entry, index) in STEPS"
        :key="entry.n"
        :class="{ on: step >= entry.n, done: step > entry.n }"
      >
        <span>{{ index + 1 }}</span
        >{{ entry.label }}
      </li>
    </ol>

    <!-- 1 ─ the only choice that is awkward to change later -->
    <section v-if="step === 1" class="card">
      <h2>How will you use LafaGafa?</h2>
      <p class="dim">This decides how your account is laid out.</p>

      <button class="choice-card" @click="choose('agency')">
        <span class="choice-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 11h.01M15 11h.01" />
          </svg>
        </span>
        <div>
          <strong>I run an agency</strong>
          <p>
            One organisation, a sub-account per client. Each keeps its own knowledge base, agents
            and billing line.
          </p>
        </div>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>

      <button class="choice-card" @click="choose('business')">
        <span class="choice-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 21V9l8-6 8 6v12M9 21v-6h6v6M4 21h16" />
          </svg>
        </span>
        <div>
          <strong>It's for my own business</strong>
          <p>
            One practice, clinic or shop. A single sub-account, and none of the agency layer to
            navigate.
          </p>
        </div>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </section>

    <!-- 2 ─ who they are, and why they came -->
    <section v-if="step === 2" class="card">
      <button class="back-link" @click="step = 1">← Back</button>
      <h2>{{ isAgency ? "About your agency" : "About your business" }}</h2>
      <p class="dim">None of this has to be exact. It sets your starting configuration.</p>

      <label class="field-label">
        <span>{{ isAgency ? "Agency name" : "Business name" }}</span>
        <input
          v-model="orgName"
          :placeholder="isAgency ? 'Brightline Digital' : 'Harbour Row Dental'"
        />
      </label>

      <template v-if="!isAgency">
        <span class="field-label"><span>What you do</span></span>
        <div class="chip-row">
          <button
            v-for="option in INDUSTRIES"
            :key="option"
            :class="{ on: industry === option }"
            @click="industry = option"
          >
            {{ option }}
          </button>
        </div>
      </template>

      <span class="field-label"
        ><span>{{ isAgency ? "People at the agency" : "People who work there" }}</span></span
      >
      <div class="chip-row">
        <button
          v-for="option in HEADCOUNTS"
          :key="option"
          :class="{ on: headcount === option }"
          @click="headcount = option"
        >
          {{ option }}
        </button>
      </div>

      <span class="field-label"><span>What are you trying to fix?</span></span>
      <button
        v-for="option in USE_CASES"
        :key="option"
        class="choice-card slim"
        :class="{ on: useCase === option }"
        @click="useCase = option"
      >
        <span class="radio" />
        <div>
          <strong>{{ option }}</strong>
        </div>
      </button>

      <button class="solid full" :disabled="!canProfile" @click="saveProfile">Continue</button>
    </section>

    <!-- 3 ─ the sub-account itself -->
    <section v-if="step === 3" class="card">
      <h2 v-if="isAgency">Which client is this?</h2>
      <h2 v-else-if="firstRun">Confirm your business</h2>
      <h2 v-else>What is the business called?</h2>
      <p class="dim">
        This creates a sub-account: one business, one knowledge base, one GoHighLevel location.
        Nothing crosses between them.
      </p>
      <label class="field-label">
        <span>Business name</span>
        <input v-model="business" placeholder="Northwind Dental" @keyup.enter="step = 4" />
      </label>
      <template v-if="isAgency">
        <span class="field-label"><span>Trade</span></span>
        <div class="chip-row">
          <button
            v-for="option in INDUSTRIES"
            :key="option"
            :class="{ on: industry === option }"
            @click="industry = option"
          >
            {{ option }}
          </button>
        </div>
      </template>
      <button class="solid" :disabled="!canName" @click="step = 4">Continue</button>
    </section>

    <!-- 4 ─ fill the knowledge base -->
    <section v-if="step === 4">
      <div class="card">
        <h2>Give {{ business }} something to know</h2>
        <p class="dim">
          This is the account's knowledge base — everything true of the business. Every agent you
          create here inherits it, so it is worth getting right once.
        </p>
        <div class="url-row">
          <input v-model="website" placeholder="northwind-dental.example" @keyup.enter="crawl" />
          <button class="solid" :disabled="website.trim().length < 4" @click="crawl">
            Read the site
          </button>
        </div>
        <p class="dim small">
          We fetch your sitemap, work out which pages describe the business, and index those by
          heading. Policies, cookie notices and blog posts are left out on purpose — they answer
          confidently and wrongly.
        </p>
      </div>

      <div class="card muted-card">
        <h2>No website?</h2>
        <p class="dim">
          A supported path, not a dead end. The account exists either way — only the source changes.
        </p>
        <div class="kb-actions">
          <button class="ghost" @click="step = 5">Upload documents</button>
          <button class="ghost" @click="step = 5">Write answers by hand</button>
        </div>
      </div>
    </section>

    <!-- the crawl, showing its working -->
    <section v-if="step === 45" class="card crawl-card">
      <header class="crawl-head">
        <span class="spinner" :class="{ done: crawlDone }" />
        <div>
          <h2>{{ crawlDone ? "Indexed" : "Reading" }} {{ website }}</h2>
          <p class="dim small">
            {{ found }} of {{ PAGES.length }} in the sitemap &middot; {{ kept }} indexed &middot;
            {{ skipped }} skipped
            <template v-if="crawlDone"> &middot; 68 passages embedded</template>
          </p>
        </div>
      </header>

      <div class="crawl-grid">
        <div>
          <h3>Sitemap</h3>
          <ul class="page-list">
            <li
              v-for="(page, index) in PAGES"
              :key="page.path"
              :class="{ done: index < found, skip: index < found && !page.take }"
            >
              <span class="mark" :class="index < found ? (page.take ? 'took' : 'left') : ''" />
              <span class="path">{{ page.path }}</span>
              <span v-if="index < found" class="why">{{ page.why }}</span>
            </li>
          </ul>
        </div>
        <div>
          <h3>What we understood</h3>
          <div class="fact-chips">
            <span
              v-for="(fact, index) in FACTS"
              :key="fact"
              :class="{ on: index < Math.floor((found / PAGES.length) * FACTS.length) }"
            >
              {{ fact }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- 5 ─ what we suggest, and the door out of it -->
    <section v-if="step === 5">
      <div class="card summary-head">
        <div>
          <h2>{{ business }}</h2>
          <p class="dim">
            {{ industry }} &middot;
            {{ website ? "19 documents, 68 passages" : "knowledge base empty — add sources next" }}
          </p>
        </div>
        <span class="pill good-pill">Ready</span>
      </div>

      <h2 class="section">We would start you with these</h2>
      <p class="dim spaced">
        Chosen for a {{ industry.toLowerCase() }} practice, already reading your website and already
        set to hand anything clinical to a person. You can change all of it later.
      </p>

      <div class="agent-choices">
        <button
          v-for="template in AGENT_TEMPLATES"
          :key="template.id"
          class="agent-choice"
          :class="{ off: !template.available, on: chosen.includes(template.id) }"
          :disabled="!template.available || diy"
          @click="toggle(template.id)"
        >
          <span v-if="template.recommended && template.available" class="rec">Recommended</span>
          <span v-if="!template.available" class="rec soon">Coming soon</span>

          <header>
            <span class="persona">{{ template.persona.charAt(0) }}</span>
            <div>
              <strong>{{ template.persona }}</strong>
              <span class="dim small">{{ template.name }}</span>
            </div>
            <span class="check" />
          </header>

          <p class="tagline">{{ template.tagline }}</p>

          <ul class="can-list">
            <li v-for="line in template.can" :key="line">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l6 6L20 6" /></svg>
              {{ line }}
            </li>
          </ul>

          <div class="knows">
            <span class="knows-label">Reads</span>
            <span class="bind">{{ template.knows }}</span>
            <span v-if="template.extra" class="bind extra">{{ template.extra }}</span>
          </div>

          <p class="ready-note">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
            Persona, tone and handover rules already written for {{ industry.toLowerCase() }}
          </p>
        </button>
      </div>

      <button class="diy-card" :class="{ on: diy }" @click="diy = !diy">
        <span class="check" />
        <div>
          <strong>I'll set it up myself</strong>
          <p class="dim small">
            Start with an empty agent and choose its persona, knowledge and skills by hand. Slower,
            and the right answer if your business does not look like the templates.
          </p>
        </div>
      </button>

      <div class="card finish-card">
        <div>
          <strong v-if="diy">A blank agent</strong>
          <strong v-else>{{ selected.length }} agent{{ selected.length === 1 ? "" : "s" }}</strong>
          <p class="dim small">
            {{
              diy
                ? "Nothing pre-filled. You will choose everything on the next screen."
                : `Ready to answer as soon as ${business || "the business"} goes live.`
            }}
          </p>
        </div>
        <button
          class="solid"
          :disabled="!diy && selected.length === 0"
          @click="go('account/sub_northwind')"
        >
          {{ firstRun ? "Finish setup" : "Create and open" }}
        </button>
      </div>
      <p class="auth-fine">
        Mocked: this opens Northwind Dental rather than creating anything. Provisioning for real
        means a GoHighLevel location and an OAuth install.
      </p>
    </section>
  </div>
</template>
