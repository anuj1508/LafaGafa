import { readFile } from "node:fs/promises";
import { fromRepoRoot } from "./paths.js";
import type { Logger } from "./logger.js";

/**
 * Reads the enabled skills' procedural docs once at boot.
 *
 * Cached rather than read per turn: these change with a deploy, not with a conversation, and a
 * file read on the critical path buys nothing. A missing doc is a warning rather than a failure —
 * the skill still works, it just has less guidance.
 */
/**
 * The agent's character.
 *
 * Read at boot and failed loudly if missing: an agent with no SOUL.md has no voice, no rules
 * about narrating its own bookkeeping, and no instruction to act before replying. Starting
 * anyway would put a stranger in front of customers.
 */
export async function loadSoul(path: string): Promise<string> {
  try {
    return await readFile(fromRepoRoot(path), "utf8");
  } catch (cause) {
    throw new Error(`Cannot read ${path}. The agent has no character without it.`, { cause });
  }
}

export async function loadProceduralDocs(
  paths: Array<string | undefined>,
  logger: Logger,
): Promise<string[]> {
  const docs = await Promise.all(
    paths
      .filter((path): path is string => path !== undefined)
      .map(async (path) => {
        try {
          return await readFile(fromRepoRoot(path), "utf8");
        } catch {
          logger.warn("procedural doc missing", { path });
          return undefined;
        }
      }),
  );
  return docs.filter((doc): doc is string => doc !== undefined);
}
