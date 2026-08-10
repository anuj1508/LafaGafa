import type { Tracer } from "@harness/core";
import type { TurnRequest } from "../queue/types.js";
import type { WorkerDeps } from "./deps.js";

/**
 * Whether this turn got the customer anywhere. A blocked guard is not a failure — that is the
 * agent working correctly, and counting it would escalate exactly the conversations going well.
 */
export function turnFailed(tracer: Tracer, stopReason: string): boolean {
  if (stopReason !== "completed") return true;
  return tracer.events.some((event) => event.type === "tool_result" && event.outcome === "failed");
}

/** Logs a question the documents could not answer, read off the trace rather than plumbed through the loop. */
export async function recordKnowledgeGap(
  deps: WorkerDeps,
  request: TurnRequest,
  tracer: Tracer,
  turnId: string,
): Promise<void> {
  if (!deps.knowledge || !deps.settings.knowledge.logKnowledgeGaps) return;

  const miss = tracer.events.find((event) => event.type === "rag_retrieve" && event.belowFloor);
  if (!miss || miss.type !== "rag_retrieve") return;

  try {
    await deps.knowledge.recordGap({
      locationId: request.locationId,
      question: miss.query,
      bestScore: miss.chunks[0]?.score ?? null,
      turnId,
    });
  } catch (error) {
    deps.logger.warn("could not record the knowledge gap", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The surviving contact id, when a skill reported that the CRM merged this one away. */
export function mergedContactId(tracer: Tracer): string | undefined {
  for (const event of tracer.events) {
    if (event.type !== "tool_result") continue;
    const data = (event.result as { data?: { mergedIntoContactId?: unknown } }).data;
    if (typeof data?.mergedIntoContactId === "string") return data.mergedIntoContactId;
  }
  return undefined;
}

/**
 * Takes the conversation off the agent after too many turns that went nowhere.
 * Same order as the skill: silence first, then mark it.
 */
export async function forceHandover(
  deps: WorkerDeps,
  request: TurnRequest,
  tracer: Tracer,
  failures: number,
): Promise<void> {
  await deps.conversations.setAiEnabled({
    locationId: request.locationId,
    ghlConversationId: request.conversationId,
    enabled: false,
    reason: "repeated_failure",
  });

  tracer.emit({
    type: "handover",
    trigger: "repeated_failure",
    evidence: [`${failures} turns in a row failed or ran out of road`],
  });

  try {
    await deps.ghlApis.contacts(request.locationId).update(request.contactId, {
      tags: deps.settings.handover.tags,
      ...(deps.settings.handover.assignTo ? { assignedTo: deps.settings.handover.assignTo } : {}),
    });
  } catch (error) {
    deps.logger.error("forced handover could not tag the contact", {
      contactId: request.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  deps.logger.warn("forced handover after repeated failures", {
    conversationId: request.conversationId,
    failures,
  });
}
