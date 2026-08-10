import { schema, type Database } from "@harness/db";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { asyncHandler } from "../async-handler.js";
import { fromRepoRoot } from "../paths.js";
import type { AppContext } from "../context.js";

/**
 * Read models for the admin console.
 *
 * Every one of these is a query over `trace_events` or `conversations` — there is no separate
 * reporting store and no aggregation written at turn time. That is deliberate: a number the
 * console shows that cannot be re-derived from the trace is a number nobody can check.
 */
export function adminRoutes(ctx: AppContext): Router {
  const router = Router();
  const db: Database = ctx.db;

  router.get(
    "/api/admin/overview",
    asyncHandler(async (_req, res) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [turns] = await db
        .select({
          turns: count(),
          p50: sql<number>`percentile_disc(0.5) within group (order by (payload->>'totalLatencyMs')::int)`,
          p95: sql<number>`percentile_disc(0.95) within group (order by (payload->>'totalLatencyMs')::int)`,
        })
        .from(schema.traceEvents)
        .where(and(eq(schema.traceEvents.type, "turn_end"), gte(schema.traceEvents.ts, since)));

      const gate = await db
        .select({ decision: sql<string>`payload->>'decision'`, n: count() })
        .from(schema.traceEvents)
        .where(and(eq(schema.traceEvents.type, "gate"), gte(schema.traceEvents.ts, since)))
        .groupBy(sql`payload->>'decision'`);

      const [tokens] = await db
        .select({
          // Cast back to int: sum() over int returns numeric, which node-postgres hands back as
          // a string to avoid precision loss, and the console would render "345390" as text.
          input: sql<number>`coalesce(sum((payload->>'inputTokens')::int), 0)::int`,
          output: sql<number>`coalesce(sum((payload->>'outputTokens')::int), 0)::int`,
          calls: count(),
        })
        .from(schema.traceEvents)
        .where(and(eq(schema.traceEvents.type, "llm_call"), gte(schema.traceEvents.ts, since)));

      const [handovers] = await db
        .select({ n: count() })
        .from(schema.traceEvents)
        .where(and(eq(schema.traceEvents.type, "handover"), gte(schema.traceEvents.ts, since)));

      const [errors] = await db
        .select({ n: count() })
        .from(schema.traceEvents)
        .where(and(eq(schema.traceEvents.type, "error"), gte(schema.traceEvents.ts, since)));

      res.json({
        window: "24h",
        turns: turns?.turns ?? 0,
        latency: { p50: turns?.p50 ?? null, p95: turns?.p95 ?? null },
        gate: Object.fromEntries(gate.map((row) => [row.decision, row.n])),
        tokens: {
          input: tokens?.input ?? 0,
          output: tokens?.output ?? 0,
          calls: tokens?.calls ?? 0,
        },
        handovers: handovers?.n ?? 0,
        errors: errors?.n ?? 0,
      });
    }),
  );

  router.get(
    "/api/admin/conversations",
    asyncHandler(async (_req, res) => {
      const rows = await db
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.updatedAt))
        .limit(50);
      res.json(rows);
    }),
  );

  const turnsQuery = z.object({
    conversationId: z.string().optional(),
    subAccountId: z.string().uuid().optional(),
    /** Live turns and eval turns share a table and a viewer, never a count. */
    source: z.enum(["live", "eval", "all"]).default("live"),
    q: z.string().optional(),
  });

  /** One row per turn, newest first, with just enough to decide which one to open. */
  router.get(
    "/api/admin/turns",
    asyncHandler(async (req, res) => {
      const query = turnsQuery.parse(req.query);
      const rows = await db
        .select({
          turnId: schema.traceEvents.turnId,
          conversationId: schema.traceEvents.conversationId,
          ts: sql<string>`min(${schema.traceEvents.ts})`,
          events: count(),
          input: sql<string>`max(case when ${schema.traceEvents.type} = 'turn_start' then payload->>'input' end)`,
          reply: sql<string>`max(case when ${schema.traceEvents.type} = 'turn_end' then payload->>'reply' end)`,
          stopReason: sql<string>`max(case when ${schema.traceEvents.type} = 'turn_end' then payload->>'stopReason' end)`,
          latencyMs: sql<number>`max(case when ${schema.traceEvents.type} = 'turn_end' then (payload->>'totalLatencyMs')::int end)`,
          gate: sql<string>`max(case when ${schema.traceEvents.type} = 'gate' then payload->>'decision' end)`,
          skills: sql<string>`string_agg(distinct case when ${schema.traceEvents.type} = 'tool_call' then payload->>'skill' end, ',')`,
          failed: sql<boolean>`bool_or(${schema.traceEvents.type} = 'error')`,
          source: sql<string>`max(${schema.traceEvents.source})`,
          subAccountId: sql<string>`max(${schema.traceEvents.subAccountId}::text)`,
          handoverTrigger: sql<string>`max(case when ${schema.traceEvents.type} = 'handover' then payload->>'trigger' end)`,
        })
        .from(schema.traceEvents)
        .where(
          and(
            query.conversationId
              ? eq(schema.traceEvents.conversationId, query.conversationId)
              : undefined,
            query.subAccountId
              ? eq(schema.traceEvents.subAccountId, query.subAccountId)
              : undefined,
            query.source === "all" ? undefined : eq(schema.traceEvents.source, query.source),
          ),
        )
        .groupBy(schema.traceEvents.turnId, schema.traceEvents.conversationId)
        .orderBy(desc(sql`min(${schema.traceEvents.ts})`))
        .limit(100);
      res.json(rows);
    }),
  );

  /** Every event of one turn, in order. This is the waterfall. */
  router.get(
    "/api/admin/turns/:turnId",
    asyncHandler(async (req, res) => {
      const turnId = z.string().uuid().safeParse(req.params["turnId"]);
      if (!turnId.success) {
        res.status(400).json({ error: "turnId must be a uuid" });
        return;
      }
      const rows = await db
        .select()
        .from(schema.traceEvents)
        .where(eq(schema.traceEvents.turnId, turnId.data))
        .orderBy(schema.traceEvents.seq);
      res.json(rows);
    }),
  );

  /**
   * Which providers are usable, and which one is currently first.
   *
   * A provider with no key is filtered out of the chain at call time, so "configured" is a real
   * property of the process rather than a claim in a file — showing it here is the difference
   * between an operator knowing why Gemini never runs and guessing.
   */
  router.get(
    "/api/admin/model",
    asyncHandler((_req, res) => {
      res.json({
        chain: ctx.settings.model.chain.map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          temperature: entry.temperature,
          maxOutputTokens: entry.maxOutputTokens,
          timeoutMs: entry.timeoutMs,
          configured: ctx.providers.has(entry.provider),
        })),
        gate: ctx.settings.model.gate,
        judge: ctx.settings.model.judge,
        envOverride: ctx.env.MODEL_PROVIDER ?? null,
      });
      return Promise.resolve();
    }),
  );

  /**
   * Promote a provider to the head of the chain, for this process.
   *
   * Deliberately not a settings-file write: the file is the declared configuration and an operator
   * editing it through a browser is how a demo becomes the committed state by accident. This is the
   * switch you flip to show a failover or to route around a vendor having a bad morning, and a
   * restart puts it back to whatever the file says.
   */
  router.post(
    "/api/admin/model",
    asyncHandler((req, res) => {
      const body = z
        .object({ provider: z.enum(["anthropic", "openai", "google"]) })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "Expected { provider }" });
        return Promise.resolve();
      }
      if (!ctx.providers.has(body.data.provider)) {
        res.status(409).json({ error: `${body.data.provider} has no API key configured` });
        return Promise.resolve();
      }
      ctx.promoteProvider(body.data.provider);
      res.json({ ok: true, primary: ctx.settings.model.chain[0] });
      return Promise.resolve();
    }),
  );

  /** Our own tenancy, so the console can name a customer without knowing a GHL location id. */
  router.get(
    "/api/admin/sub-accounts",
    asyncHandler(async (_req, res) => {
      const rows = await db.select().from(schema.subAccounts).orderBy(schema.subAccounts.name);
      res.json(rows);
    }),
  );

  /**
   * The graded numbers, read from the files `pnpm gate` writes.
   *
   * Served rather than hard-coded so the console can never claim a pass the suite did not produce,
   * and each behaviour case carries its `turnId` — which is what lets a failure open as a trace.
   */
  router.get(
    "/api/admin/evals",
    asyncHandler(async (req, res) => {
      const dir = fromRepoRoot("evals/.results");
      const read = async (name: string): Promise<unknown> => {
        try {
          return JSON.parse(await readFile(join(dir, name), "utf8"));
        } catch {
          return null;
        }
      };
      const files = await readdir(dir).catch(() => [] as string[]);
      const providers = files
        .filter((name) => name.startsWith("behaviour-"))
        .map((name) => name.slice("behaviour-".length, -".json".length))
        .sort();
      // Sorted, never readdir order, and both halves come from one provider: pairing a vendor's
      // behaviour with another's gate reports a run that never happened.
      const asked = z.string().min(1).optional().parse(req.query.provider);
      const provider = asked && providers.includes(asked) ? asked : providers[0];

      res.json({
        behaviour: provider ? await read(`behaviour-${provider}.json`) : null,
        // `gate.json` is what a single-provider run writes; --all-providers writes one per vendor.
        gate: provider
          ? ((await read(`gate-${provider}.json`)) ?? (await read("gate.json")))
          : null,
        provider: provider ?? null,
        providers,
      });
    }),
  );

  /** Questions the documents could not answer — the operator's to-do list. */
  router.get(
    "/api/admin/gaps",
    asyncHandler(async (req, res) => {
      // Optional, because a gap belongs to one business: an agency looking at one client must not
      // be shown what a different practice's patients could not get answered.
      const locationId = z.string().min(1).optional().parse(req.query.locationId);
      const rows = await db
        .select()
        .from(schema.knowledgeGaps)
        .where(locationId ? eq(schema.knowledgeGaps.locationId, locationId) : undefined)
        .orderBy(desc(schema.knowledgeGaps.createdAt))
        .limit(100);
      res.json(rows);
    }),
  );

  router.get(
    "/api/admin/settings",
    asyncHandler((_req, res) => {
      // Returned so the console can show what the agent is actually running under. No secrets
      // live in settings; those are environment variables and never leave the process.
      res.json(ctx.settings);
      return Promise.resolve();
    }),
  );

  return router;
}
