import type { ModelMessage } from "ai";
import { callModel } from "../providers/call.js";
import { decideRetrieval } from "../rag/gate.js";
import { retrieve } from "../rag/retrieve.js";
import type { ModelResolver } from "../providers/registry.js";
import type { SkillContext } from "../skills/types.js";
import type { Tracer } from "../tracing/tracer.js";
import { buildMessages, buildSystemPrompt, type Session } from "./session.js";
import { observationFor, runSkill, toolSetFor } from "./tools.js";

/** Progress signals. The loop stays ignorant of what a caller does with them. */
export interface TurnHooks {
  /** Fired once per skill invocation, before guards run. */
  onToolStart?: (skill: string) => void;
  /** The model's own words before it acts. See architecture.md#interim-reply. */
  onInterimReply?: (text: string, skills: string[]) => void;
}

export interface TurnResult {
  reply: string;
  iterations: number;
  stopReason: "completed" | "max_iterations" | "turn_budget" | "error";
  handedOver: boolean;
}

/**
 * One customer turn: reason, act, observe, until the model has nothing left to do.
 * Three exits — done, iteration cap, turn budget — and all three reply. See #loop-exits.
 */
export async function runTurn(
  session: Session,
  registry: ModelResolver,
  tracer: Tracer,
  skillContext: SkillContext,
  hooks: TurnHooks = {},
): Promise<TurnResult> {
  const startedAt = Date.now();
  const { maxIterations, turnBudgetMs } = session.settings.behavior;

  // First: the system prompt is assembled from whatever retrieval found.
  const grounded = await ground(session, registry, tracer);

  const skills = grounded.skills.enabled(grounded.settings.skills);
  const tools = skills.length > 0 ? toolSetFor(skills) : undefined;
  const system = buildSystemPrompt(grounded);
  let messages = buildMessages(grounded);

  const finish = (
    reply: string,
    iterations: number,
    stopReason: TurnResult["stopReason"],
    handedOver = false,
  ): TurnResult => {
    tracer.emit({
      type: "turn_end",
      iterations,
      reply,
      stopReason,
      totalLatencyMs: Date.now() - startedAt,
    });
    return { reply, iterations, stopReason, handedOver };
  };

  /** One more call, no tools, so a guardrail exit still says what happened. See #loop-exits. */
  const speak = async (messagesSoFar: ModelMessage[], why: string): Promise<string> => {
    try {
      const closing = await callModel(
        {
          role: "chat",
          chain: session.settings.model.chain,
          system: `${system}

You cannot take any more actions on this turn. Reply to the customer now, in words. If you completed something, tell them plainly what it was. If you did not finish, say what you need from them.`,
          messages: messagesSoFar,
        },
        registry,
        tracer,
      );
      if (closing.text.trim().length > 0) return closing.text;
    } catch (error) {
      tracer.emit({
        type: "error",
        stage: "closing_reply",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    tracer.emit({ type: "error", stage: "fallback_reply", message: why });
    return session.settings.safety.fallbackMessage;
  };

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (Date.now() - startedAt > turnBudgetMs) {
      return finish(await speak(messages, "turn_budget"), iteration - 1, "turn_budget");
    }

    const response = await callModel(
      {
        role: "chat",
        chain: session.settings.model.chain,
        system,
        messages,
        ...(tools ? { tools } : {}),
      },
      registry,
      tracer,
    );

    if (response.toolCalls.length === 0) {
      // No text is not an answer, and the CRM rejects an empty send outright.
      const reply =
        response.text.trim().length > 0 ? response.text : await speak(messages, "empty_reply");
      return finish(reply, iteration, "completed");
    }

    if (response.text.trim().length > 0) {
      hooks.onInterimReply?.(
        response.text.trim(),
        response.toolCalls.map((call) => call.name),
      );
    }

    const observations: ModelMessage[] = [];
    let handedOver = false;

    for (const call of response.toolCalls) {
      hooks.onToolStart?.(call.name);
      const skill = session.skills.get(call.name);
      const result = skill
        ? await runSkill(skill, call.input, skillContext, tracer)
        : ({ status: "failed", error: `No skill named ${call.name}` } as const);

      if (result.status === "handover") handedOver = true;
      observations.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: call.id,
            toolName: call.name,
            output: { type: "text", value: observationFor(result) },
          },
        ],
      });
    }

    messages = [
      ...messages,
      {
        role: "assistant",
        content: response.toolCalls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name,
          input: call.input,
        })),
      },
      ...observations,
    ];

    // Terminal by design: the conversation belongs to a person now. See #handover-terminal.
    if (handedOver) {
      return finish(session.settings.handover.finalMessage, iteration, "completed", true);
    }
  }

  return finish(await speak(messages, "max_iterations"), maxIterations, "max_iterations");
}

/**
 * Decides whether this turn needs the knowledge base, and searches it if so.
 * On skip the model answers from the conversation alone. See #retrieval-gate.
 */
async function ground(session: Session, registry: ModelResolver, tracer: Tracer): Promise<Session> {
  if (!session.knowledge) return session;

  const decision = await decideRetrieval(
    { text: session.input.text, hasPendingAction: hasPendingAction(session) },
    session.settings,
    registry,
    tracer,
  );
  if (!decision.retrieve) return session;

  const result = await retrieve(
    { locationId: session.input.locationId, queries: decision.queries ?? [session.input.text] },
    session.knowledge,
    session.settings,
    tracer,
  );

  return { ...session, retrieved: { chunks: result.chunks } };
}

/**
 * Whether the customer is answering the agent rather than asking it something.
 * Narrow on purpose — an unnecessary search beats missing context. See #pending-action.
 */
function hasPendingAction(session: Session): boolean {
  const recent = (session.episodic ?? []).length > 0;
  const text = session.input.text.trim();
  return recent && text.length < 40 && !text.includes("?");
}
