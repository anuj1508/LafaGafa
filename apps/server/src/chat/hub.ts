import { randomUUID } from "node:crypto";
import type { Response } from "express";

interface ChatSession {
  sessionId: string;
  contactId: string;
  conversationId: string;
}

/** What the browser receives on the stream. */
type ChatEvent =
  { event: "reply"; text: string } | { event: "status"; stage: string; detail?: string };

/**
 * Sessions and their open event streams for the chat surface.
 *
 * Replies are pushed by `contactId` rather than by session, because the reply arrives from the
 * worker, which knows the conversation it answered and not which browser tab asked. In memory for
 * the same reason the queue is: one process, and a dropped stream costs a page refresh.
 */
export class ChatHub {
  readonly #sessions = new Map<string, ChatSession>();
  readonly #streams = new Map<string, Set<Response>>();

  create(contactId: string, conversationId: string): ChatSession {
    const session: ChatSession = { sessionId: randomUUID(), contactId, conversationId };
    this.#sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): ChatSession | undefined {
    return this.#sessions.get(sessionId);
  }

  /** Attaches an SSE response to a contact's stream and returns the detach function. */
  subscribe(contactId: string, res: Response): () => void {
    let streams = this.#streams.get(contactId);
    if (!streams) {
      streams = new Set();
      this.#streams.set(contactId, streams);
    }
    streams.add(res);

    return () => {
      streams.delete(res);
      if (streams.size === 0) this.#streams.delete(contactId);
    };
  }

  publish(contactId: string, event: ChatEvent): void {
    const streams = this.#streams.get(contactId);
    if (!streams) return;
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of streams) res.write(frame);
  }
}
