import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../async-handler.js";
import { visitorName } from "../chat/visitor.js";
import type { AppContext } from "../context.js";

const messageBodySchema = z.object({
  sessionId: z.string().uuid(),
  text: z.string().min(1).max(4000),
});

const streamQuerySchema = z.object({ sessionId: z.string().uuid() });

/**
 * The customer-facing surface.
 *
 * Messages are not delivered to the agent directly. They are posted into GHL and come back to us
 * as a genuine InboundMessage webhook, so this app exercises exactly the same path as a real SMS
 * rather than a shortcut that only works for the demo.
 */
export function chatRoutes(ctx: AppContext): Router {
  const router = Router();
  const locationId = ctx.settings.locationId;

  /** Creates the placeholder contact a conversation has to hang off, plus its conversation. */
  router.post(
    "/api/chat/session",
    asyncHandler(async (_req, res) => {
      const contact = await ctx.ghlApis.contacts(locationId).create({
        firstName: visitorName(new Date()),
        tags: [ctx.settings.contactCapture.placeholderTag],
        source: "harness-chat",
      });
      const conversationId = await ctx.ghlApis
        .conversations(locationId)
        .createConversation(contact.id);

      const session = ctx.hub.create(contact.id, conversationId);
      ctx.logger.info("chat session opened", {
        sessionId: session.sessionId,
        contactId: contact.id,
      });
      res.status(201).json(session);
    }),
  );

  router.post(
    "/api/chat/message",
    asyncHandler(async (req, res) => {
      const body = messageBodySchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: "Expected { sessionId, text }" });
        return;
      }

      const session = ctx.hub.get(body.data.sessionId);
      if (!session) {
        res.status(404).json({ error: "Unknown session" });
        return;
      }

      const posted = await ctx.ghlApis.conversations(locationId).addInboundMessage({
        contactId: session.contactId,
        conversationId: session.conversationId,
        type: ctx.settings.ghl.chatChannel,
        message: body.data.text,
      });

      ctx.hub.publish(session.contactId, { event: "status", stage: "sent_to_crm" });
      res.status(202).json({ messageId: posted.messageId });
    }),
  );

  router.get("/api/chat/stream", (req, res) => {
    const query = streamQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Expected ?sessionId=<uuid>" });
      return;
    }

    const session = ctx.hub.get(query.data.sessionId);
    if (!session) {
      res.status(404).json({ error: "Unknown session" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Without this, a reverse proxy will buffer the stream and the page looks frozen.
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    const detach = ctx.hub.subscribe(session.contactId, res);
    // Tunnels and proxies drop idle connections; a periodic comment keeps this one open.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      detach();
    });
  });

  return router;
}
