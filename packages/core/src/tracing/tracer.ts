import type { TraceEvent, TraceEventInput } from "./events.js";

/** Where trace events end up. Fire-and-forget: a slow sink must never delay a reply. */
export interface TraceSink {
  write(events: TraceEvent[]): Promise<void>;
}

export interface TracerOptions {
  turnId: string;
  conversationId: string;
  /** Our own id, never the CRM's. See architecture.md#tenancy. */
  subAccountId?: string;
  agentId?: string;
  /** `eval` turns share the viewer with live ones but must never be counted as production. */
  source?: "live" | "eval";
  sinks: TraceSink[];
  /** Injected so tests can produce deterministic traces. */
  now?: () => Date;
}

/**
 * Collects one turn's events in order and flushes them to every sink.
 * `seq` is assigned here, not derived from timestamps. See architecture.md#trace-order.
 */
export class Tracer {
  readonly #events: TraceEvent[] = [];
  readonly #opts: TracerOptions;
  readonly #now: () => Date;
  #seq = 0;

  constructor(options: TracerOptions) {
    this.#opts = options;
    this.#now = options.now ?? (() => new Date());
  }

  emit(event: TraceEventInput): void {
    this.#events.push({
      ...event,
      turnId: this.#opts.turnId,
      conversationId: this.#opts.conversationId,
      ...(this.#opts.subAccountId ? { subAccountId: this.#opts.subAccountId } : {}),
      ...(this.#opts.agentId ? { agentId: this.#opts.agentId } : {}),
      source: this.#opts.source ?? "live",
      seq: this.#seq++,
      ts: this.#now().toISOString(),
    });
  }

  /** The events recorded so far, in order. Assertions in the eval suite read this. */
  get events(): readonly TraceEvent[] {
    return this.#events;
  }

  async flush(): Promise<void> {
    const batch = [...this.#events];
    await Promise.all(this.#opts.sinks.map((sink) => sink.write(batch)));
  }
}
