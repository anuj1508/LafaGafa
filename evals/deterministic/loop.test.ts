import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { settingsSchema, type ModelBinding, type Settings } from "@harness/config";
import {
  runTurn,
  SkillRegistry,
  Tracer,
  type ModelResolver,
  type Session,
  type SkillContext,
  type TraceEvent,
} from "@harness/core";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const settings: Settings = settingsSchema.parse({
  businessName: "Northwind Dental",
  locationId: "loc_test",
  model: {
    chain: [{ provider: "anthropic", model: "test-model" }],
    gate: { provider: "anthropic", model: "test-gate" },
    judge: { provider: "openai", model: "test-judge" },
  },
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that answers in words and asks for nothing. */
function speaks(text: string): ModelResolver {
  const result: LanguageModelV4GenerateResult = {
    finishReason: { unified: "stop", raw: "stop" },
    usage,
    content: [{ type: "text", text }],
    warnings: [],
  };
  const model = new MockLanguageModelV4({ doGenerate: result });
  return { has: () => true, resolve: () => model };
}

/**
 * A model that asks for the same tool forever.
 *
 * The pathological case the guardrails exist for: without an iteration cap this runs until the
 * process dies, and the customer waits for a reply that never comes.
 */
function alwaysCallsTool(toolName = "demo"): ModelResolver {
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: () => {
      call += 1;
      const result: LanguageModelV4GenerateResult = {
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage,
        content: [
          {
            type: "tool-call",
            toolCallId: `call_${call}`,
            toolName,
            input: JSON.stringify({ note: "again" }),
          },
        ],
        warnings: [],
      };
      return Promise.resolve(result);
    },
  });
  return { has: () => true, resolve: () => model };
}

function sessionWith(skills: SkillRegistry, overrides: Partial<Settings> = {}): Session {
  return {
    input: {
      locationId: "loc_test",
      contactId: "con_test",
      conversationId: "conv_test",
      text: "hello",
      history: [],
    },
    settings: { ...settings, ...overrides },
    skills,
    proceduralDocs: [],
  };
}

const remembered: Array<{ kind: string; detail: string }> = [];

const tracerFor = () => new Tracer({ turnId: "turn_test", conversationId: "conv_test", sinks: [] });

function contextFor(tracer: Tracer): SkillContext {
  return {
    locationId: "loc_test",
    contactId: "con_test",
    conversationId: "conv_test",
    settings,
    tracer,
    remember: (note) => remembered.push(note),
  };
}

const typesOf = (events: readonly TraceEvent[]) => events.map((event) => event.type);

const echoSkill = {
  name: "demo",
  description: "echoes a note",
  schema: z.object({ note: z.string() }),
  execute: () => Promise.resolve({ status: "ok" as const, data: {}, summaryForModel: "echoed" }),
};

