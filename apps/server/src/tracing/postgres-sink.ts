import type { TraceEvent, TraceSink } from "@harness/core";
import { schema, type Database } from "@harness/db";
import type { Logger } from "../logger.js";

/**
 * Writes a turn's events to Postgres in one statement: discriminant and latency as columns, the
 * rest JSON. Failures are swallowed — a missing trace beats a reply that never went out.
 */
export class PostgresTraceSink implements TraceSink {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async write(events: TraceEvent[]): Promise<void> {
    if (events.length === 0) return;

    try {
      await this.db.insert(schema.traceEvents).values(
        events.map((event) => ({
          turnId: event.turnId,
          conversationId: event.conversationId,
          subAccountId: event.subAccountId ?? null,
          agentId: event.agentId ?? null,
          source: event.source,
          seq: event.seq,
          type: event.type,
          ts: new Date(event.ts),
          latencyMs: "latencyMs" in event ? event.latencyMs : null,
          payload: event,
        })),
      );
    } catch (error) {
      this.logger.error("trace write failed", {
        turnId: events[0]?.turnId,
        events: events.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
