import { runTurn, Tracer, type EpisodicNote, type Session, type TraceEvent } from "@harness/core";
import { randomUUID } from "node:crypto";
import type { TurnRequest } from "./queue/types.js";
import { subAccountIdFor } from "./tenancy.js";
import { forceHandover, mergedContactId, recordKnowledgeGap, turnFailed } from "./turn/backstop.js";
import { loadHistory, loadKnownContact, replyChannelFor } from "./turn/crm-context.js";
import type { WorkerDeps } from "./turn/deps.js";
import { withTracer } from "./turn/tracer-context.js";

/**
 * Sends the model's own holding line, not a template, while the turn is still working.
 * See docs/architecture.md#interim-reply for when it fires.
 */
function acknowledge(
  deps: WorkerDeps,
  request: TurnRequest,
  tracer: Tracer,
  text: string,
  skills: string[],
): void {
  if (acknowledged.has(tracer)) return;

  const { acknowledgeAfterMs, acknowledgeSkills } = deps.settings.behavior;
  if (acknowledgeAfterMs === null) return;
  // Only genuinely slow work is worth interrupting for. Recording a name is instant, and a
  // holding message for it is two messages where one would do.
  if (!skills.some((skill) => acknowledgeSkills.includes(skill))) return;
  if (Date.now() - request.receivedAt < acknowledgeAfterMs) return;

  acknowledged.add(tracer);

  // Deliberately not awaited: the point is to reach the customer while the turn is still running.
  void deps
    .conversationsFor(request.locationId)
    .sendMessage({
      contactId: request.contactId,
      type: replyChannelFor(request.channel, deps.settings.ghl.replyChannel),
      message: text,
    })
    .catch((error: unknown) => {
      // A missing acknowledgement is cosmetic; the real reply is still on its way.
      deps.logger.warn("could not send acknowledgement", {
        conversationId: request.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/** One acknowledgement per turn, keyed by the turn's own tracer. */
const acknowledged = new WeakSet<Tracer>();

/**
 * Runs one agent turn and puts the answer back in the CRM thread. Owns only what the loop must
 * not know: which CRM this is, and how a reply reaches the customer.
 */
export function createAgentWorker(deps: WorkerDeps) {
  return async function handleTurn(request: TurnRequest): Promise<void> {
    const turnId = randomUUID();
    // Resolved once per turn: everything downstream keys on our id, not the CRM's.
    const subAccountId = await subAccountIdFor(
      deps.db,
      request.locationId,
      deps.settings.businessName,
    );
    const tracer = new Tracer({
      turnId,
      conversationId: request.conversationId,
      subAccountId,
      source: "live",
      sinks: deps.sinks,
    });

    // Ambient for the whole turn so the shared GHL client can attribute a round trip
    // to the turn that caused it. See docs/architecture.md#slo-clock.
    return withTracer(tracer, async () => {
      // Everything before this was waiting, not working: the debounce window and the queue.
      const startedWorkingAt = Date.now();
      tracer.emit({ type: "turn_start", input: request.body, messageIds: request.messageIds });

      const session: Session = {
        input: {
          locationId: request.locationId,
          contactId: request.contactId,
          conversationId: request.conversationId,
          text: request.body,
          history: await loadHistory(deps, request),
        },
        knownContact: await loadKnownContact(deps, request),
        episodic: await deps.conversations.memory(
          request.locationId,
          request.conversationId,
          deps.settings.behavior.memoryMaxAgeHours,
        ),
        settings: deps.settings,
        skills: deps.skills,
        proceduralDocs: deps.proceduralDocs,
        soul: deps.soul,
        ...(deps.knowledge ? { knowledge: deps.knowledge } : {}),
      };

      // Collected during the turn and written once at the end, so a skill's findings survive into
      // the next turn instead of being rediscovered.
      const learned: EpisodicNote[] = [];

      let reply: string;
      let stopReason = "error";
      try {
        const result = await runTurn(
          session,
          deps.providers,
          tracer,
          {
            locationId: request.locationId,
            contactId: request.contactId,
            conversationId: request.conversationId,
            settings: deps.settings,
            tracer,
            remember: (note) => {
              learned.push({ ...note, at: new Date().toISOString() });
            },
          },
          {
            onToolStart: (skill) => {
              deps.hub.publish(request.contactId, {
                event: "status",
                stage: "working",
                detail: skill,
              });
            },
            onInterimReply: (text, skills) => {
              acknowledge(deps, request, tracer, text, skills);
            },
          },
        );
        reply = result.reply;
        stopReason = result.stopReason;
      } catch (error) {
        // The customer gets an answer even when the harness itself failed. Silence is the one
        // outcome that is always wrong.
        tracer.emit({
          type: "error",
          stage: "run_turn",
          message: error instanceof Error ? error.message : String(error),
        });
        tracer.emit({
          type: "turn_end",
          iterations: 0,
          reply: null,
          stopReason: "error",
          totalLatencyMs: Date.now() - request.receivedAt,
        });
        reply = deps.settings.handover.finalMessage;
      }

      // A skill may have merged this contact into another, in which case the id from the webhook
      // no longer exists and sending to it fails outright.
      const contactId = mergedContactId(tracer) ?? request.contactId;

      // The deterministic half of handover. A model that never decides to escalate must not be
      // able to leave someone stuck repeating themselves, so this counts regardless of what it
      // decided and takes the conversation off the agent when the count runs out.
      const failures = await deps.conversations.recordTurnOutcome(
        request.locationId,
        request.conversationId,
        turnFailed(tracer, stopReason),
      );
      if (failures >= deps.settings.handover.maxFailedTurns) {
        await forceHandover(deps, request, tracer, failures);
        reply = deps.settings.handover.finalMessage;
      }

      const sent = await deps.conversationsFor(request.locationId).sendMessage({
        contactId,
        type: replyChannelFor(request.channel, deps.settings.ghl.replyChannel),
        message: reply,
        ...(deps.settings.ghl.conversationProviderId && request.channel === "Custom"
          ? { conversationProviderId: deps.settings.ghl.conversationProviderId }
          : {}),
      });

      const chatCall = tracer.events.find(
        (event): event is Extract<TraceEvent, { type: "llm_call" }> =>
          event.type === "llm_call" && event.role === "chat",
      );
      const crmCalls = tracer.events.filter(
        (event): event is Extract<TraceEvent, { type: "crm_call" }> => event.type === "crm_call",
      );
      const loopEnd = tracer.events.find(
        (event): event is Extract<TraceEvent, { type: "turn_end" }> => event.type === "turn_end",
      );

      // The SLO clock, closed here because the send is the "to send" half of it. `turn_end`
      // measures the loop only. See docs/architecture.md#slo-clock.
      tracer.emit({
        type: "turn_sent",
        webhookToSendMs: Date.now() - request.receivedAt,
        queuedMs: startedWorkingAt - request.receivedAt,
        loopMs: loopEnd?.totalLatencyMs ?? 0,
        crmMs: crmCalls.reduce((total, call) => total + call.latencyMs, 0),
        // The last one is the reply POST; the earlier ones fetched history before the loop.
        sendMs: crmCalls.at(-1)?.latencyMs ?? 0,
        provider: chatCall?.provider ?? null,
        retrieved: tracer.events.some((event) => event.type === "rag_retrieve"),
      });

      await deps.conversations.countReply(request.locationId, request.conversationId);
      await deps.conversations.appendMemory(request.locationId, request.conversationId, learned);
      // Published under the original id: that is the one the browser opened its stream with.
      deps.hub.publish(request.contactId, { event: "reply", text: reply });

      deps.logger.info("turn replied", {
        turnId,
        conversationId: request.conversationId,
        messageIds: request.messageIds,
        sentMessageId: sent.messageId,
        // The SLO clock: webhook received to send returned, debounce excluded by measuring from
        // the earliest message in the batch.
        latencyMs: Date.now() - request.receivedAt,
      });

      void recordKnowledgeGap(deps, request, tracer, turnId);

      // Flushed after the reply is out, never before: tracing must not sit on the critical path.
      void tracer.flush();
    });
  };
}
