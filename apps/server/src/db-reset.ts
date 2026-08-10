import { loadEnv } from "@harness/config";
import { createDatabase, schema } from "@harness/db";
import { config } from "dotenv";
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { createInterface } from "node:readline/promises";
import { fromRepoRoot } from "./paths.js";

/**
 * Empties everything the harness wrote, so a run starts from a knowable state. Flags: --dry-run,
 * --all (drops kb_chunks too, then re-ingests). `installations` is never touched: it holds the
 * OAuth refresh token, and losing it means reinstalling against the sandbox by hand.
 */

/* eslint-disable no-console -- a maintenance command's output is its interface */

config({ path: fromRepoRoot(".env") });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const includeKnowledge = args.includes("--all");

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);

/** Ordered so a future foreign key does not make this fail halfway. */
interface Target {
  name: string;
  table: PgTable;
  why: string;
}

const TABLES: Target[] = [
  { name: "trace_events", table: schema.traceEvents, why: "every turn's event stream" },
  { name: "knowledge_gaps", table: schema.knowledgeGaps, why: "unanswered questions" },
  { name: "processed_messages", table: schema.processedMessages, why: "webhook dedupe keys" },
  { name: "conversations", table: schema.conversations, why: "per-thread agent state" },
  { name: "eval_runs", table: schema.evalRuns, why: "recorded suite results" },
  { name: "sub_accounts", table: schema.subAccounts, why: "tenancy, re-created on first webhook" },
];

if (includeKnowledge) {
  TABLES.push({ name: "kb_chunks", table: schema.kbChunks, why: "the indexed knowledge base" });
}

const rows = async (table: PgTable): Promise<number> =>
  (await db.select({ n: count() }).from(table))[0]?.n ?? 0;

console.log(
  `\n${dryRun ? "Would delete" : "About to delete"} from ${env.DATABASE_URL.split("@")[1]?.split("/")[0] ?? "the database"}:\n`,
);

let total = 0;
for (const entry of TABLES) {
  const n = await rows(entry.table);
  total += n;
  console.log(`  ${entry.name.padEnd(20)} ${String(n).padStart(6)}   ${entry.why}`);
}

const installs = await rows(schema.installations);
console.log(
  `\n  ${"installations".padEnd(20)} ${String(installs).padStart(6)}   KEPT — the OAuth token`,
);
if (!includeKnowledge) {
  const kb = await rows(schema.kbChunks);
  console.log(`  ${"kb_chunks".padEnd(20)} ${String(kb).padStart(6)}   KEPT — pass --all to clear`);
}

if (dryRun) {
  console.log(`\n${total} rows would go. Nothing was deleted.`);
  await pool.end();
  process.exit(0);
}

if (total === 0) {
  console.log("\nAlready empty.");
  await pool.end();
  process.exit(0);
}

// Irreversible, and there is no undo on a hosted Postgres. Worth one keystroke.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`\nDelete ${total} rows? Type "yes" to confirm: `);
rl.close();

if (answer.trim().toLowerCase() !== "yes") {
  console.log("Cancelled. Nothing was deleted.");
  await pool.end();
  process.exit(1);
}

for (const entry of TABLES) {
  await db.delete(entry.table);
  console.log(`  cleared ${entry.name}`);
}

console.log(
  `\nDone. ${includeKnowledge ? "Re-index with `pnpm kb:ingest` before the next run." : "The knowledge base was left in place."}`,
);
await pool.end();
