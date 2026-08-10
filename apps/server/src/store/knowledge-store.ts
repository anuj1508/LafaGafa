import type { Embedder, KnowledgeStore, RetrievedChunk } from "@harness/core";
import { schema, type Database } from "@harness/db";
import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";

/**
 * The knowledge base, in Postgres with pgvector.
 *
 * One database for state, traces and vectors. A dedicated vector store would be a second thing to
 * operate and back up for a corpus of a few hundred chunks, and cross-store joins are how "which
 * passage grounded this answer" becomes hard to reconstruct.
 */
export class PgKnowledgeStore implements KnowledgeStore {
  constructor(
    private readonly db: Database,
    private readonly embedder: Embedder,
  ) {}

  async search(input: {
    locationId: string;
    query: string;
    topK: number;
  }): Promise<RetrievedChunk[]> {
    const embedding = await this.embedder.one(input.query);
    // Cosine *distance* is what the index computes; similarity is what a reader expects, and the
    // relevance floor is expressed as one. Converting here keeps that arithmetic in one place.
    const similarity = sql<number>`1 - (${cosineDistance(schema.kbChunks.embedding, embedding)})`;

    const rows = await this.db
      .select({
        id: schema.kbChunks.id,
        source: schema.kbChunks.source,
        heading: schema.kbChunks.heading,
        text: schema.kbChunks.content,
        score: similarity,
      })
      .from(schema.kbChunks)
      .where(and(eq(schema.kbChunks.locationId, input.locationId), gt(similarity, 0)))
      .orderBy(desc(similarity))
      .limit(input.topK);

    return rows;
  }

  /**
   * Records a question the documents could not answer.
   *
   * The operator's to-do list, built from real conversations rather than from guesses about what
   * customers might ask. Each row is a question someone actually asked and did not get answered.
   */
  async recordGap(input: {
    locationId: string;
    question: string;
    bestScore: number | null;
    turnId: string;
  }): Promise<void> {
    await this.db.insert(schema.knowledgeGaps).values(input);
  }

  /**
   * Replaces the corpus for a location.
   *
   * Wholesale rather than incremental: documents get edited and deleted, and reconciling that
   * leaves orphaned chunks answering questions from text nobody can find any more.
   */
  async replaceAll(
    locationId: string,
    chunks: Array<{ source: string; heading: string | null; text: string; embedding: number[] }>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.kbChunks).where(eq(schema.kbChunks.locationId, locationId));
      if (chunks.length === 0) return;

      await tx.insert(schema.kbChunks).values(
        chunks.map((chunk) => ({
          locationId,
          source: chunk.source,
          heading: chunk.heading,
          content: chunk.text,
          embedding: chunk.embedding,
        })),
      );
    });
  }
}
