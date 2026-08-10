import { settingsSchema, type Settings } from "@harness/config";
import { retrieve, Tracer, type KnowledgeStore, type RetrievedChunk } from "@harness/core";
import { describe, expect, it } from "vitest";

/**
 * A corpus stood up in memory rather than in Postgres.
 *
 * Scores are supplied by the fixture, so these tests assert on what the harness does with them —
 * the floor, the ordering, what it reports — rather than on whether an embedding model happens to
 * rank two paragraphs the way someone expected today. That second question is real, and it is
 * measured against the live index by `pnpm eval:gate`'s sibling rather than pinned here where a
 * model update would turn it red for no defect.
 */
function storeReturning(chunks: RetrievedChunk[]): KnowledgeStore {
  return {
    search: ({ topK }) =>
      Promise.resolve([...chunks].sort((a, b) => b.score - a.score).slice(0, topK)),
  };
}

const settings: Settings = settingsSchema.parse({
  businessName: "Northwind Dental",
  locationId: "loc_test",
  model: {
    chain: [{ provider: "anthropic", model: "m" }],
    gate: { provider: "anthropic", model: "g", timeoutMs: 2500 },
    judge: { provider: "openai", model: "j" },
  },
  knowledge: { relevanceFloor: 0.35, topK: 4 },
});

const tracerFor = () => new Tracer({ turnId: "t", conversationId: "c", sinks: [] });

const chunk = (id: string, score: number, source = `${id}.md`): RetrievedChunk => ({
  id,
  source,
  heading: null,
  text: `content of ${id}`,
  score,
});

describe("retrieval", () => {
  it("keeps only what clears the relevance floor", async () => {
    const tracer = tracerFor();

    const result = await retrieve(
      { locationId: "loc_test", queries: ["opening hours"] },
      storeReturning([chunk("hours", 0.71), chunk("fees", 0.34), chunk("parking", 0.12)]),
      settings,
      tracer,
    );

    expect(result.chunks.map((c) => c.id)).toEqual(["hours"]);
    expect(result.belowFloor).toBe(false);
  });

  it("reports below-floor when nothing is close enough", async () => {
    // The case the floor exists for. Vector search always returns its nearest neighbours however
    // far away they are, so without a threshold the agent gets the four least-irrelevant
    // paragraphs in the corpus and writes a confident answer out of them.
    const tracer = tracerFor();

    const result = await retrieve(
      { locationId: "loc_test", queries: ["do you deal with Bupa claims"] },
      storeReturning([chunk("fees", 0.22), chunk("policies", 0.19)]),
      settings,
      tracer,
    );

    expect(result.chunks).toHaveLength(0);
    expect(result.belowFloor).toBe(true);
  });

  it("records every candidate it saw, including the rejected ones", async () => {
    // "It retrieved nothing" and "it retrieved four things that all scored 0.2" are different
    // problems with different fixes, and a trace that only kept the survivors cannot tell them
    // apart.
    const tracer = tracerFor();

    await retrieve(
      { locationId: "loc_test", queries: ["refund policy"] },
      storeReturning([chunk("fees", 0.28), chunk("policies", 0.26)]),
      settings,
      tracer,
    );

    const event = tracer.events.find((e) => e.type === "rag_retrieve");
    expect(event).toMatchObject({ belowFloor: true });
    expect(event?.type === "rag_retrieve" && event.chunks).toHaveLength(2);
  });

  it("returns the closest first, capped at topK", async () => {
    const tracer = tracerFor();

    const result = await retrieve(
      { locationId: "loc_test", queries: ["fees"] },
      storeReturning([
        chunk("a", 0.5),
        chunk("b", 0.9),
        chunk("c", 0.7),
        chunk("d", 0.6),
        chunk("e", 0.55),
      ]),
      settings,
      tracer,
    );

    expect(result.chunks.map((c) => c.id)).toEqual(["b", "c", "d", "e"]);
  });

  it("records the rewritten query, not the customer's phrasing", async () => {
    // The gate rewrites "do you guys do refunds tho" into "refund policy"; the trace has to show
    // what was actually searched or the scores cannot be explained.
    const tracer = tracerFor();

    await retrieve(
      { locationId: "loc_test", queries: ["refund policy"] },
      storeReturning([chunk("policies", 0.6)]),
      settings,
      tracer,
    );

    expect(tracer.events[0]).toMatchObject({ type: "rag_retrieve", query: "refund policy" });
  });

  /**
   * The bug this exists to stop coming back.
   *
   * A live turn asked "what time do you close on friday and how much is a check-up?". The gate
   * rewrote it to one query about hours, fees.md was never a candidate, and the agent declined a
   * price it holds. It read as a knowledge gap and was a retrieval bug — the worst kind, because
   * the honest-refusal behaviour makes it look like correct caution.
   */
  it("searches every question in a multi-intent turn", async () => {
    const tracer = tracerFor();
    const byQuery: Record<string, RetrievedChunk[]> = {
      "Friday opening hours": [chunk("hours", 0.52, "opening-hours.md")],
      "check-up cost": [chunk("fees", 0.61, "fees.md")],
    };
    const store: KnowledgeStore = {
      search: ({ query }) => Promise.resolve(byQuery[query] ?? []),
    };

    const result = await retrieve(
      { locationId: "loc_test", queries: ["Friday opening hours", "check-up cost"] },
      store,
      settings,
      tracer,
    );

    expect(result.chunks.map((entry) => entry.source).sort()).toEqual([
      "fees.md",
      "opening-hours.md",
    ]);
    expect(result.belowFloor).toBe(false);
  });

  it("does not repeat a passage both questions matched", async () => {
    const tracer = tracerFor();
    const store: KnowledgeStore = {
      // The same chunk, scored differently by each search.
      search: ({ query }) =>
        Promise.resolve([chunk("fees", query === "check-up cost" ? 0.61 : 0.44, "fees.md")]),
    };

    const result = await retrieve(
      { locationId: "loc_test", queries: ["check-up cost", "price list"] },
      store,
      settings,
      tracer,
    );

    expect(result.chunks).toHaveLength(1);
    // Best score wins, so the prompt does not carry a weaker duplicate.
    expect(result.chunks[0]?.score).toBe(0.61);
  });
});
