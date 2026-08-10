import type { MessageChannel } from "@harness/config";

/** One inbound customer message, already validated and de-duplicated. */
export interface QueuedMessage {
  locationId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  channel: MessageChannel;
  body: string;
  /** GHL's timestamp, used for ordering — webhook delivery order is not reliable. */
  dateAdded: string;
  /** When we received the webhook. The latency SLO is measured from the earliest of these. */
  receivedAt: number;
}

/** A debounced batch of messages, ready to become exactly one agent turn. */
export interface TurnRequest {
  locationId: string;
  contactId: string;
  conversationId: string;
  channel: MessageChannel;
  /** Every message in the batch, oldest first. */
  messageIds: string[];
  /** The batch as the agent sees it: one string, messages in `dateAdded` order. */
  body: string;
  /** Receipt time of the batch's earliest message — the start of the webhook-to-send clock. */
  receivedAt: number;
}

export type TurnHandler = (request: TurnRequest) => Promise<void>;

/**
 * Collapses bursts into turns and runs one turn at a time per conversation.
 *
 * An interface rather than a class so the in-process implementation can be swapped for a durable
 * queue without the webhook route or the worker changing.
 */
export interface TurnQueue {
  submit(message: QueuedMessage): void;
  /** Resolves once every flushed batch has finished running. Tests and shutdown both need it. */
  drain(): Promise<void>;
  close(): Promise<void>;
}
