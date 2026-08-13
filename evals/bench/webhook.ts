import { createDatabase } from "@harness/db";
import { env, loadCases } from "../behaviour/harness.js";

/* eslint-disable no-console -- this command's output is its report */

/**
 * Drives the deployed harness through its real customer path and lets the traces do the measuring.
 *
 *   pnpm bench:webhook --target https://host --provider anthropic,openai,google
 *
 * `pnpm bench` times the loop against a mock CRM. This times what the SLO is written about:
 * webhook received to reply accepted by the CRM, including the debounce window and the send. It
 * computes nothing itself — every number comes from `turn_sent` and `crm_call`. See
 * docs/architecture.md#slo-clock.
 */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const target = (flag("target") ?? "http://localhost:3000").replace(/\/$/, "");
const providers = (flag("provider") ?? "anthropic,openai,google").split(",");
const limit = flag("limit") === undefined ? undefined : Number(flag("limit"));
/** The first turns of a run pay for a cold container and a cold pool. They are not the SLO. */
const warmup = Math.max(0, Number(flag("warmup") ?? 3));
/** Breathing room between turns. The CRM rate-limits well below what this loop could drive. */
const gapMs = Math.max(0, Number(flag("gap") ?? 2000));
const dryRun = args.includes("--dry-run");

const corpus = await loadCases("evals/fixtures/behaviour.yaml");

/**
 * A proportional slice of the corpus, keeping every behaviour represented.
 *
 * Deterministic — the first N of each group in fixture order — so the run reproduces rather than
 * sampling a different workload each time. The same cases run on every provider, because comparing
 * vendors across different inputs compares the inputs.
 */
function stratify(all: typeof corpus, size: number): typeof corpus {
  const groups = new Map<string, typeof corpus>();
  for (const testCase of all) {
    groups.set(testCase.behavior, [...(groups.get(testCase.behavior) ?? []), testCase]);
  }
  const picked = [...groups]
    .sort()
    .flatMap(([, group]) =>
      group.slice(0, Math.max(1, Math.round((group.length / all.length) * size))),
    );
  // Fixture order, not group order: a run that does all the RAG turns last would drift with it.
  return all.filter((testCase) => picked.includes(testCase));
}

const sample = flag("sample") === undefined ? undefined : Number(flag("sample"));
const cases = sample === undefined ? corpus.slice(0, limit) : stratify(corpus, sample);

const post = async (path: string, body?: unknown): Promise<unknown> => {
  const response = await fetch(`${target}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${path} returned ${String(response.status)}`);
  return response.json();
};

console.log(
  `\ntarget     ${target}` +
    `\nproviders  ${providers.join(", ")}` +
    `\ncases      ${String(cases.length)} per provider, sequential` +
    `\nwarmup     ${String(warmup)} turns discarded` +
    `\ntotal      ${String(cases.length * providers.length)} real turns\n`,
);

const byBehaviour = new Map<string, number>();
for (const testCase of cases) {
  byBehaviour.set(testCase.behavior, (byBehaviour.get(testCase.behavior) ?? 0) + 1);
}
console.log("per provider, by behaviour:");
for (const [behavior, count] of [...byBehaviour].sort()) {
  const total = corpus.filter((entry) => entry.behavior === behavior).length;
  console.log(`  ${behavior.padEnd(16)} ${String(count).padStart(2)} of ${String(total)}`);
}
// RAG turns are excluded from the SLO and reported apart, so the split is worth knowing up front.
const ragCases = cases.filter((entry) => entry.behavior === "rag").length;
console.log(
  `\nnon-RAG ${String(cases.length - ragCases)} per provider — the SLO rests on these` +
    `\nRAG     ${String(ragCases)} per provider — reported separately\n`,
);

if (dryRun) {
  console.log("Dry run. Nothing was sent. Every case that would run:\n");
  for (const testCase of cases) {
    console.log(`  ${testCase.id.padEnd(26)} ${testCase.behavior.padEnd(15)} ${testCase.input}`);
  }
  process.exit(0);
}

const { pool } = createDatabase(env.DATABASE_URL);

/**
 * Resolves once the turn for `conversationId` has closed its SLO clock, or gives up.
 * Read rather than stopwatched: a client-side timer would include this script's own network.
 */
async function waitForTurn(conversationId: string, since: Date): Promise<number | null> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
    const { rows } = await pool.query<{ ms: number }>(
      `select (payload->>'webhookToSendMs')::int as ms from trace_events
       where type = 'turn_sent' and conversation_id = $1 and ts >= $2 limit 1`,
      [conversationId, since.toISOString()],
    );
    if (rows[0]) return rows[0].ms;
  }
  return null;
}

for (const provider of providers) {
  console.log(`\n${"━".repeat(70)}\n${provider}\n`);
  await post("/api/admin/model", { provider });

  let index = 0;
  const problems: string[] = [];
  for (const testCase of cases) {
    index += 1;

    const since = new Date();
    try {
      // A conversation per case, never a pool. A reused thread carries the previous case's history
      // into the prompt, so the second turn on it is slower for a reason that is not the harness.
      const session = (await post("/api/chat/session")) as {
        sessionId: string;
        conversationId: string;
      };
      await post("/api/chat/message", { sessionId: session.sessionId, text: testCase.input });
      const ms = await waitForTurn(session.conversationId, since);
      if (ms === null) problems.push(`${testCase.id}: no turn_sent within 90s`);
      process.stdout.write(ms === null ? "?" : index <= warmup ? "w" : ".");
    } catch (error) {
      problems.push(`${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
      process.stdout.write("E");
    }
    // Paced, not hammered: the CRM rate-limits, and a 429 would be recorded as harness latency.
    await new Promise((resolve) => globalThis.setTimeout(resolve, gapMs));
  }
  console.log(
    `\n${String(cases.length - problems.length)}/${String(cases.length)} turns measured.`,
  );
  if (problems.length > 0) {
    console.log(`\nNot measured — every one named:`);
    for (const problem of problems) console.log(`  ${problem}`);
  }
}

await pool.end();
console.log(`\nDone. Read the result with the latency query, not from this output.`);
