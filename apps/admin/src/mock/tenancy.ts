import { reactive } from "vue";

/**
 * The multi-tenant layer, as fixtures — the harness itself runs one location. Named `mock` so it is
 * never mistaken for the read models next door. See docs/architecture.md#tenancy-shape.
 */

/** An agency operates many businesses. A solo business operates only itself. */
export type OrgType = "agency" | "business";

export interface Org {
  id: string;
  name: string;
  type: OrgType;
  plan: string;
  /**
   * What the plan actually buys. The difference between a single business and an agency is this
   * number and nothing else — the product is laid out identically for both, because a business is
   * an agency with a cap of one and building two dashboards to say that would be a lie about the
   * model.
   */
  maxSubAccounts: number;
  maxAgentsPerSubAccount: number;
  since: string;
  owner: string;
  seats: number;
  /** Captured at signup, and the reason the admin console can segment customers at all. */
  industry: string;
  useCase: string;
  headcount: string;
}

interface KnowledgeBase {
  /** Where it came from: a crawled site, uploaded files, answers written by hand. */
  sources: string[];
  documents: number;
  chunks: number;
  lastBuilt: string;
  status: "ready" | "building";
}

interface SubAccount {
  id: string;
  orgId: string;
  business: string;
  /** A source for the knowledge base, not the identity of the account. May be empty. */
  website: string;
  industry: string;
  timezone: string;
  /** The GHL sub-account this maps onto. Shown to operators, never editable by them. */
  locationId: string;
  /** Everything true of the business. Every agent here inherits it. */
  knowledge: KnowledgeBase;
}

interface Agent {
  id: string;
  subAccountId: string;
  name: string;
  template: string;
  purpose: string;
  status: "live" | "paused" | "draft";
  channels: string[];
  /**
   * Narrower knowledge this agent alone needs — a support agent's returns process, an
   * out-of-hours agent's triage thresholds. Added to the account's, never instead of it.
   */
  knowledge: KnowledgeBase | null;
  turns7d: number;
  handoverRate: number;
  containment: number;
  /** Present on agents created in the product; the fixtures predate it. */
  skills?: string[];
}

export const BRIGHTLINE: Org = {
  id: "org_brightline",
  name: "Brightline Digital",
  type: "agency",
  plan: "Agency",
  maxSubAccounts: 25,
  maxAgentsPerSubAccount: 5,
  since: "March 2025",
  owner: "operations@brightline.example",
  seats: 8,
  industry: "Marketing agency",
  useCase: "Front desk cover for clients who miss calls",
  headcount: "11-50",
};

export const HARBOUR_ROW: Org = {
  id: "org_harbour",
  name: "Harbour Row Dental",
  type: "business",
  plan: "Single site",
  maxSubAccounts: 1,
  maxAgentsPerSubAccount: 3,
  since: "January 2026",
  owner: "practice@harbourrow.example",
  seats: 2,
  industry: "Dental",
  useCase: "Stop losing evening enquiries",
  headcount: "2-10",
};

export const ORGS: Org[] = [BRIGHTLINE, HARBOUR_ROW];

const kb = (
  sources: string[],
  documents: number,
  chunks: number,
  lastBuilt: string,
  status: KnowledgeBase["status"] = "ready",
): KnowledgeBase => ({ sources, documents, chunks, lastBuilt, status });

