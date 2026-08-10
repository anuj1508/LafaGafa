import { Tracer, type TraceEvent, type TraceSink } from "@harness/core";
import { describe, expect, it } from "vitest";

class RecordingSink implements TraceSink {
  readonly batches: TraceEvent[][] = [];
  write(events: TraceEvent[]): Promise<void> {
    this.batches.push(events);
    return Promise.resolve();
  }
}

describe("Tracer", () => {
  it("orders events by emission, not by timestamp", () => {
    // A frozen clock is the pathological case: every event shares a `ts`, so only `seq` can
    // recover the order a reviewer needs to answer "what did it do first?".
    const frozen = new Date("2026-01-01T00:00:00.000Z");
    const tracer = new Tracer({
      turnId: "turn-1",
      conversationId: "conv-1",
      sinks: [],
      now: () => frozen,
    });

    tracer.emit({ type: "turn_start", input: "hi", messageIds: ["m1"] });
    tracer.emit({
      type: "gate",
      decision: "skip",
      decidedBy: "heuristic",
      reason: "greeting",
      latencyMs: 0,
    });
    tracer.emit({
      type: "turn_end",
      iterations: 1,
      reply: "hello",
      stopReason: "completed",
      totalLatencyMs: 120,
    });

    expect(tracer.events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(tracer.events.map((event) => event.type)).toEqual(["turn_start", "gate", "turn_end"]);
    expect(new Set(tracer.events.map((event) => event.ts)).size).toBe(1);
  });

  it("stamps every event with the turn and conversation it belongs to", async () => {
    const sink = new RecordingSink();
    const tracer = new Tracer({ turnId: "turn-2", conversationId: "conv-2", sinks: [sink] });

    tracer.emit({ type: "turn_start", input: "book me tomorrow", messageIds: ["m2"] });
    await tracer.flush();

    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]?.[0]).toMatchObject({ turnId: "turn-2", conversationId: "conv-2" });
  });
});
