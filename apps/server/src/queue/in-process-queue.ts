import type { Logger } from "../logger.js";
import type { QueuedMessage, TurnHandler, TurnQueue, TurnRequest } from "./types.js";

interface InProcessTurnQueueOptions {
  /** Quiet period after the last message before a batch becomes a turn. */
  debounceMs: number;
  handler: TurnHandler;
  logger: Logger;
}

interface PendingBatch {
  messages: QueuedMessage[];
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One reply per burst, and one turn at a time per conversation. In memory, so a restart drops
 * pending batches — acceptable for a single instance. See docs/architecture.md#queue.
 */
export class InProcessTurnQueue implements TurnQueue {
  readonly #pending = new Map<string, PendingBatch>();
  readonly #running = new Map<string, Promise<void>>();
  readonly #opts: InProcessTurnQueueOptions;
  #closed = false;

  constructor(options: InProcessTurnQueueOptions) {
    this.#opts = options;
  }

  submit(message: QueuedMessage): void {
    if (this.#closed) {
      this.#opts.logger.warn("queue closed, dropping message", { messageId: message.messageId });
      return;
    }

    const existing = this.#pending.get(message.conversationId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(message);
      existing.timer = this.#scheduleFlush(message.conversationId);
      return;
    }

    this.#pending.set(message.conversationId, {
      messages: [message],
      timer: this.#scheduleFlush(message.conversationId),
    });
  }

  async drain(): Promise<void> {
    // Turns can enqueue nothing themselves, but a batch flushed while we were awaiting an earlier
    // one still needs collecting, so this loops until the map is genuinely empty.
    while (this.#running.size > 0) {
      await Promise.allSettled([...this.#running.values()]);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const [conversationId, batch] of this.#pending) {
      clearTimeout(batch.timer);
      this.#opts.logger.warn("queue closed with a batch still open", {
        conversationId,
        messages: batch.messages.length,
      });
    }
    this.#pending.clear();
    await this.drain();
  }

  #scheduleFlush(conversationId: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.#flush(conversationId);
    }, this.#opts.debounceMs);
    // A pending debounce window must not hold the process open during shutdown.
    timer.unref();
    return timer;
  }

  #flush(conversationId: string): void {
    const batch = this.#pending.get(conversationId);
    if (!batch) return;
    this.#pending.delete(conversationId);

    const request = toTurnRequest(batch.messages);
    const previous = this.#running.get(conversationId) ?? Promise.resolve();

    const next = previous
      .then(() => this.#opts.handler(request))
      .catch((error: unknown) => {
        // A failed turn must not take the queue down with it, or one bad conversation silences
        // the agent for every other customer.
        this.#opts.logger.error("turn failed", {
          conversationId,
          messageIds: request.messageIds,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (this.#running.get(conversationId) === next) this.#running.delete(conversationId);
      });

    this.#running.set(conversationId, next);
  }
}

/**
 * Collapses a batch into one turn. Messages are ordered by `dateAdded` rather than by arrival:
 * GHL does not guarantee delivery order, and "yes" arriving before the question it answers
 * changes the meaning of the turn.
 */
export function toTurnRequest(messages: QueuedMessage[]): TurnRequest {
  const ordered = [...messages].sort((a, b) => a.dateAdded.localeCompare(b.dateAdded));
  const first = ordered[0];
  if (!first) throw new Error("Cannot build a turn request from an empty batch");

  return {
    locationId: first.locationId,
    contactId: first.contactId,
    conversationId: first.conversationId,
    channel: first.channel,
    messageIds: ordered.map((message) => message.messageId),
    body: ordered
      .map((message) => message.body.trim())
      .filter((body) => body.length > 0)
      .join("\n"),
    receivedAt: Math.min(...ordered.map((message) => message.receivedAt)),
  };
}