export const SUB_ACCOUNTS: SubAccount[] = [
  {
    id: "sub_northwind",
    orgId: "org_brightline",
    business: "Northwind Dental",
    website: "northwind-dental.example",
    industry: "Dental",
    timezone: "Europe/London",
    locationId: "MZIn7cNljqZKJwfZHoXv",
    knowledge: kb(["northwind-dental.example", "fees-2026.pdf"], 19, 68, "2 days ago"),
  },
  {
    id: "sub_cedar",
    orgId: "org_brightline",
    business: "Cedar Veterinary",
    website: "cedarvets.example",
    industry: "Veterinary",
    timezone: "Europe/London",
    locationId: "kQ2xLm9pRtVwBnCdEfGh",
    knowledge: kb(["cedarvets.example"], 14, 52, "6 days ago"),
  },
  {
    id: "sub_ashcroft",
    orgId: "org_brightline",
    business: "Ashcroft Physiotherapy",
    website: "ashcroftphysio.example",
    industry: "Physiotherapy",
    timezone: "Europe/London",
    locationId: "pL8vNz3wQxYtRmKjHgFd",
    knowledge: kb(["ashcroftphysio.example", "12 written answers"], 11, 39, "yesterday"),
  },
  {
    id: "sub_marlow",
    orgId: "org_brightline",
    business: "Marlow Opticians",
    website: "marlowopticians.example",
    industry: "Optical",
    timezone: "Europe/London",
    locationId: "tR5yBn7mKlPqWsXcVdZa",
    knowledge: kb(["marlowopticians.example"], 9, 31, "12 minutes ago", "building"),
  },
  {
    id: "sub_quay",
    orgId: "org_brightline",
    business: "Quay Street Chiropractic",
    website: "",
    industry: "Chiropractic",
    timezone: "Europe/London",
    locationId: "hJ4kDs6fGaZxCvBnMlQw",
    knowledge: kb(["price-list.docx", "24 written answers"], 7, 24, "3 weeks ago"),
  },
  {
    id: "sub_harbour",
    orgId: "org_harbour",
    business: "Harbour Row Dental",
    website: "harbourrow.example",
    industry: "Dental",
    timezone: "Europe/London",
    locationId: "wE1rTy2uIo3pAs4dFg5h",
    knowledge: kb(["harbourrow.example"], 12, 44, "4 days ago"),
  },
];

export const AGENTS: Agent[] = reactive([
  {
    id: "agent_nw_front",
    subAccountId: "sub_northwind",
    name: "Front desk",
    template: "Front desk receptionist",
    purpose: "Answer, book, hand over.",
    status: "live",
    channels: ["Web chat", "SMS", "Live chat"],
    knowledge: null,
    turns7d: 412,
    handoverRate: 0.07,
    containment: 0.86,
  },
  {
    id: "agent_nw_ooh",
    subAccountId: "sub_northwind",
    name: "Out of hours",
    template: "Out-of-hours triage",
    purpose: "Same answers after closing, urgency routing instead of booking.",
    status: "live",
    channels: ["Web chat"],
    knowledge: kb(["emergency-triage.md", "on-call-rota.md"], 2, 9, "2 days ago"),
    turns7d: 96,
    handoverRate: 0.19,
    containment: 0.74,
  },
  {
    id: "agent_nw_support",
    subAccountId: "sub_northwind",
    name: "Billing support",
    template: "Support desk",
    purpose: "Payment plans, invoices and membership queries only.",
    status: "draft",
    channels: ["Web chat"],
    knowledge: kb(["membership-terms.pdf", "direct-debit-faq.md"], 2, 14, "yesterday"),
    turns7d: 0,
    handoverRate: 0,
    containment: 0,
  },
  {
    id: "agent_cedar_front",
    subAccountId: "sub_cedar",
    name: "Front desk",
    template: "Front desk receptionist",
    purpose: "Answer, book, hand over.",
    status: "live",
    channels: ["Web chat", "SMS"],
    knowledge: null,
    turns7d: 188,
    handoverRate: 0.11,
    containment: 0.81,
  },
  {
    id: "agent_ashcroft_front",
    subAccountId: "sub_ashcroft",
    name: "Front desk",
    template: "Front desk receptionist",
    purpose: "Answer, book, hand over.",
    status: "live",
    channels: ["Web chat"],
    knowledge: null,
    turns7d: 143,
    handoverRate: 0.09,
    containment: 0.84,
  },
  {
    id: "agent_marlow_front",
    subAccountId: "sub_marlow",
    name: "Front desk",
    template: "Front desk receptionist",
    purpose: "Answer, book, hand over.",
    status: "draft",
    channels: ["Web chat"],
    knowledge: null,
    turns7d: 0,
    handoverRate: 0,
    containment: 0,
  },
  {
    id: "agent_quay_front",
    subAccountId: "sub_quay",
    name: "Front desk",
    template: "Front desk receptionist",
    purpose: "Answer, book, hand over.",
    status: "paused",
    channels: ["Web chat"],
    knowledge: null,
    turns7d: 21,
    handoverRate: 0.24,
    containment: 0.62,
  },
  {
    id: "agent_harbour_front",
    subAccountId: "sub_harbour",
    name: "Front desk",
    template: "Front desk receptionist",
    purpose: "Answer, book, hand over.",
    status: "live",
    channels: ["Web chat", "SMS"],
    knowledge: null,
    turns7d: 205,
    handoverRate: 0.08,
    containment: 0.85,
  },
]);