describe("the loop", () => {
  it("returns the model's own words when it asks for no tools", async () => {
    const tracer = tracerFor();

    const result = await runTurn(
      sessionWith(new SkillRegistry()),
      speaks("We open at nine."),
      tracer,
      contextFor(tracer),
    );

    expect(result).toMatchObject({ reply: "We open at nine.", stopReason: "completed" });
    expect(typesOf(tracer.events)).toEqual(["llm_call", "turn_end"]);
  });

  it("never answers with nothing, even when the model returns no text", async () => {
    // A blank send is rejected outright by the CRM, so the customer would get silence.
    const tracer = tracerFor();

    const result = await runTurn(
      sessionWith(new SkillRegistry()),
      speaks("   "),
      tracer,
      contextFor(tracer),
    );

    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(tracer.events).toContainEqual(
      expect.objectContaining({ type: "error", stage: "fallback_reply" }),
    );
  });

  it("does NOT claim a handover when it merely ran out of steps", async () => {
    // The worst outcome available: telling a customer a colleague is coming when the thing they
    // asked for actually succeeded. Running out of room is not a decision to escalate.
    const tracer = tracerFor();
    const session = sessionWith(new SkillRegistry().register(echoSkill), {
      behavior: { ...settings.behavior, maxIterations: 1 },
    });

    const result = await runTurn(session, alwaysCallsTool(), tracer, contextFor(tracer));

    expect(result.stopReason).toBe("max_iterations");
    expect(result.reply).not.toBe(settings.handover.finalMessage);
  });

  it("stops at the iteration cap and still answers the customer", async () => {
    const tracer = tracerFor();
    const session = sessionWith(new SkillRegistry().register(echoSkill), {
      behavior: { ...settings.behavior, maxIterations: 3 },
    });

    const result = await runTurn(session, alwaysCallsTool(), tracer, contextFor(tracer));

    expect(result.stopReason).toBe("max_iterations");
    expect(result.iterations).toBe(3);
    // A guardrail exit is still a reply. Silence is the one outcome a customer cannot act on.
    expect(result.reply.trim().length).toBeGreaterThan(0);
    // Three working calls plus one final call whose only job is to say something.
    expect(typesOf(tracer.events).filter((type) => type === "llm_call")).toHaveLength(4);
  });

  it("feeds a thrown skill error back as an observation instead of ending the turn", async () => {
    const tracer = tracerFor();
    const session = sessionWith(
      new SkillRegistry().register({
        ...echoSkill,
        execute: () => Promise.reject(new Error("CRM is down")),
      }),
      { behavior: { ...settings.behavior, maxIterations: 2 } },
    );

    // Resolves rather than rejects: that is what lets the model explain the failure to a customer.
    const result = await runTurn(session, alwaysCallsTool(), tracer, contextFor(tracer));

    expect(result.stopReason).toBe("max_iterations");
    expect(tracer.events).toContainEqual(
      expect.objectContaining({ type: "tool_result", outcome: "failed" }),
    );
  });

  it("blocks a skill whose guard rejects, and never runs its body", async () => {
    let executed = false;
    const tracer = tracerFor();
    const session = sessionWith(
      new SkillRegistry().register({
        ...echoSkill,
        guards: [{ name: "never", check: () => ({ ok: false as const, reason: "not allowed" }) }],
        execute: () => {
          executed = true;
          return Promise.resolve({ status: "ok" as const, data: {}, summaryForModel: "ran" });
        },
      }),
      { behavior: { ...settings.behavior, maxIterations: 1 } },
    );

    await runTurn(session, alwaysCallsTool(), tracer, contextFor(tracer));

    expect(executed).toBe(false);
    expect(tracer.events).toContainEqual(
      expect.objectContaining({ type: "skill_guard", passed: false, reason: "not allowed" }),
    );
    expect(tracer.events).toContainEqual(
      expect.objectContaining({ type: "tool_result", outcome: "blocked" }),
    );
  });

  it("reports a call to a skill that does not exist rather than throwing", async () => {
    const tracer = tracerFor();
    const session = sessionWith(new SkillRegistry(), {
      behavior: { ...settings.behavior, maxIterations: 1 },
    });

    const result = await runTurn(
      session,
      alwaysCallsTool("no_such_skill"),
      tracer,
      contextFor(tracer),
    );

    expect(result.stopReason).toBe("max_iterations");
  });
});

describe("the failover chain", () => {
  it("carries the conversation to the next provider and records both attempts", async () => {
    const primary = settings.model.chain[0];
    if (!primary) throw new Error("fixture needs at least one model binding");

    const chain: ModelBinding[] = [
      { ...primary, provider: "anthropic", model: "dead" },
      { ...primary, provider: "openai", model: "alive" },
    ];
    const dead = new MockLanguageModelV4({
      doGenerate: () => Promise.reject(new Error("provider is down")),
    });
    const alive = new MockLanguageModelV4({
      doGenerate: {
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        content: [{ type: "text", text: "answered on the fallback" }],
        warnings: [],
      },
    });
    const registry: ModelResolver = {
      has: () => true,
      resolve: (binding) => (binding.model === "dead" ? dead : alive),
    };

    const tracer = tracerFor();
    const session = sessionWith(new SkillRegistry(), { model: { ...settings.model, chain } });

    const result = await runTurn(session, registry, tracer, contextFor(tracer));

    expect(result.reply).toBe("answered on the fallback");
    expect(typesOf(tracer.events)).toEqual(["error", "provider_failover", "llm_call", "turn_end"]);
    // The attempt number is what shows a trace the chain was walked rather than guessed at.
    expect(tracer.events).toContainEqual(
      expect.objectContaining({ type: "llm_call", provider: "openai", attempt: 2 }),
    );
  });
});
