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

export const LATENCY = {
  p50: 1161,
  p50Slo: 3000,
  p95: 2041,
  p95Slo: 6000,
  byProvider: [
    { provider: "anthropic", p50: 1161, p95: 2041 },
    { provider: "openai", p50: 1436, p95: 3257 },
    { provider: "google", p50: 766, p95: 940 },
  ],
  note: "Non-RAG turns, 12 runs each. The CRM round trip is a deployment fact and is excluded.",
};