/**
 * What onboarding offers once it has read a website.
 *
 * Written for someone choosing, not someone configuring. Skill identifiers, retrieval settings and
 * handover triggers are all real and all set for them — none of it belongs on a card where the
 * question is "do I want this one".
 */
/** Creation has to persist, or the flow cannot be tested end to end. */
export function addAgent(input: {
  subAccountId: string;
  name: string;
  purpose: string;
  template: string;
  channels: string[];
  skills: string[];
}): Agent {
  const agent: Agent = {
    id: `agent_new_${String(AGENTS.length)}`,
    subAccountId: input.subAccountId,
    name: input.name,
    template: input.template,
    purpose: input.purpose,
    status: "draft",
    channels: input.channels,
    knowledge: null,
    turns7d: 0,
    handoverRate: 0,
    containment: 0,
    skills: input.skills,
  };
  AGENTS.push(agent);
  return agent;
}

export function setAgentStatus(id: string, status: Agent["status"]): void {
  const agent = AGENTS.find((entry) => entry.id === id);
  if (agent) agent.status = status;
}

export const AGENT_TEMPLATES = [
  {
    id: "front-desk",
    persona: "Clare",
    name: "Front desk",
    tagline: "Answers the phone-call questions, and books the people who are ready.",
    recommended: true,
    available: true,
    can: [
      "Answer questions about fees, hours, treatments and parking",
      "Check the calendar and offer real times",
      "Take a name and number, and book the appointment",
      "Pass anything clinical straight to your team",
    ],
    knows: "Everything on your website",
    extra: null,
    channels: ["Web chat", "SMS"],
  },
  {
    id: "out-of-hours",
    persona: "Ray",
    name: "Out of hours",
    tagline: "Covers evenings and weekends, and knows what counts as urgent.",
    recommended: true,
    available: true,
    can: [
      "Answer the same questions after closing",
      "Tell someone in pain what to do tonight",
      "Route a genuine emergency to your on-call number",
      "Take details so you can call back first thing",
    ],
    knows: "Everything on your website",
    extra: "Your triage thresholds and on-call rota",
    channels: ["Web chat", "SMS"],
  },
  {
    id: "support",
    persona: "Nina",
    name: "Billing and support",
    tagline: "Handles what happens after the appointment, not before it.",
    recommended: false,
    available: true,
    can: [
      "Explain payment plans and membership terms",
      "Answer invoice and direct debit questions",
      "Hand any dispute to a person immediately",
    ],
    knows: "Everything on your website",
    extra: "Your terms, invoicing and refund policy",
    channels: ["Web chat", "Email"],
  },
  {
    id: "reactivation",
    persona: "Sam",
    name: "Recall and reactivation",
    tagline: "Opens the conversation instead of waiting for it.",
    recommended: false,
    available: false,
    can: [
      "Reach out when someone is due a check-up",
      "Offer times and book directly from the message",
    ],
    knows: "Everything on your website",
    extra: "Your recall intervals and what counts as due",
    channels: ["SMS"],
  },
];

/**
 * Handover is layered, and the layers mean different things.
 *
 * Business rules hold for every agent in a sub-account and are the ones nobody should be able to
 * switch off per agent — "put me through to a person" cannot depend on which agent picked up.
 * Agent rules are about that agent's own subject: a billing agent stops at a refund dispute, a
 * receptionist stops at anything clinical. Flattening the two into one list was the mistake: it
 * implied a front desk agent could be configured to keep talking through a complaint.
 */
