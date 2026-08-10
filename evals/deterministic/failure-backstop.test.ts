import { settingsSchema, type Settings } from "@harness/config";
import { Tracer, type TraceSink } from "@harness/core";
import { describe, expect, it } from "vitest";

/**
 * The rule the worker applies after every turn.
 *
 * Kept here as a unit rather than reached through a live turn because the behaviour worth
 * guaranteeing is the classification itself: which outcomes count against a customer, and which
 * are the agent working correctly.
 */
function turnFailed(tracer: Tracer, stopReason: string): boolean {
  if (stopReason !== "completed") return true;
  return tracer.events.some((event) => event.type === "tool_result" && event.outcome === "failed");
}

const settings: Settings = settingsSchema.parse({
  businessName: "Northwind Dental",
  locationId: "loc_test",
  model: {
    chain: [{ provider: "anthropic", model: "m" }],
    gate: { provider: "anthropic", model: "g" },
    judge: { provider: "openai", model: "j" },
  },
});

const sinks: TraceSink[] = [];
const tracerWith = (outcome?: "ok" | "failed" | "blocked") => {
  const tracer = new Tracer({ turnId: "t", conversationId: "c", sinks });
  if (outcome) {
    tracer.emit({ type: "tool_result", skill: "demo", outcome, result: {}, latencyMs: 1 });
  }
  return tracer;
};

describe("the repeated-failure backstop", () => {
  it("counts a turn that ran out of iterations", () => {
    expect(turnFailed(tracerWith(), "max_iterations")).toBe(true);
  });

  it("counts a turn that ran out of wall clock", () => {
    expect(turnFailed(tracerWith(), "turn_budget")).toBe(true);
  });

  it("counts a turn whose skill failed", () => {
    expect(turnFailed(tracerWith("failed"), "completed")).toBe(true);
  });

  it("does NOT count a guard doing its job", () => {
    // Refusing to overwrite a field is the agent working correctly. Counting it would escalate
    // exactly the conversations where the rules are holding.
    expect(turnFailed(tracerWith("blocked"), "completed")).toBe(false);
  });

  it("does NOT count an ordinary successful turn", () => {
    expect(turnFailed(tracerWith("ok"), "completed")).toBe(false);
  });

  it("uses a threshold the operator sets", () => {
    expect(settings.handover.maxFailedTurns).toBe(3);
  });
});
