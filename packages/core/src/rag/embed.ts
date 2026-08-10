import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderName } from "@harness/config";
import { embed, embedMany } from "ai";

export interface EmbedderOptions {
  provider: ProviderName;
  model: string;
  apiKey: string;
}

/**
 * Turns text into vectors.
 *
 * Only OpenAI for now, and deliberately narrow rather than pretending otherwise: the column is
 * fixed at 1536 dimensions, so swapping embedding provider is a migration and a full re-ingest,
 * not a config change. Presenting it as pluggable would be a lie the schema cannot keep.
 */
export class Embedder {
  readonly #model: ReturnType<ReturnType<typeof createOpenAI>["embeddingModel"]>;

  constructor(options: EmbedderOptions) {
    if (options.provider !== "openai") {
      throw new Error(
        `Embeddings are only wired for openai; "${options.provider}" would need a schema change for its dimensions.`,
      );
    }
    this.#model = createOpenAI({ apiKey: options.apiKey }).embeddingModel(options.model);
  }

  async one(text: string): Promise<number[]> {
    const { embedding } = await embed({ model: this.#model, value: text });
    return embedding;
  }

  /** Batched because ingesting a corpus one request at a time is slow and rate-limited. */
  async many(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({ model: this.#model, values: texts });
    return embeddings;
  }
}