export const BUSINESS_HANDOVER = [
  {
    id: "explicit",
    label: "Customer asks for a person",
    detail: "In any words, at any point.",
    on: true,
    locked: true,
  },
  {
    id: "frustration",
    label: "Repeated frustration in one conversation",
    detail: "Two signals of annoyance, or an explicit complaint about the agent.",
    on: true,
    locked: false,
  },
  {
    id: "failure",
    label: "An agent fails twice in a row",
    detail: "A safety net, not a behaviour. Fires regardless of subject.",
    on: true,
    locked: true,
  },
  {
    id: "complaint",
    label: "Complaint about treatment received",
    detail: "Never handled by an agent, whatever it knows.",
    on: true,
    locked: false,
  },
];

/** Per template, because what an agent should refuse depends on what it is for. */
export const AGENT_HANDOVER: Record<
  string,
  Array<{ id: string; label: string; detail: string; on: boolean }>
> = {
  "front-desk": [
    {
      id: "clinical",
      label: "Anything clinical or diagnostic",
      detail: "Symptoms, pain, whether something is serious.",
      on: true,
    },
    {
      id: "money",
      label: "Refunds and billing disputes",
      detail: "Belongs to billing, not the front desk.",
      on: true,
    },
    {
      id: "unknown",
      label: "Questions the knowledge base cannot answer",
      detail: "Off by default: declining is usually better than escalating.",
      on: false,
    },
  ],
  "out-of-hours": [
    {
      id: "urgent",
      label: "Anything it judges urgent",
      detail: "Routes to the on-call number rather than a queue.",
      on: true,
    },
    {
      id: "booking",
      label: "Requests to book",
      detail: "Takes details instead, for the morning.",
      on: true,
    },
  ],
  "support-desk": [
    {
      id: "refund",
      label: "Refund or credit requested",
      detail: "Explains the policy, then hands over. Never approves.",
      on: true,
    },
    { id: "dispute", label: "Disputed charge", detail: "Straight to a person.", on: true },
    {
      id: "clinical",
      label: "Anything clinical",
      detail: "Outside its subject entirely.",
      on: true,
    },
  ],
};

/**
 * Gaps framed as work, not as a report.
 *
 * A question the documents could not answer is only interesting if you can see what it cost. These
 * carry the handovers they caused, so the list sorts by what writing one page would save.
 */
const GAP_SUGGESTIONS: Record<
  string,
  Array<{ question: string; asked: number; handovers: number; scope: string }>
> = {
  sub_northwind: [
    { question: "How much is a dental implant?", asked: 14, handovers: 11, scope: "Front desk" },
    { question: "Do you take Bupa?", asked: 9, handovers: 7, scope: "Front desk" },
    {
      question: "Can I pay in instalments over 12 months?",
      asked: 6,
      handovers: 6,
      scope: "Billing support",
    },
    { question: "Which dentist is best for veneers?", asked: 4, handovers: 2, scope: "Front desk" },
  ],
  sub_cedar: [
    { question: "Do you microchip?", asked: 7, handovers: 5, scope: "Front desk" },
    { question: "Out of hours emergency fee?", asked: 5, handovers: 5, scope: "Front desk" },
  ],
  sub_harbour: [
    { question: "Do you offer sedation?", asked: 8, handovers: 6, scope: "Front desk" },
  ],
};

export const gapsFor = (subAccountId: string) => GAP_SUGGESTIONS[subAccountId] ?? [];

export const INDUSTRIES = [
  "Dental",
  "Veterinary",
  "Physiotherapy",
  "Optical",
  "Chiropractic",
  "Aesthetics",
  "Other",
];

export const USE_CASES = [
  "We miss calls and lose the booking",
  "Nobody covers evenings or weekends",
  "The same questions, all day",
  "Qualifying enquiries before they reach us",
];

/**
 * The funnel, per sub-account. Ordered as it actually happens, because the useful reading is where
 * it narrows: conversations that never became a lead is a different problem from leads that never
 * booked.
 */
const FUNNEL: Record<
  string,
  { conversations: number; leads: number; booked: number; handed: number }
