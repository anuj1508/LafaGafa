import { loadEnv } from "@harness/config";
import { createDatabase, schema } from "@harness/db";
import { desc, eq } from "drizzle-orm";
import { config } from "dotenv";
import { fromRepoRoot } from "./paths.js";

/* eslint-disable no-console -- a trace viewer's output is its interface */

/**
 * Prints recent turns as an ordered waterfall, off the same `trace_events` rows every other
 * surface reads. Args: --full for the assembled prompt, or a turn id.
 */

config({ path: fromRepoRoot(".env") });
const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL);

const args = process.argv.slice(2);
const full = args.includes("--full");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex === -1 ? 3 : Number(args[limitIndex + 1]) || 3;
// Skip the value belonging to --limit, or it gets mistaken for a turn id.
const turnArg = args.find((arg, index) => !arg.startsWith("--") && index !== limitIndex + 1);

const turnIds = turnArg
  ? [turnArg]
  : [
      ...new Set(
        (
          await db
            .select({ turnId: schema.traceEvents.turnId, ts: schema.traceEvents.ts })
            .from(schema.traceEvents)
            .orderBy(desc(schema.traceEvents.ts))
            .limit(limit * 20)
        ).map((row) => row.turnId),
      ),
    ].slice(0, limit);

if (turnIds.length === 0) console.log("No traces recorded yet.");

for (const turnId of turnIds.reverse()) {
  const events = await db
    .select()
    .from(schema.traceEvents)
    .where(eq(schema.traceEvents.turnId, turnId))
    .orderBy(schema.traceEvents.seq);

  const first = events[0];
  if (!first) continue;

  const payloadOf = (index: number) => events[index]?.payload as Record<string, unknown>;
  const start = events.find((event) => event.type === "turn_start")?.payload as
    { input?: string } | undefined;

  console.log(`\n${"─".repeat(78)}`);
  console.log(`turn ${turnId}   ${first.ts.toISOString()}`);
  console.log(`conversation ${first.conversationId}`);
  console.log(`customer: ${JSON.stringify(start?.input ?? "")}`);
  console.log("");

  for (const [index, event] of events.entries()) {
    const payload = payloadOf(index);
    const latency = event.latencyMs === null ? "" : `${event.latencyMs}ms`;
    console.log(
      `  ${String(event.seq).padStart(2)} ${event.type.padEnd(18)} ${latency.padStart(8)}  ${summarise(event.type, payload)}`,
    );

    if (!full) continue;
    if (event.type === "llm_call") {
      const prompt = payload["prompt"] as { system?: string; messages?: unknown[] } | undefined;
      console.log(indent(`system: ${text(prompt?.system).slice(0, 2000)}`));
      console.log(indent(`messages: ${JSON.stringify(prompt?.messages ?? [], null, 2)}`));
      console.log(indent(`completion: ${text(payload["completion"], "")}`));
    }
    if (event.type === "tool_result") {
      console.log(indent(JSON.stringify(payload["result"], null, 2)));
    }
  }
}

/** jsonb comes back as `unknown`; this renders any of it without producing "[object Object]". */
function text(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function summarise(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "llm_call":
      return `${text(payload["provider"])}/${text(payload["model"])} attempt ${text(payload["attempt"])}  in=${text(payload["inputTokens"], "?")} out=${text(payload["outputTokens"], "?")}`;
    case "provider_failover":
      return `-> ${JSON.stringify(payload["to"])}  ${text(payload["reason"]).slice(0, 60)}`;
    case "tool_call":
      return `${text(payload["skill"])}  ${JSON.stringify(payload["args"])}`;
    case "tool_result":
      return `${text(payload["skill"])} -> ${text(payload["outcome"])}`;
    case "skill_guard":
      return `${text(payload["guard"])} ${payload["passed"] === true ? "pass" : `FAIL: ${text(payload["reason"], "")}`}`;
    case "handover":
      return `${text(payload["trigger"])}  evidence=${JSON.stringify(payload["evidence"])}`;
    case "gate":
      return `${text(payload["decision"])} via ${text(payload["decidedBy"])}  ${text(payload["reason"], "")}`;
    case "rag_retrieve":
      return `${String((payload["chunks"] as unknown[] | undefined)?.length ?? 0)} chunks  belowFloor=${text(payload["belowFloor"])}`;
    case "error":
      return `${text(payload["stage"])}: ${text(payload["message"]).slice(0, 90)}`;
    case "turn_end":
      return `${text(payload["stopReason"])}  reply=${JSON.stringify(text(payload["reply"]).slice(0, 70))}`;
    default:
      return "";
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n");
}

await pool.end();
