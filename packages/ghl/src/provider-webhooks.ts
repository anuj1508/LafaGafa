import { z } from "zod";

/**
 * A message GHL is asking our custom conversation provider to deliver.
 *
 * This arrives for every message sent through the provider, including the agent's own replies.
 * Being the delivery mechanism is what lets the harness run against a sandbox with no phone
 * number attached: "delivering" an SMS means pushing it to the chat surface we own.
 */
export const providerOutboundMessageSchema = z.object({
  type: z.string().min(1),
  locationId: z.string().min(1),
  contactId: z.string().min(1),
  messageId: z.string().min(1),
  message: z.string().default(""),
  phone: z.string().optional(),
  attachments: z.array(z.string()).default([]),
  /** Present when a human in the CRM sent it, absent when it came from our own API call. */
  userId: z.string().optional(),
});

export type ProviderOutboundMessage = z.infer<typeof providerOutboundMessageSchema>;