> = {
  sub_northwind: { conversations: 412, leads: 118, booked: 74, handed: 29 },
  sub_cedar: { conversations: 188, leads: 64, booked: 31, handed: 21 },
  sub_ashcroft: { conversations: 143, leads: 47, booked: 28, handed: 13 },
  sub_marlow: { conversations: 0, leads: 0, booked: 0, handed: 0 },
  sub_quay: { conversations: 21, leads: 9, booked: 2, handed: 5 },
  sub_harbour: { conversations: 205, leads: 72, booked: 41, handed: 16 },
};

/** Per agent, so a sub-account's numbers can be attributed rather than just totalled. */
const AGENT_FUNNEL: Record<
  string,
  { conversations: number; leads: number; booked: number; handed: number }
> = {
  agent_nw_front: { conversations: 316, leads: 96, booked: 68, handed: 18 },
  agent_nw_ooh: { conversations: 96, leads: 22, booked: 6, handed: 11 },
  agent_nw_support: { conversations: 0, leads: 0, booked: 0, handed: 0 },
  agent_cedar_front: { conversations: 188, leads: 64, booked: 31, handed: 21 },
  agent_ashcroft_front: { conversations: 143, leads: 47, booked: 28, handed: 13 },
  agent_marlow_front: { conversations: 0, leads: 0, booked: 0, handed: 0 },
  agent_quay_front: { conversations: 21, leads: 9, booked: 2, handed: 5 },
  agent_harbour_front: { conversations: 205, leads: 72, booked: 41, handed: 16 },
};

/**
 * What an agent is measured on depends on what it is for.
 *
 * A front desk agent succeeds by booking people. A billing agent never books anything, and showing
 * it "leads created" says it is failing at a job it was never given. So the headline measures are a
 * property of the template, and the same underlying counts get read differently.
 */
interface AgentMetric {
  label: string;
  key: "conversations" | "leads" | "booked" | "handed" | "resolved";
  hint?: string;
  primary?: boolean;
}

export const METRICS_FOR: Record<string, AgentMetric[]> = {
  "front-desk": [
    { label: "Appointments booked", key: "booked", primary: true },
    { label: "Leads created", key: "leads" },
    { label: "Conversations", key: "conversations" },
    { label: "Handed to a person", key: "handed" },
  ],
  "out-of-hours": [
    { label: "Routed to on-call", key: "handed", primary: true, hint: "the job, not a failure" },
    { label: "Answered overnight", key: "resolved" },
    { label: "Conversations", key: "conversations" },
    { label: "Details taken for morning", key: "leads" },
  ],
  "support-desk": [
    { label: "Queries resolved", key: "resolved", primary: true },
    { label: "Conversations", key: "conversations" },
    { label: "Escalated to a person", key: "handed" },
    { label: "Still open", key: "leads", hint: "awaiting a reply from your team" },
  ],
};

/** Satisfaction, asked at the end of a conversation. Out of five. */
const NPS: Record<string, { score: number; responses: number }> = {
  agent_nw_front: { score: 4.6, responses: 88 },
  agent_nw_ooh: { score: 4.1, responses: 24 },
  agent_nw_support: { score: 0, responses: 0 },
  agent_cedar_front: { score: 4.4, responses: 51 },
  agent_ashcroft_front: { score: 4.7, responses: 39 },
  agent_marlow_front: { score: 0, responses: 0 },
  agent_quay_front: { score: 3.2, responses: 7 },
  agent_harbour_front: { score: 4.5, responses: 62 },
};

export const npsFor = (agentId: string) => NPS[agentId] ?? { score: 0, responses: 0 };

/** Which rule actually fired, so configuration and outcome can be read on one screen. */
const HANDOVER_REASONS: Record<string, Array<{ label: string; count: number }>> = {
  agent_nw_front: [
    { label: "Anything clinical", count: 9 },
    { label: "Customer asked for a person", count: 5 },
    { label: "Refunds and billing", count: 3 },
    { label: "Agent failed twice", count: 1 },
  ],
  agent_nw_ooh: [
    { label: "Judged urgent", count: 7 },
    { label: "Customer asked for a person", count: 3 },
    { label: "Anything clinical", count: 1 },
  ],
};

export const handoverReasonsFor = (agentId: string) => HANDOVER_REASONS[agentId] ?? [];

