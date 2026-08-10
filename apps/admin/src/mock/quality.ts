/**
 * The graded numbers, measured by the last real `pnpm gate` run. A fixture only because the browser
 * cannot read `evals/.results`; `eval_runs` exists to hold them and needs one endpoint.
 */

export const GATE_EVAL = {
  cases: 57,
  accuracy: 0.982,
  precision: 0.968,
  precisionFloor: 0.85,
  recall: 1.0,
  recallFloor: 0.95,
  /** The confusion matrix, because precision alone hides which way it errs. */
  truePositive: 30,
  falsePositive: 1,
  trueNegative: 26,
  falseNegative: 0,
};

export const BEHAVIOUR_EVAL = {
  passed: 63,
  total: 63,
  byBehaviour: [
    { name: "booking", passed: 15, total: 15 },
    { name: "handover", passed: 11, total: 11 },
    { name: "rag", passed: 12, total: 12 },
    { name: "update_contact", passed: 16, total: 16 },
    { name: "purpose", passed: 3, total: 3 },
    { name: "multi_intent", passed: 3, total: 3 },
    { name: "gate", passed: 3, total: 3 },
  ],
  /** Half the corpus asserts a skill must NOT fire. That is where the value is. */
  negativeCases: 31,
};

export const JUDGE_EVAL = {
  mean: 4.83,
  floor: 4.0,
  belowThree: 0,
  cases: 23,
  judgedBy: "openai/gpt-4o",
  agentUnderTest: "anthropic/claude-sonnet-5",
};

export const LATENCY = {
  p50: 2998,
  p50Slo: 3000,
  p95: 4014,
  p95Slo: 6000,
  spans: [
    { name: "llm_call:chat", p50: 2996, p95: 4010 },
    { name: "gate", p50: 1058, p95: 2380 },
    { name: "rag_retrieve", p50: 412, p95: 890 },
    { name: "tool_result", p50: 240, p95: 610 },
  ],
  note: "Harness spans only. The tunnel and the CRM round trip are deployment facts and are excluded.",
};

export const COST = {
  perTurnUsd: 0.0091,
  monthUsd: 214.7,
  cachedShare: 0.62,
  byProvider: [
    { provider: "anthropic", share: 0.86, usd: 184.6 },
    { provider: "openai", share: 0.14, usd: 30.1 },
  ],
};

export const RELEASES = [
  { sha: "5d9c4df", when: "today", note: "Phase 6 evals behind one gate", gate: 0.982, p95: 4014 },
  { sha: "45ddb2b", when: "2 days ago", note: "pnpm verify, skills-ghl", gate: 0.965, p95: 5294 },
  { sha: "00eda03", when: "5 days ago", note: "Phase 0 monorepo", gate: 0.9, p95: 5036 },
];
