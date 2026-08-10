import type { Settings } from "@harness/config";
import type { Tracer } from "../tracing/tracer.js";

export interface RetrievedChunk {
  id: string;
  source: string;
  heading: string | null;
  text: string;
  /** Cosine similarity, 0 to 1. Higher is closer. */
  score: number;
}

/**
 * Where the knowledge base lives.
 *
 * A port because the harness must not know it is Postgres. It also lets the eval suite hand the
 * loop a fixed corpus and assert on grounding without standing up a database or paying for
 * embeddings on every run.
 */
export interface KnowledgeStore {
  search(input: { locationId: string; query: string; topK: number }): Promise<RetrievedChunk[]>;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  /** True when nothing cleared the floor, which is the agent's cue to decline rather than stretch. */
  belowFloor: boolean;
}

/**
 * Fetches the passages that might answer a question, and says plainly when none do.
 * The floor is the point: without it the agent gets the four least-irrelevant paragraphs.
 */
export async function retrieve(
  input: { locationId: string; queries: string[] },
  store: KnowledgeStore,
  settings: Settings,
  tracer: Tracer,
): Promise<RetrievalResult> {
  const startedAt = Date.now();

  // One search per question: a single embedding across two topics matches neither. See #multi-query.
  const queries = input.queries.length > 0 ? input.queries : [""];
  const results = await Promise.all(
    queries.map((query) =>
      store.search({ locationId: input.locationId, query, topK: settings.knowledge.topK }),
    ),
  );

  // Best score wins, so a chunk relevant to both questions is not sent twice.
  const byId = new Map<string, (typeof results)[number][number]>();
  for (const chunk of results.flat()) {
    const seen = byId.get(chunk.id);
    if (!seen || chunk.score > seen.score) byId.set(chunk.id, chunk);
  }
  const found = [...byId.values()].sort((a, b) => b.score - a.score);

  const chunks = found.filter((chunk) => chunk.score >= settings.knowledge.relevanceFloor);
  const belowFloor = chunks.length === 0;

  tracer.emit({
    type: "rag_retrieve",
    query: input.queries.join(" | "),
    // Every candidate is recorded, including the rejected ones: "it retrieved nothing" and "it
    // retrieved four things that all scored 0.2" are different problems with different fixes.
    chunks: found.map((chunk) => ({ id: chunk.id, source: chunk.source, score: chunk.score })),
    belowFloor,
    latencyMs: Date.now() - startedAt,
  });

  return { chunks, belowFloor };
}

/**
 * The passages as the model sees them.
 *
 * Labelled with their source so the reply can cite where something came from, and delimited so
 * the boundary between "what the business wrote" and "what you are being asked" is unambiguous.
 */
export function formatContext(chunks: RetrievedChunk[]): string {
  return [
    "From the business's own documents. Answer only from these, and say where an answer came from:",
    ...chunks.map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.source}${chunk.heading ? ` — ${chunk.heading}` : ""}\n${chunk.text}`,
    ),
  ].join("\n\n");
}