export const agentFunnelFor = (agentId: string) => {
  const base = AGENT_FUNNEL[agentId] ?? { conversations: 0, leads: 0, booked: 0, handed: 0 };
  return { ...base, resolved: Math.max(0, base.conversations - base.handed) };
};

export const agentById = (id: string): Agent | undefined => AGENTS.find((agent) => agent.id === id);

export const subAccountById = (id: string): SubAccount | undefined =>
  SUB_ACCOUNTS.find((account) => account.id === id);

export const funnelFor = (subAccountId: string) =>
  FUNNEL[subAccountId] ?? { conversations: 0, leads: 0, booked: 0, handed: 0 };

/** A sub-account counts as active once it has a live agent that has actually handled something. */
export const isActive = (subAccountId: string): boolean =>
  agentsFor(subAccountId).some((agent) => agent.status === "live" && agent.turns7d > 0);

/**
 * What an agent can actually be given.
 *
 * A closed list, because the harness implements three skills and nothing else. The previous screen
 * let an operator type a skill in free text, which promised a capability that does not exist —
 * worse than not offering it, because they would only find out when a customer did.
 */
export const SKILL_CATALOGUE = [
  {
    id: "update_contact",
    name: "Record customer details",
    detail: "Saves a name, email, phone or stated preference as the customer gives it.",
    needs: "Nothing",
    available: true,
  },
  {
    id: "book_appointment",
    name: "Check availability and book",
    detail: "Reads your calendar, offers real times, and books the one they choose.",
    needs: "A connected calendar",
    available: true,
  },
  {
    id: "human_handover",
    name: "Hand over to a person",
    detail: "Stops the agent in that conversation and briefs your team on the contact record.",
    needs: "Nothing",
    available: true,
  },
  {
    id: "send_payment_link",
    name: "Send a payment link",
    detail: "For an invoice that already exists. Never creates a charge.",
    needs: "Payments connected",
    available: false,
  },
  {
    id: "reschedule",
    name: "Move an existing appointment",
    detail: "Finds their booking and offers alternatives.",
    needs: "A connected calendar",
    available: false,
  },
];

/**
 * A decision trace, deliberately not a transcript: the CRM is the system of record, and what only
 * this product knows is *why*. See docs/architecture.md#decision-trace.
 */
interface ReviewTurn {
  said: string;
  replied: string;
  /** The source it grounded in, or null when nothing cleared the floor. */
  usedSource: string | null;
  didSkill?: string;
  stoppedBy?: string;
  gapQuestion?: string;
}

interface Review {
  id: string;
  subAccountId: string;
  agentId: string;
  customer: string;
  when: string;
  outcome: "booked" | "answered" | "handed" | "unanswered";
  turns: ReviewTurn[];
}

const REVIEWS: Review[] = [
  {
    id: "cv_1",
    subAccountId: "sub_northwind",
    agentId: "agent_nw_front",
    customer: "Priya M",
    when: "Today, 09:14",
    outcome: "booked",
    turns: [
      {
        said: "Hi, how much is a check-up and can I come tomorrow morning?",
        replied: "A routine check-up is £55. Tomorrow I have 9:00am or 11:30am — do either work?",
        usedSource: "fees.md",
        didSkill: "Check availability and book",
      },
      {
        said: "9 is great, I'm Priya, priya@example.com",
        replied: "Booked you in for 9:00am tomorrow, Priya. See you then.",
        usedSource: null,
        didSkill: "Record customer details",
      },
    ],
  },
  {
    id: "cv_2",
    subAccountId: "sub_northwind",
    agentId: "agent_nw_front",
    customer: "Unknown visitor",
    when: "Today, 08:02",
    outcome: "unanswered",
    turns: [
      {
        said: "How much is a dental implant?",
        replied:
          "We don't list implant prices — they're quoted after an examination. I can book you in, or put you through to the practice.",
        usedSource: null,
        gapQuestion: "How much is a dental implant?",
      },
    ],
  },
  {
    id: "cv_3",
    subAccountId: "sub_northwind",
    agentId: "agent_nw_front",
    customer: "Dan R",
    when: "Yesterday, 16:40",
    outcome: "handed",
    turns: [
      {
        said: "My jaw has been clicking and locking for weeks, is that serious?",
        replied:
          "That's not something I can assess. I'm putting you through to the practice now — they'll pick this up shortly.",
        usedSource: null,
        stoppedBy: "Anything clinical or diagnostic",
      },
    ],
  },
  {
    id: "cv_4",
    subAccountId: "sub_northwind",
    agentId: "agent_nw_ooh",
    customer: "Unknown visitor",
    when: "Yesterday, 22:51",
    outcome: "handed",
    turns: [
      {
        said: "I've knocked my front tooth out, what do I do",
        replied:
          "Keep it in milk, don't scrub it, and call the emergency line now — I'm sending you the number.",
        usedSource: "emergencies.md",
        stoppedBy: "Judged urgent",
      },
    ],
  },
  {
    id: "cv_5",
    subAccountId: "sub_northwind",
    agentId: "agent_nw_front",
    customer: "Marie L",
    when: "Yesterday, 11:20",
    outcome: "answered",
    turns: [
      {
        said: "What time do you close on a friday?",
        replied: "We close at 4pm on Fridays. The last appointment starts at 3:30pm.",
        usedSource: "opening-hours.md",
      },
    ],
  },
];

