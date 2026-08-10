import type { MessageChannel } from "@harness/config";
import { z } from "zod";
import type { GhlClient } from "../client.js";

/** Every Conversations endpoint is pinned to this API version. */
const VERSION = "2021-04-15";

const sendMessageResponseSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  status: z.string().optional(),
});

const createConversationResponseSchema = z.object({
  conversation: z.object({ id: z.string() }),
});

const addInboundResponseSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
});

const messageHistorySchema = z.object({
  messages: z.object({
    messages: z
      .array(
        z.object({
          id: z.string(),
          body: z.string().optional(),
          direction: z.string(),
          dateAdded: z.string(),
          messageType: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

export interface HistoryMessage {
  id: string;
  body: string;
  /** "inbound" is the customer; anything else came from the business side. */
  direction: string;
  dateAdded: string;
}

export interface SendMessageInput {
  contactId: string;
  type: MessageChannel;
  message: string;
  conversationProviderId?: string;
}

export interface AddInboundMessageInput {
  contactId: string;
  conversationId: string;
  type: MessageChannel;
  message: string;
  /**
   * Required only for `type: "Custom"`, despite the published spec marking it required outright.
   * A `Live_Chat` or `SMS` message is accepted without one.
   */
  conversationProviderId?: string;
}

/** Conversation reads and writes for one location. `GhlClient` keeps authentication. */
export class ConversationsApi {
  constructor(
    private readonly client: GhlClient,
    private readonly locationId: string,
  ) {}

  /**
   * Sends a message as the business. `subType` and `status` are marked required by the published
   * schema and omitted here: both are spec-generation artifacts a caller cannot supply.
   */
  async sendMessage(input: SendMessageInput): Promise<z.infer<typeof sendMessageResponseSchema>> {
    const response = await this.client.requests(this.locationId).post(
      "/conversations/messages",
      {
        type: input.type,
        contactId: input.contactId,
        message: input.message,
        ...(input.conversationProviderId
          ? { conversationProviderId: input.conversationProviderId }
          : {}),
      },
      { headers: { Version: VERSION } },
    );
    return sendMessageResponseSchema.parse(response.data);
  }

  /** Without this every message sits at "pending" in the thread, reading as a broken bot. */
  async updateMessageStatus(
    messageId: string,
    status: "delivered" | "failed" | "pending" | "read",
    error?: string,
  ): Promise<void> {
    await this.client
      .requests(this.locationId)
      .put(
        `/conversations/messages/${messageId}/status`,
        { status, ...(error ? { error } : {}) },
        { headers: { Version: VERSION } },
      );
  }

  /** Bounded on purpose: an unbounded thread grows every turn's prompt, latency and cost. */
  async history(conversationId: string, limit = 20): Promise<HistoryMessage[]> {
    const response = await this.client
      .requests(this.locationId)
      .get(`/conversations/${conversationId}/messages`, {
        params: { limit },
        headers: { Version: VERSION },
      });

    return messageHistorySchema
      .parse(response.data)
      .messages.messages.filter((message) => (message.body ?? "").trim().length > 0)
      .map((message) => ({
        id: message.id,
        body: message.body ?? "",
        direction: message.direction,
        dateAdded: message.dateAdded,
      }))
      .sort((a, b) => a.dateAdded.localeCompare(b.dateAdded));
  }

  /** Opens a conversation for a contact. A brand-new contact has none until something creates it. */
  async createConversation(contactId: string): Promise<string> {
    const response = await this.client
      .requests(this.locationId)
      .post(
        "/conversations/",
        { locationId: this.locationId, contactId },
        { headers: { Version: VERSION } },
      );
    return createConversationResponseSchema.parse(response.data).conversation.id;
  }

  /** How the chat surface reaches the agent: in via the CRM, back as a real inbound webhook. */
  async addInboundMessage(
    input: AddInboundMessageInput,
  ): Promise<z.infer<typeof addInboundResponseSchema>> {
    const response = await this.client.requests(this.locationId).post(
      "/conversations/messages/inbound",
      {
        type: input.type,
        contactId: input.contactId,
        conversationId: input.conversationId,
        conversationProviderId: input.conversationProviderId,
        message: input.message,
      },
      { headers: { Version: VERSION } },
    );
    return addInboundResponseSchema.parse(response.data);
  }
}
