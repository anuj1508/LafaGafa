import { messageChannelSchema, type MessageChannel } from "@harness/config";
import { z } from "zod";

/**
 * Whether a message that arrived can also be replied to.
 *
 * The webhook's `messageType` is an open vocabulary (SMS, CALL, Email, Live_Chat and more), so
 * this is a recognition check rather than a parse: an unrecognised channel is a message we
 * decline to answer, never a rejected delivery.
 */
export function isAnswerableChannel(messageType: string): messageType is MessageChannel {
  return messageChannelSchema.safeParse(messageType).success;
}

export const inboundMessageSchema = z.object({
  type: z.literal("InboundMessage"),
  locationId: z.string().min(1),
  contactId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  /** Not an enum: see `isAnswerableChannel`. Real values include SMS, CALL, Email, Live_Chat. */
  messageType: z.string().min(1),
  direction: z.literal("inbound"),
  body: z.string().default(""),
  dateAdded: z.string().min(1),
  attachments: z.array(z.string()).default([]),
  contentType: z.string().optional(),
  status: z.string().optional(),
  conversationProviderId: z.string().optional(),
  /** Present when the message came through a Live Chat widget. */
  chatWidgetId: z.string().optional(),
});

export type InboundMessage = z.infer<typeof inboundMessageSchema>;

/**
 * A message sent from the business side, by a human in the CRM or by us.
 *
 * `userId` is what tells the two apart: a human send carries one, our own API send does not.
 * Phase 3 uses that to stand the agent down when staff join a conversation.
 */
export const outboundMessageSchema = z.object({
  type: z.literal("OutboundMessage"),
  locationId: z.string().min(1),
  contactId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  messageType: z.string().min(1),
  direction: z.literal("outbound"),
  body: z.string().default(""),
  dateAdded: z.string().min(1),
  userId: z.string().optional(),
});

export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

/**
 * Everything GHL may POST to the webhook endpoint.
 *
 * The catch-all arm is load-bearing: the app is subscribed to events we do not handle yet, and an
 * unhandled event must ACK rather than 400. GHL retries failures, so rejecting an event we simply
 * do not care about would earn an unbounded retry loop.
 */
export const webhookEnvelopeSchema = z.union([
  inboundMessageSchema,
  outboundMessageSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export function isInboundMessage(event: WebhookEnvelope): event is InboundMessage {
  return event.type === "InboundMessage";
}

export function isOutboundMessage(event: WebhookEnvelope): event is OutboundMessage {
  return event.type === "OutboundMessage";
}
