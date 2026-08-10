import type { ProviderName } from "@harness/config";
import { Embedder, type KnowledgeStore } from "@harness/core";
import { createDatabase } from "@harness/db";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PgKnowledgeStore } from "../../apps/server/src/store/knowledge-store.js";
import { PostgresTraceSink } from "../../apps/server/src/tracing/postgres-sink.js";
import {
  env,
  loadCases,
  loadPrompts,
  ROOT,
  runCase,
  settings,
  useEvalSinks,
  type EvalCase,
} from "./harness.js";

/* eslint-disable no-console -- this command's output is its report */

/**
 * Replays the behavioural corpus through the real loop and reports what fired, as 0/1 facts off
 * the trace. `not_fired` carries most of the weight. Flags: --provider, --behavior, --concurrency.
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const providers = (flag("provider") ?? "anthropic").split(",") as ProviderName[];

/**
 * How many cases run at once against one vendor. Cases share nothing but the rate limit; drop to 1
 * if a provider starts returning 429s.
 */
const concurrency = Math.max(1, Number(flag("concurrency") ?? 5));
const onlyBehavior = flag("behavior");

const cases = (await loadCases("evals/fixtures/behaviour.yaml")).filter(
  (testCase) => !onlyBehavior || testCase.behavior === onlyBehavior,
);
const { soul, proceduralDocs } = await loadPrompts();

// The real index, so grounding cases are scored against the documents that ship rather than
// against a fixture someone wrote to match the answer they wanted.
const { db, pool } = createDatabase(env.DATABASE_URL);

// Eval turns land in the same table as production ones, tagged `source: "eval"`. One viewer, two
// sources — a failing case becomes a turn you can replay rather than a line of text.
useEvalSinks([
  new PostgresTraceSink(db, {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, fields) => {
      console.error(message, fields);
    },
  }),
]);
const knowledge: KnowledgeStore | undefined = env.OPENAI_API_KEY
  ? new PgKnowledgeStore(
      db,
      new Embedder({ ...settings.model.embedding, apiKey: env.OPENAI_API_KEY }),
    )
  : undefined;

interface Failure {
  id: string;
  behavior: string;
  why: string;
}

export interface CaseResult {
  id: string;
  behavior: string;
  /** Ties a result row to its persisted trace, so the admin can open the exact turn. */
  turnId: string;
  input: string;
  reply: string;
  passed: boolean;
  failures: string[];
  rubric?: string;
  /**
   * The passage text, not just its filename: a judge asked whether a claim is traceable cannot
   * answer that from "fees.md 0.71", and scores every grounded answer 1/5 for being unverifiable.
   */
  chunks: Array<{ source: string; score: number; text: string }>;
  latencyMs: number;
}

function check(testCase: EvalCase, outcome: Awaited<ReturnType<typeof runCase>>): string[] {
  const problems: string[] = [];
  const fired = new Set(outcome.fired);

  for (const skill of testCase.expect.fired) {
    if (!fired.has(skill)) problems.push(`${skill} did not fire`);
  }
  for (const skill of testCase.expect.not_fired) {
    if (fired.has(skill)) problems.push(`${skill} fired and must not have`);
  }
  if (testCase.expect.gate && outcome.gate !== testCase.expect.gate) {
    problems.push(`gate was ${outcome.gate ?? "not run"}, expected ${testCase.expect.gate}`);
  }
  if (
    testCase.expect.handover !== undefined &&
    outcome.result.handedOver !== testCase.expect.handover
  ) {
    problems.push(`handedOver was ${String(outcome.result.handedOver)}`);
  }
  for (const [field, value] of Object.entries(testCase.must_not_write)) {
    const offending = outcome.calls.updates.find((patch) => patch[field] === value);
    if (offending) {
      problems.push(`wrote ${field}=${JSON.stringify(value)}, which belongs to someone else`);
    }
  }
  for (const banned of testCase.must_not_contain) {
    if (outcome.result.reply.includes(banned)) {
      problems.push(`reply contained ${JSON.stringify(banned)}, which is not in the documents`);
    }
  }
  if (outcome.result.reply.trim().length === 0) problems.push("reply was empty");
  return problems;
}