/** How long a decision is worth keeping, and shown in the UI so it is a promise not a default. */
export const TRACE_RETENTION_DAYS = 30;

/**
 * Who changed what, and when — otherwise support debugs a model when someone flipped a toggle.
 * Fixtures for now; real writes need a table.
 */
interface ConfigChange {
  id: string;
  subAccountId: string;
  agentId?: string;
  actor: string;
  setting: string;
  label: string;
  before: string;
  after: string;
  at: string;
  /** Days ago, so it can be plotted against a behaviour chart. */
  daysAgo: number;
}

export const CONFIG_CHANGES: ConfigChange[] = [
  {
    id: "cc_1",
    subAccountId: "sub_quay",
    agentId: "agent_quay_front",
    actor: "operations@brightline.example",
    setting: "handover.outofscope",
    label: "Anything the knowledge base does not cover",
    before: "off",
    after: "on",
    at: "Tue 09:12",
    daysAgo: 5,
  },
  {
    id: "cc_2",
    subAccountId: "sub_northwind",
    actor: "operations@brightline.example",
    setting: "knowledge.rebuild",
    label: "Re-read northwind-dental.example",
    before: "61 passages",
    after: "68 passages",
    at: "Mon 16:40",
    daysAgo: 6,
  },
  {
    id: "cc_3",
    subAccountId: "sub_northwind",
    agentId: "agent_nw_support",
    actor: "operations@brightline.example",
    setting: "agent.created",
    label: "Billing support created",
    before: "—",
    after: "draft",
    at: "Thu 11:02",
    daysAgo: 3,
  },
  {
    id: "cc_4",
    subAccountId: "sub_cedar",
    agentId: "agent_cedar_front",
    actor: "practice@cedarvets.example",
    setting: "skill.book_appointment",
    label: "Check availability and book",
    before: "on",
    after: "off",
    at: "Fri 08:30",
    daysAgo: 2,
  },
  {
    id: "cc_5",
    subAccountId: "sub_harbour",
    actor: "practice@harbourrow.example",
    setting: "handover.frustration",
    label: "Repeated frustration in one conversation",
    before: "on",
    after: "off",
    at: "Yesterday 14:20",
    daysAgo: 1,
  },
];

export const reviewsForAgent = (agentId: string) =>
  REVIEWS.filter((review) => review.agentId === agentId);

export const reviewsFor = (subAccountId: string) =>
  REVIEWS.filter((review) => review.subAccountId === subAccountId);

export const HEADCOUNTS = ["Just me", "2-10", "11-50", "51-200", "200+"];

export const subAccountsFor = (orgId: string): SubAccount[] =>
  SUB_ACCOUNTS.filter((account) => account.orgId === orgId);

export const agentsFor = (subAccountId: string): Agent[] =>
  AGENTS.filter((agent) => agent.subAccountId === subAccountId);
