import type { TraceEvent, TraceSink } from "@harness/core";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logger.js";

/**
 * A day-per-file JSONL mirror of the trace.
 *
 * Redundant with Postgres by design: when the database is the thing misbehaving, or when someone
 * wants to grep a turn without a client, a flat file is the tool that still works.
 */
export class JsonlTraceSink implements TraceSink {
  constructor(
    private readonly directory: string,
    private readonly logger: Logger,
  ) {}

  async write(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) return;

    const day = new Date().toISOString().slice(0, 10);
    const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";

    try {
      await mkdir(this.directory, { recursive: true });
      await appendFile(join(this.directory, `${day}.jsonl`), lines, "utf8");
    } catch (error) {
      this.logger.error("trace file write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
