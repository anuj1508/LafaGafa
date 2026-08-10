import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.js";
import { InProcessTurnQueue, toTurnRequest } from "./in-process-queue.js";
import type { QueuedMessage, TurnRequest } from "./types.js";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let seq = 0;
function message(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  seq += 1;
  return {
    locationId: "loc_1",
    contactId: "con_1",
    conversationId: "conv_1",
    messageId: `msg_${seq}`,
    channel: "SMS",
    body: `body ${seq}`,
    dateAdded: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    receivedAt: 1_700_000_000_000 + seq * 1000,
    ...overrides,
  };
}

describe("InProcessTurnQueue", () => {
  beforeEach(() => {
    seq = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses a burst into exactly one turn", async () => {
    const turns: TurnRequest[] = [];
    const queue = new InProcessTurnQueue({
      debounceMs: 4000,
      logger: silentLogger,
      handler: (request) => {
        turns.push(request);
        return Promise.resolve();
      },
    });

    queue.submit(message({ body: "hi" }));
    vi.advanceTimersByTime(500);
    queue.submit(message({ body: "can I book" }));
    vi.advanceTimersByTime(500);
    queue.submit(message({ body: "tomorrow?" }));

    // Still inside the window after the last message: nothing has fired yet.
    vi.advanceTimersByTime(3999);
    expect(turns).toHaveLength(0);

    vi.advanceTimersByTime(1);
    await queue.drain();

    expect(turns).toHaveLength(1);
    expect(turns[0]?.body).toBe("hi\ncan I book\ntomorrow?");
    expect(turns[0]?.messageIds).toEqual(["msg_1", "msg_2", "msg_3"]);
  });

  it("resets the window on each message rather than batching on a fixed interval", async () => {
    const turns: TurnRequest[] = [];
    const queue = new InProcessTurnQueue({
      debounceMs: 1000,
      logger: silentLogger,
      handler: (request) => {
        turns.push(request);
        return Promise.resolve();
      },
    });

    // Each message lands 900ms after the last, so a fixed interval would have fired twice by now.
    queue.submit(message());
    vi.advanceTimersByTime(900);
    queue.submit(message());
    vi.advanceTimersByTime(900);
    queue.submit(message());
    expect(turns).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    await queue.drain();
    expect(turns).toHaveLength(1);
  });

  it("runs one turn at a time per conversation", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstTurnBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const queue = new InProcessTurnQueue({
      debounceMs: 100,
      logger: silentLogger,
      handler: async (request) => {
        order.push(`start:${request.messageIds.join(",")}`);
        if (request.messageIds.includes("msg_1")) await firstTurnBlocked;
        order.push(`end:${request.messageIds.join(",")}`);
      },
    });

    queue.submit(message());
    await vi.advanceTimersByTimeAsync(100);

    queue.submit(message());
    await vi.advanceTimersByTimeAsync(100);

    // The second batch has flushed, but the first turn has not returned.
    expect(order).toEqual(["start:msg_1"]);

    if (!releaseFirst) throw new Error("first turn never started");
    releaseFirst();
    await queue.drain();

    expect(order).toEqual(["start:msg_1", "end:msg_1", "start:msg_2", "end:msg_2"]);
  });

  it("does not serialize across different conversations", async () => {
    const started: string[] = [];
    const queue = new InProcessTurnQueue({
      debounceMs: 100,
      logger: silentLogger,
      handler: async (request) => {
        started.push(request.conversationId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      },
    });

    queue.submit(message({ conversationId: "conv_a" }));
    queue.submit(message({ conversationId: "conv_b" }));
    await vi.advanceTimersByTimeAsync(100);

    expect(started.sort()).toEqual(["conv_a", "conv_b"]);
    await vi.advanceTimersByTimeAsync(1000);
    await queue.drain();
  });

  it("keeps serving other conversations after a turn throws", async () => {
    const succeeded: string[] = [];
    const queue = new InProcessTurnQueue({
      debounceMs: 100,
      logger: silentLogger,
      handler: (request) => {
        if (request.conversationId === "conv_bad") {
          return Promise.reject(new Error("provider exploded"));
        }
        succeeded.push(request.conversationId);
        return Promise.resolve();
      },
    });

    queue.submit(message({ conversationId: "conv_bad" }));
    queue.submit(message({ conversationId: "conv_good" }));
    await vi.advanceTimersByTimeAsync(100);
    await queue.drain();

    expect(succeeded).toEqual(["conv_good"]);
  });
});

describe("toTurnRequest", () => {
  it("orders by dateAdded, not by arrival", () => {
    // The reply arriving before the question it answers is the case that changes meaning.
    const later = message({ body: "yes please", dateAdded: "2026-01-01T00:00:02.000Z" });
    const earlier = message({
      body: "shall I book you in?",
      dateAdded: "2026-01-01T00:00:01.000Z",
    });

    expect(toTurnRequest([later, earlier]).body).toBe("shall I book you in?\nyes please");
  });

  it("starts the latency clock at the earliest message in the batch", () => {
    const first = message({ receivedAt: 1000 });
    const second = message({ receivedAt: 5000 });

    expect(toTurnRequest([second, first]).receivedAt).toBe(1000);
  });

  it("drops empty bodies so an attachment-only message adds no blank line", () => {
    const withBody = message({ body: "here you go", dateAdded: "2026-01-01T00:00:01.000Z" });
    const attachmentOnly = message({ body: "   ", dateAdded: "2026-01-01T00:00:02.000Z" });

    expect(toTurnRequest([withBody, attachmentOnly]).body).toBe("here you go");
  });
});
