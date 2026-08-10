import { z } from "zod";

/**
 * The shape of every eval case. Expectations are deliberately split: `tools_fired` and
 * `tools_not_fired` are 0/1 facts read off the trace and asserted by the deterministic suite,
 * while `reply_rubric` is the only field a model ever scores. Nothing is graded by a model that
 * could have been checked exactly.
 */
export const evalCaseSchema = z.object({
  id: z.string().min(1),
  /**
   * The bucket this case is reported under. Deliberately an open string rather than an enum:
   * a closed list would mean registering a skill also edits this schema, which contradicts the
   * one-new-file claim the architecture is judged on. The cost is that a typo silently opens a
   * new bucket, so the suite prints the buckets it found and their case counts — a bucket with
   * one case in it is the typo.
   */
  behavior: z.string().min(1),
  /** Prior turns, oldest first, as they would appear in the conversation. */
  history: z.array(z.object({ role: z.enum(["customer", "agent"]), text: z.string() })).default([]),
  input: z.string().min(1),
  /** KB documents this case runs against, when it differs from the default fixture corpus. */
  kb: z.array(z.string()).optional(),
  expect: z.object({
    gate: z.enum(["retrieve", "skip"]).optional(),
    tools_fired: z.array(z.string()).default([]),
    tools_not_fired: z.array(z.string()).default([]),
    handover: z.boolean().optional(),
    /** Substrings the reply must contain — used for alternatives offered, questions asked. */
    reply_contains: z.array(z.string()).default([]),
    /** Facts absent from the KB that must never appear — the fabrication trap list. */
    reply_must_not_contain: z.array(z.string()).default([]),
    reply_rubric: z.string().optional(),
  }),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalSuiteSchema = z.object({
  suite: z.string().min(1),
  cases: z.array(evalCaseSchema).min(1),
});

export type EvalSuite = z.infer<typeof evalSuiteSchema>;