for (const provider of providers) {
  console.log(`\n${"═".repeat(78)}\n${provider}  ·  ${cases.length} cases\n`);

  const results: CaseResult[] = [];
  const failures: Failure[] = [];

  /**
   * One retry on a rate limit — a 429 is the harness being asked to slow down, not a bad answer.
   * Deliberately not in `callModel`, where the answer to a 429 is failing over to another vendor.
   */
  const rateLimited = (error: unknown): boolean =>
    /rate limit|429|too many requests/i.test(error instanceof Error ? error.message : "");

  async function attempt(testCase: EvalCase): ReturnType<typeof runCase> {
    try {
      return await runCase(testCase, provider, knowledge, soul, proceduralDocs);
    } catch (error) {
      if (!rateLimited(error)) throw error;
      process.stdout.write("~");
      await new Promise((resolve) => globalThis.setTimeout(resolve, 20_000));
      return runCase(testCase, provider, knowledge, soul, proceduralDocs);
    }
  }

  async function runOne(testCase: EvalCase): Promise<CaseResult> {
    const startedAt = Date.now();
    try {
      const outcome = await attempt(testCase);
      const problems = check(testCase, outcome);
      process.stdout.write(problems.length === 0 ? "." : "x");
      return {
        id: testCase.id,
        behavior: testCase.behavior,
        turnId: outcome.turnId,
        input: testCase.input,
        reply: outcome.result.reply,
        passed: problems.length === 0,
        failures: problems,
        ...(testCase.rubric ? { rubric: testCase.rubric } : {}),
        chunks: outcome.retrieved.map((chunk) => ({
          source: chunk.source,
          score: chunk.score,
          text: chunk.text,
        })),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      process.stdout.write("E");
      return {
        id: testCase.id,
        behavior: testCase.behavior,
        turnId: "",
        input: testCase.input,
        reply: "",
        passed: false,
        failures: [`threw: ${error instanceof Error ? error.message : String(error)}`],
        chunks: [],
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  // A fixed pool, not chunked batches: one slow turn would idle the rest of a batch. Results are
  // written back by index so the report reads in fixture order however they finish.
  const ordered = new Array<CaseResult | undefined>(cases.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
      while (next < cases.length) {
        const index = next++;
        const testCase = cases[index];
        if (testCase) ordered[index] = await runOne(testCase);
      }
    }),
  );

  for (const result of ordered) {
    if (!result) continue;
    results.push(result);
    for (const why of result.failures)
      failures.push({ id: result.id, behavior: result.behavior, why });
  }

  console.log("\n");

  const byBehavior = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    const entry = byBehavior.get(result.behavior) ?? { passed: 0, total: 0 };
    entry.total += 1;
    if (result.passed) entry.passed += 1;
    byBehavior.set(result.behavior, entry);
  }

  console.log("behaviour            pass / total");
  for (const [behavior, entry] of [...byBehavior].sort()) {
    const rate = ((entry.passed / entry.total) * 100).toFixed(0);
    console.log(
      `  ${behavior.padEnd(18)} ${String(entry.passed).padStart(3)} / ${String(entry.total).padEnd(3)}  ${rate}%`,
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const latency = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  console.log(
    `\nTotal      ${passed}/${results.length}  (${((passed / results.length) * 100).toFixed(1)}%)`,
  );
  // Wall clock under load, not latency: with a pool of five, a case's elapsed time includes
  // waiting behind four others. `pnpm bench` measures latency properly, one turn at a time.
  console.log(
    concurrency > 1
      ? `Wall clock p50 ${latency[Math.floor(latency.length / 2)] ?? 0}ms   p95 ${latency[Math.floor(latency.length * 0.95)] ?? 0}ms   (${concurrency} at a time — not a latency figure; see \`pnpm bench\`)`
      : `Latency    p50 ${latency[Math.floor(latency.length / 2)] ?? 0}ms   p95 ${latency[Math.floor(latency.length * 0.95)] ?? 0}ms`,
  );

  if (failures.length > 0) {
    console.log(`\nFailures — every one named:`);
    for (const failure of failures) {
      const result = results.find((r) => r.id === failure.id);
      console.log(`  ${failure.id.padEnd(26)} ${failure.why}`);
      if (result?.reply)
        console.log(`  ${" ".repeat(26)} reply: ${JSON.stringify(result.reply.slice(0, 110))}`);
    }
  }

  // Written for the judge stage and for the report, so a rubric case is scored on the reply that
  // actually happened rather than on one produced by a second run.
  await mkdir(join(ROOT, "evals/.results"), { recursive: true });
  await writeFile(
    join(ROOT, "evals/.results", `behaviour-${provider}.json`),
    JSON.stringify(results, null, 2),
  );
}

await pool.end();
