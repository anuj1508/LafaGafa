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
/** Conversations to spread the corpus over. Fewer means longer histories and slower later turns. */
const poolSize = Math.max(1, Number(flag("pool") ?? 15));
const limit = flag("limit") === undefined ? undefined : Number(flag("limit"));
/** The first turns of a run pay for a cold container and a cold pool. They are not the SLO. */
const warmup = Math.max(0, Number(flag("warmup") ?? 3));
const dryRun = args.includes("--dry-run");

const cases = (await loadCases("evals/fixtures/behaviour.yaml")).slice(0, limit);

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
    `\npool       ${String(poolSize)} conversations per provider` +
    `\nwarmup     ${String(warmup)} turns discarded` +
    `\ntotal      ${String(cases.length * providers.length)} real turns\n`,
);

if (dryRun) {
  console.log("Dry run. Nothing was sent. The first five inputs:\n");
  for (const testCase of cases.slice(0, 5)) {
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

  const sessions: Array<{ sessionId: string; conversationId: string }> = [];
  for (let i = 0; i < poolSize; i += 1) {
    sessions.push(
      (await post("/api/chat/session")) as { sessionId: string; conversationId: string },
    );
  }

  let index = 0;
  for (const testCase of cases) {
    const session = sessions[index % sessions.length];
    index += 1;
    if (!session) continue;

    const since = new Date();
    try {
      await post("/api/chat/message", { sessionId: session.sessionId, text: testCase.input });
      const ms = await waitForTurn(session.conversationId, since);
      process.stdout.write(ms === null ? "?" : index <= warmup ? "w" : ".");
    } catch {
      process.stdout.write("E");
    }
  }
  console.log(`\n${String(cases.length)} turns driven. Query the traces for the numbers.`);
}

await pool.end();
console.log(`\nDone. Read the result with the latency query, not from this output.`);
