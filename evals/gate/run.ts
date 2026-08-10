import { loadEnv, loadSettings } from "@harness/config";
import { decideRetrieval, ProviderRegistry, Tracer } from "@harness/core";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/* eslint-disable no-console -- this command's output is its report */

/**
 * Scores the retrieval gate against labelled cases.
 *
 *   pnpm eval:gate
 *
 * The two errors are not symmetric and the report says so. A false skip is a customer told the
 * agent does not know something that is written down; a false retrieve costs a couple of seconds.
 * Recall is the number to protect, which is why it is the one with the threshold.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `--provider openai` runs the trigger decision on that vendor's model instead of the configured
 * gate. Precision and recall are a property of the model doing the deciding, so a per-provider
 * table that reported one number three times would be worse than reporting none.
 */
const cliArgs = process.argv.slice(2);
const gateProvider = cliArgs.includes("--provider")
  ? cliArgs[cliArgs.indexOf("--provider") + 1]
  : undefined;
config({ path: join(ROOT, ".env") });

const RECALL_FLOOR = 0.95;
const PRECISION_FLOOR = 0.85;

const suiteSchema = z.object({
  suite: z.string(),
  cases: z.array(z.object({ id: z.string(), input: z.string(), retrieve: z.boolean() })).min(1),
});

const env = loadEnv();
const loaded = await loadSettings(join(ROOT, env.SETTINGS_PATH));
const gateBinding = gateProvider
  ? (loaded.model.chain.find((entry) => entry.provider === gateProvider) ?? loaded.model.gate)
  : loaded.model.gate;
// The gate's own budget and shape are kept whichever vendor answers, so the comparison is of the
// model and not of three different configurations wearing one name.
const settings = {
  ...loaded,
  model: {
    ...loaded.model,
    gate: {
      ...gateBinding,
      temperature: 0,
      maxOutputTokens: loaded.model.gate.maxOutputTokens,
      timeoutMs: loaded.model.gate.timeoutMs,
    },
  },
};
const registry = new ProviderRegistry({
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const suite = suiteSchema.parse(
  parseYaml(await readFile(join(ROOT, "evals/fixtures/gate.yaml"), "utf8")),
);

interface Outcome {
  id: string;
  input: string;
  expected: boolean;
  actual: boolean;
  decidedBy: string;
  reason: string;
  query: string;
  latencyMs: number;
}

const outcomes: Outcome[] = [];

// Sequential on purpose: the point is to measure what one turn costs, and a burst of parallel
// requests measures the provider's concurrency limits instead.
for (const testCase of suite.cases) {
  const tracer = new Tracer({
    turnId: "00000000-0000-0000-0000-000000000000",
    conversationId: "gate-eval",
    sinks: [],
  });
  const startedAt = Date.now();
  const decision = await decideRetrieval(
    { text: testCase.input, hasPendingAction: false },
    settings,
    registry,
    tracer,
  );

  outcomes.push({
    id: testCase.id,
    input: testCase.input,
    expected: testCase.retrieve,
    actual: decision.retrieve,
    decidedBy: decision.decidedBy,
    reason: decision.reason,
    query: (decision.queries ?? []).join(" | "),
    latencyMs: Date.now() - startedAt,
  });
  process.stdout.write(decision.retrieve === testCase.retrieve ? "." : "x");
}

console.log("\n");

const truePositive = outcomes.filter((o) => o.expected && o.actual);
const falsePositive = outcomes.filter((o) => !o.expected && o.actual);
const falseNegative = outcomes.filter((o) => o.expected && !o.actual);
const trueNegative = outcomes.filter((o) => !o.expected && !o.actual);

const precision = truePositive.length / (truePositive.length + falsePositive.length || 1);
const recall = truePositive.length / (truePositive.length + falseNegative.length || 1);
const accuracy = (truePositive.length + trueNegative.length) / outcomes.length;

console.log("Confusion matrix");
console.log("                    predicted retrieve   predicted skip");
console.log(
  `  actually needed   ${String(truePositive.length).padStart(14)}   ${String(falseNegative.length).padStart(14)}`,
);
console.log(
  `  actually not      ${String(falsePositive.length).padStart(14)}   ${String(trueNegative.length).padStart(14)}`,
);

console.log(`\nCases     ${outcomes.length}`);
console.log(`Accuracy  ${(accuracy * 100).toFixed(1)}%`);
console.log(
  `Precision ${(precision * 100).toFixed(1)}%   (floor ${(PRECISION_FLOOR * 100).toFixed(0)}%)  — of the turns it retrieved on, how many needed it`,
);
console.log(
  `Recall    ${(recall * 100).toFixed(1)}%   (floor ${(RECALL_FLOOR * 100).toFixed(0)}%)  — of the turns that needed it, how many got it`,
);

const decidedByModel = outcomes.filter((o) => o.decidedBy === "model");
const free = outcomes.filter((o) => o.decidedBy === "heuristic");
const timedOut = outcomes.filter((o) => o.decidedBy === "timeout_default");
const modelLatency = decidedByModel.map((o) => o.latencyMs).sort((a, b) => a - b);

console.log(
  `\nDecided free (heuristic)  ${free.length}` +
    `\nDecided by model          ${decidedByModel.length}` +
    (modelLatency.length > 0
      ? `  p50 ${modelLatency[Math.floor(modelLatency.length / 2)]}ms  max ${modelLatency.at(-1)}ms`
      : "") +
    `\nTimed out (fail-${settings.knowledge.gateFailOpen ? "open" : "closed"})   ${timedOut.length}`,
);

if (falseNegative.length > 0) {
  console.log("\nFALSE SKIPS — a customer would be told we do not know:");
  for (const outcome of falseNegative) {
    console.log(`  ${outcome.id.padEnd(24)} ${JSON.stringify(outcome.input)}  (${outcome.reason})`);
  }
}
if (falsePositive.length > 0) {
  console.log("\nFalse retrieves — cost is latency only:");
  for (const outcome of falsePositive) {
    console.log(`  ${outcome.id.padEnd(24)} ${JSON.stringify(outcome.input)}  (${outcome.reason})`);
  }
}

// Written for the console, so it can never claim a pass the suite did not produce.
await mkdir(join(ROOT, "evals/.results"), { recursive: true });
await writeFile(
  join(ROOT, `evals/.results/gate${gateProvider ? `-${gateProvider}` : ""}.json`),
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      provider: settings.model.gate.provider,
      model: settings.model.gate.model,
      cases: outcomes.length,
      accuracy,
      precision,
      precisionFloor: PRECISION_FLOOR,
      recall,
      recallFloor: RECALL_FLOOR,
      truePositive: truePositive.length,
      falsePositive: falsePositive.length,
      trueNegative: trueNegative.length,
      falseNegative: falseNegative.length,
      falseSkips: falseNegative.map((o) => ({ id: o.id, input: o.input, reason: o.reason })),
      falseRetrieves: falsePositive.map((o) => ({ id: o.id, input: o.input, reason: o.reason })),
    },
    null,
    2,
  ),
);

const failed = recall < RECALL_FLOOR || precision < PRECISION_FLOOR;
console.log(`\n${failed ? "BELOW THRESHOLD" : "within thresholds"}`);
process.exit(failed ? 1 : 0);
