import {
  isAnswerableChannel,
  isInboundMessage,
  providerOutboundMessageSchema,
  webhookEnvelopeSchema,
} from "@harness/ghl";
import { Router } from "express";
import type { AppContext } from "../context.js";

/**
 * The agent's only trigger.
 *
 * The handler ACKs before doing any work. GHL treats a slow response as a failure and redelivers,
 * so processing inline would turn one customer message into several — the exact duplication the
 * idempotency check downstream exists to absorb.
 */
export function webhookRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post("/webhooks/ghl", (req, res) => {
    const receivedAt = Date.now();
    const parsed = webhookEnvelopeSchema.safeParse(req.body);

    if (!parsed.success) {
      // 400 is safe here only because a payload we cannot even parse will fail identically on
      // every retry; there is nothing to be gained by asking GHL to send it again.
      ctx.logger.warn("unparseable webhook", { issues: parsed.error.issues });
      res.status(400).json({ error: "Unrecognised webhook payload" });
      return;
    }

    res.status(202).json({ received: true });

    void ingest(ctx, parsed.data, receivedAt).catch((error: unknown) => {
      ctx.logger.error("webhook ingest failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  /**
   * GHL asking our conversation provider to deliver a message.
   *
   * Being the delivery mechanism is what lets the sandbox run without a phone number: delivering
   * an SMS here means marking it delivered so the CRM thread reads correctly. The chat surface
   * already had the text pushed to it by the worker, which does not wait on this round trip.
   */
  router.post("/webhooks/ghl/provider-outbound", (req, res) => {
    const parsed = providerOutboundMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      ctx.logger.warn("unparseable provider delivery request", { issues: parsed.error.issues });
      res.status(400).json({ error: "Unrecognised delivery payload" });
      return;
    }

    res.status(200).json({ received: true });

    const delivery = parsed.data;
    void ctx.ghlApis
      .conversations(delivery.locationId)
      .updateMessageStatus(delivery.messageId, "delivered")
      .catch((error: unknown) => {
        ctx.logger.error("could not report delivery status", {
          messageId: delivery.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });

  return router;
}

async function ingest(
  ctx: AppContext,
  event: ReturnType<typeof webhookEnvelopeSchema.parse>,
  receivedAt: number,
): Promise<void> {
  // Our own replies come back as OutboundMessage. Ignoring anything that is not an inbound
  // customer message is what stops the agent answering itself in a loop.
  if (!isInboundMessage(event)) {
    ctx.logger.debug("ignoring webhook", { type: event.type });
    return;
  }

  if (!isAnswerableChannel(event.messageType)) {
    ctx.logger.info("ignoring unanswerable channel", { messageType: event.messageType });
    return;
  }

  if (!ctx.settings.behavior.channels.includes(event.messageType)) {
    ctx.logger.info("channel disabled by settings", { messageType: event.messageType });
    return;
  }

  const isFirstDelivery = await ctx.messageLog.claim(event.messageId, event.locationId);
  if (!isFirstDelivery) {
    ctx.logger.info("duplicate delivery ignored", { messageId: event.messageId });
    return;
  }

  const conversation = await ctx.conversations.upsert({
    locationId: event.locationId,
    ghlConversationId: event.conversationId,
    contactId: event.contactId,
  });

  // Checked before queueing rather than inside the turn, so a handed-over conversation costs
  // nothing at all rather than a turn that decides to stay quiet.
  if (!conversation.aiEnabled) {
    ctx.logger.info("conversation is handed over, no turn", {
      conversationId: event.conversationId,
    });
    return;
  }

  if (conversation.repliesSent >= ctx.settings.behavior.replyCap) {
    ctx.logger.warn("reply cap reached, no turn", {
      conversationId: event.conversationId,
      replyCap: ctx.settings.behavior.replyCap,
    });
    return;
  }

  ctx.queue.submit({
    locationId: event.locationId,
    contactId: event.contactId,
    conversationId: event.conversationId,
    messageId: event.messageId,
    channel: event.messageType,
    body: event.body,
    dateAdded: event.dateAdded,
    receivedAt,
  });
}
