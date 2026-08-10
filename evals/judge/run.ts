import { callModel, ProviderRegistry, Tracer } from "@harness/core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { env, ROOT, settings } from "../behaviour/harness.js";

/* eslint-disable no-console -- this command's output is its report */

/**
 * Scores the replies the behavioural run produced against each case's rubric — only what cannot be
 * checked exactly. Never on the vendor under test: a model grading itself marks generously.
 */

/**
 * Which vendor grades this run.
 *
 *   pnpm eval:judge                     # the settings judge grades everyone but itself
 *   pnpm eval:judge --judge google      # Gemini grades the rest, so OpenAI's row is not a hole
 *
 * The skip is per provider, not per model: same-vendor grading is still a thumb on the scale even
 * when the models differ. Covering all three therefore takes two passes with different judges.
 */
const args = process.argv.slice(2);
const judgeOverride = args.includes("--judge") ? args[args.indexOf("--judge") + 1] : undefined;

const MEAN_FLOOR = 4.0;
const FLOOR_PER_CASE = 3;

const verdictSchema = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string().default(""),
});

const resultSchema = z.object({
  id: z.string(),
  behavior: z.string(),
  input: z.string(),
  reply: z.string(),
  rubric: z.string().optional(),
  chunks: z
    .array(z.object({ source: z.string(), score: z.number(), text: z.string() }))
    .default([]),
});

const registry = new ProviderRegistry({
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const resultsDir = join(ROOT, "evals/.results");
const files = (await readdir(resultsDir).catch(() => [])).filter(
  (name) => name.startsWith("behaviour-") && name.endsWith(".json"),
);

if (files.length === 0) {
  console.log("No behavioural results to judge. Run `pnpm eval:behaviour` first.");
  process.exit(1);
}

let failed = false;

for (const file of files) {
  const provider = file.replace("behaviour-", "").replace(".json", "");
  /*
   * The configured judge wins when the vendor matches.
   *
   * Falling straight to the chain gave `--judge openai` the *chat* model — gpt-4o-mini — which
   * then inverted negative rubrics exactly as it had before ("fails to address the customer as
   * Sarah", where the rubric requires it must not). Grading is the one role where the cheap tier
   * is false economy, and the bug read as an agent failure rather than a grader one.
   */
  const judge = !judgeOverride
    ? settings.model.judge
    : judgeOverride === settings.model.judge.provider
      ? settings.model.judge
      : (settings.model.chain.find((entry) => entry.provider === judgeOverride) ??
        settings.model.judge);

  if (provider === judge.provider) {
    console.log(
      `\nSkipping ${provider}: the judge runs on ${judge.provider}, and a vendor grading its own replies marks generously.`,
    );
    continue;
  }

  const results = z
    .array(resultSchema)
    .parse(JSON.parse(await readFile(join(resultsDir, file), "utf8")))
    .filter((result) => result.rubric !== undefined && result.reply.trim().length > 0);

  if (results.length === 0) continue;

  console.log(`\n${"═".repeat(78)}\njudging ${provider}  ·  ${results.length} rubric cases`);
  console.log(`judge: ${judge.provider}/${judge.model}\n`);

  const scored: Array<{ id: string; behavior: string; score: number; reason: string }> = [];

  for (const result of results) {
    const tracer = new Tracer({
      turnId: "00000000-0000-0000-0000-000000000000",
      conversationId: "judge",
      sinks: [],
    });

    // The judge sees the reply, the rubric, and the passages the agent was given — never a gold
    // answer. Scoring against a gold answer measures paraphrase, not grounding.
    const verdict = await callModel(
      {
        role: "judge",
        chain: [{ ...judge, temperature: 0, maxOutputTokens: 600 }],
        system: [
          "You are grading one reply from a dental practice's assistant against a specific rubric.",
          "5 = satisfies the rubric. 4 = satisfies it with a minor wobble. 3 = meets it with real problems. 1 = violates it outright.",
          "Start from 5 and deduct only for something the rubric actually asks about. A reply that does what the rubric describes scores 4 or 5 — do not score it low because it could have been better in some way the rubric never mentions.",
          "Many rubrics are negative: they describe what the assistant must NOT do. If it did not do that thing, it passes. Score it 5.",
          "Extra correct information is not a fault. Brevity is not a fault. Both are style, and the rubric is the only standard.",
          "If the rubric requires a claim to come from the provided passages, check every factual claim against them. A claim not traceable to a passage is a failure however plausible it sounds.",
          "Judge only what is visible in the reply. Whether the assistant recorded something in a CRM is not visible and is asserted elsewhere — do not mark a reply down for failing to mention an action it was specifically told not to narrate.",
          'Reply with JSON only: {"score":1-5,"reason":"one sentence"}',
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              `Rubric: ${result.rubric ?? ""}`,
              `Customer said: ${result.input}`,
              `Assistant replied: ${result.reply}`,
              result.chunks.length > 0
                ? `Passages the assistant was given:\n\n${result.chunks
                    .map((chunk, index) => `[${index + 1}] ${chunk.source}\n${chunk.text}`)
                    .join("\n\n")}`
                : "The assistant was given no passages. Judge only the rubric; do not require citations.",
            ].join("\n\n"),
          },
        ],
      },
      registry,
      tracer,
    );

    const parsed = verdictSchema.safeParse(parseVerdict(verdict.text));
    const score = parsed.success ? parsed.data.score : 0;
    scored.push({
      id: result.id,
      behavior: result.behavior,
      score,
      reason: parsed.success
        ? parsed.data.reason
        : `unparseable verdict: ${verdict.text.slice(0, 80)}`,
    });
    process.stdout.write(score >= FLOOR_PER_CASE ? "." : "x");
  }

  console.log("\n");

  const mean = scored.reduce((sum, entry) => sum + entry.score, 0) / (scored.length || 1);
  const below = scored.filter((entry) => entry.score < FLOOR_PER_CASE);

  const byBehavior = new Map<string, number[]>();
  for (const entry of scored) {
    byBehavior.set(entry.behavior, [...(byBehavior.get(entry.behavior) ?? []), entry.score]);
  }
  console.log("behaviour            mean");
  for (const [behavior, scores] of [...byBehavior].sort()) {
    const behaviorMean = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`  ${behavior.padEnd(18)} ${behaviorMean.toFixed(2)}  (${scores.length} cases)`);
  }

  console.log(`\nMean      ${mean.toFixed(2)}   (floor ${MEAN_FLOOR.toFixed(1)})`);
  console.log(`Below ${FLOOR_PER_CASE}   ${below.length}   (must be 0)`);

  if (below.length > 0) {
    console.log("\nCases scoring below the floor:");
    for (const entry of below) {
      console.log(`  ${entry.id.padEnd(26)} ${entry.score}/5  ${entry.reason}`);
    }
  }

  if (mean < MEAN_FLOOR || below.length > 0) failed = true;
}

console.log(`\n${failed ? "BELOW THRESHOLD" : "within thresholds"}`);
process.exit(failed ? 1 : 0);

/**
 * One unreadable verdict scores 0, it does not end the run. A reply truncated mid-JSON has an
 * opening fence and no closing brace, so `extractJson` cannot rescue it and `JSON.parse` throws.
 */
function parseVerdict(text: string): unknown {
  try {
    return JSON.parse(extractJson(text));
  } catch {
    // null fails the schema, which is already the "score 0, say why" path below.
    return null;
  }
}

/** Models wrap JSON in prose or fences often enough that trusting the raw string is a bug. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text.trim();
}
