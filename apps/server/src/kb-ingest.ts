import { loadEnv, loadSettings } from "@harness/config";
import { chunkMarkdown, Embedder, type Chunk } from "@harness/core";
import { createDatabase } from "@harness/db";
import { config } from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fromRepoRoot } from "./paths.js";
import { PgKnowledgeStore } from "./store/knowledge-store.js";

/* eslint-disable no-console -- an ingest command's output is its interface */

/**
 * Reads the knowledge base, chunks it, embeds it, and replaces what is indexed.
 *
 *   pnpm kb:ingest
 *
 * Safe to re-run: the corpus for the location is replaced wholesale, so a deleted document stops
 * being answerable rather than lingering as chunks nobody can trace back to a file.
 */

config({ path: fromRepoRoot(".env") });
const env = loadEnv();
const settings = await loadSettings(fromRepoRoot(env.SETTINGS_PATH));

if (!env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to embed the knowledge base");
}

const { db, pool } = createDatabase(env.DATABASE_URL);
const store = new PgKnowledgeStore(
  db,
  new Embedder({ ...settings.model.embedding, apiKey: env.OPENAI_API_KEY }),
);
const embedder = new Embedder({ ...settings.model.embedding, apiKey: env.OPENAI_API_KEY });

const docsDir = fromRepoRoot(settings.knowledge.docsDir);
const chunks: Chunk[] = [];

// Recursive readdir rather than a glob: node:fs/promises only gained glob in 22, and supporting
// half of a glob syntax is worse than saying plainly that this is a directory of markdown.
const entries = await readdir(docsDir, { recursive: true, withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => join(entry.parentPath, entry.name));

for (const file of files) {
  const source = file.slice(docsDir.length + 1);
  const markdown = await readFile(file, "utf8");
  const fileChunks = chunkMarkdown(source, markdown, {
    maxChars: settings.knowledge.chunkTokens * 4,
    overlapChars: settings.knowledge.chunkOverlapTokens * 4,
  });
  console.log(`${source.padEnd(34)} ${String(fileChunks.length).padStart(3)} chunks`);
  chunks.push(...fileChunks);
}

if (chunks.length === 0) {
  throw new Error(`No markdown found under ${settings.knowledge.docsDir}`);
}

console.log(`\nembedding ${chunks.length} chunks...`);
const embeddings = await embedder.many(chunks.map((chunk) => chunk.text));

await store.replaceAll(
  settings.locationId,
  chunks.map((chunk, index) => {
    const embedding = embeddings[index];
    if (!embedding) throw new Error(`No embedding came back for chunk ${index}`);
    return { ...chunk, embedding };
  }),
);

console.log(`indexed ${chunks.length} chunks for ${settings.locationId}`);
await pool.end();
