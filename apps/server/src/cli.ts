import { loadEnv, loadSettings } from "@harness/config";
import {
  Embedder,
  ProviderRegistry,
  runTurn,
  SkillRegistry,
  Tracer,
  type Session,
} from "@harness/core";
import { createDatabase } from "@harness/db";
import { config } from "dotenv";
import { createInterface } from "node:readline/promises";
import { fromRepoRoot } from "./paths.js";
import { loadSoul } from "./skill-docs.js";
import { PgKnowledgeStore } from "./store/knowledge-store.js";

/* eslint-disable no-console -- a REPL's output is its interface */

/**
 * Runs turns against the harness with no CRM, no webhook, and no tunnel.
 *
 * This is the loop a developer actually works in: the pipeline in phase 1 is proven and does not
 * need re-proving on every prompt change, and a round trip through GHL costs seconds per attempt.
 * Each turn prints its own trace, so a wrong answer is diagnosed where it happened.
 */
config({ path: fromRepoRoot(".env") });

const env = loadEnv();
const settings = await loadSettings(fromRepoRoot(env.SETTINGS_PATH));
const soul = await loadSoul(settings.soulPath);

// The same knowledge base the webhook path searches. Without it the gate and retrieval never run
// and the model answers from nothing, confidently.
const { db, pool } = createDatabase(env.DATABASE_URL);
const knowledge = env.OPENAI_API_KEY
  ? new PgKnowledgeStore(
      db,
      new Embedder({ ...settings.model.embedding, apiKey: env.OPENAI_API_KEY }),
    )
  : undefined;
if (!knowledge) console.log("no embedding key — the knowledge base will not be searched\n");

const providers = new ProviderRegistry({
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
});

/**
 * `--provider anthropic` replays the same conversation on one provider without editing settings.
 * A comma-separated list builds an ad-hoc chain, which is how failover gets exercised on demand:
 * `--provider google,anthropic` puts a failing provider first on purpose.
 */
const requested = process.argv.includes("--provider")
  ? process.argv[process.argv.indexOf("--provider") + 1]?.split(",")
  : undefined;

const chain = requested
  ? requested.map((name) => {
      const binding = settings.model.chain.find((entry) => entry.provider === name);
      if (!binding) throw new Error(`No entry in the model chain uses provider "${name}"`);
      return binding;
    })
  : settings.model.chain;

const configured = chain.filter((binding) => providers.has(binding.provider));
console.log(
  `${settings.businessName}  ·  chain: ${configured.map((b) => `${b.provider}/${b.model}`).join(" -> ")}`,
);
console.log("Type a message, or /quit.\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });

for (;;) {
  let text: string;
  try {
    text = (await rl.question("you  > ")).trim();
  } catch {
    // stdin closed, which is the normal end of a piped session rather than a failure.
    break;
  }
  if (text === "/quit" || text === "") break;

  const tracer = new Tracer({ turnId: crypto.randomUUID(), conversationId: "cli", sinks: [] });
  tracer.emit({ type: "turn_start", input: text, messageIds: ["cli"] });

  const session: Session = {
    input: {
      locationId: settings.locationId,
      contactId: "cli-contact",
      conversationId: "cli",
      text,
      history: [],
    },
    settings: { ...settings, model: { ...settings.model, chain } },
    skills: new SkillRegistry(),
    proceduralDocs: [],
    soul,
    ...(knowledge ? { knowledge } : {}),
  };

  const startedAt = Date.now();
  try {
    const result = await runTurn(session, providers, tracer, {
      locationId: settings.locationId,
      contactId: "cli-contact",
      conversationId: "cli",
      settings,
      tracer,
      remember: () => undefined,
    });
    console.log(`agent> ${result.reply}\n`);
  } catch (error) {
    console.log(`agent> <failed> ${error instanceof Error ? error.message : String(error)}\n`);
  }

  for (const event of tracer.events) {
    const latency = "latencyMs" in event ? `${event.latencyMs}ms` : "";
    const detail =
      event.type === "llm_call"
        ? `${event.provider}/${event.model} attempt ${event.attempt}`
        : event.type === "tool_call"
          ? event.skill
          : event.type === "error"
            ? event.message.slice(0, 80)
            : "";
    console.log(
      `  ${String(event.seq).padStart(2)} ${event.type.padEnd(18)} ${latency.padStart(7)}  ${detail}`,
    );
  }
  console.log(`  total ${Date.now() - startedAt}ms\n`);
}

rl.close();
await pool.end();
