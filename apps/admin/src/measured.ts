/**
 * Numbers from the run of 10 August 2026, transcribed from `evals/.results` and reported in full
 * in `docs/eval-results.md`. Anthropic's row, because it is the one both judges graded.
 *
 * Transcribed rather than served because these are the cross-provider figures the writeup argues
 * from; the Evals page reads `/api/admin/evals` and shows whichever provider you switch to.
 */

export const GATE_EVAL = {
  cases: 57,
  accuracy: 0.9649,
  precision: 0.9667,
  precisionFloor: 0.85,
  recall: 0.9667,
  recallFloor: 0.95,
  /** The confusion matrix, because precision alone hides which way it errs. */
  truePositive: 29,
  falsePositive: 1,
  trueNegative: 26,
  falseNegative: 1,
};

export const BEHAVIOUR_EVAL = {
  passed: 86,
  total: 89,
  byBehaviour: [
    { name: "update_contact", passed: 19, total: 20 },
    { name: "booking", passed: 19, total: 20 },
    { name: "handover", passed: 19, total: 20 },
    { name: "rag", passed: 20, total: 20 },
    { name: "gate", passed: 3, total: 3 },
    { name: "multi_intent", passed: 3, total: 3 },
    { name: "purpose", passed: 3, total: 3 },
  ],
  /** Nearly half the corpus asserts a skill must NOT fire. That is where the value is. */
  negativeCases: 40,
};

export const JUDGE_EVAL = {
  mean: 4.73,
  floor: 4.0,
  belowThree: 2,
  cases: 56,
  judgedBy: "openai/gpt-4o",
  agentUnderTest: "anthropic/claude-haiku-4-5",
};

/**
 * Webhook-to-send, measured 13 August 2026 against the deployed harness: 93 real turns, 31
 * stratified cases per provider, one conversation each. Transcribed from `turn_sent`.
 *
 * Not a live query on purpose. These are the figures `docs/eval-results.md` argues from, and a
 * panel that drifted with every stray test message would stop matching the writeup beside it.
 */
/** The vendor at the head of the deployed chain, and so the row the SLO verdict is about. */
const GOOGLE = {
  provider: "google",
  turns: 14,
  p50: 2972,
  p95: 3627,
  ragP50: 2768,
  ragP95: 4070,
  queued: 106,
  loop: 1782,
  crm: 1070,
  send: 603,
  stalled: 0,
};

export const LATENCY = {
  p50Slo: 3000,
  p95Slo: 6000,
  /** A CRM round trip past this is the vendor stalling; those turns are counted, not averaged. */
  stallMs: 5000,
  primary: GOOGLE,
  byProvider: [
    GOOGLE,
    {
      provider: "anthropic",
      turns: 14,
      p50: 3799,
      p95: 4915,
      ragP50: 3741,
      ragP95: 9598,
      queued: 106,
      loop: 2909,
      crm: 1158,
      send: 620,
      stalled: 0,
    },
    {
      provider: "openai",
      turns: 15,
      p50: 4056,
      p95: 17559,
      ragP50: 3597,
      ragP95: 8358,
      queued: 106,
      loop: 2875,
      crm: 1176,
      send: 620,
      stalled: 1,
    },
  ],
  /** Every CRM round trip across all three runs, so the external share is legible. */
  endpoints: [
    {
      method: "GET",
      path: "/calendars/{id}/free-slots",
      calls: 35,
      p50: 119,
      p95: 664,
      worst: 24157,
    },
    { method: "POST", path: "/conversations/messages", calls: 96, p50: 619, p95: 913, worst: 1532 },
    { method: "GET", path: "/calendars/", calls: 70, p50: 127, p95: 468, worst: 748 },
    { method: "GET", path: "/contacts/{id}", calls: 124, p50: 77, p95: 254, worst: 699 },
    { method: "PUT", path: "/contacts/{id}", calls: 44, p50: 168, p95: 318, worst: 630 },
    {
      method: "GET",
      path: "/conversations/{id}/messages",
      calls: 93,
      p50: 123,
      p95: 174,
      worst: 396,
    },
  ],
  note: "Webhook received to reply accepted by the CRM. Non-RAG turns; RAG reported apart.",
};
