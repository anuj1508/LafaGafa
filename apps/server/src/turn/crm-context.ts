import type { MessageChannel } from "@harness/config";
import { isPlaceholderName } from "../chat/visitor.js";
import type { TurnRequest } from "../queue/types.js";
import type { WorkerDeps } from "./deps.js";

/**
 * The channel a reply goes out on: the one it arrived on, except "Custom" — GHL delivers under
 * that type but the send endpoint refuses it, so those fall back to the configured channel.
 */
export function replyChannelFor(
  inbound: MessageChannel,
  configured: MessageChannel,
): MessageChannel {
  return inbound === "Custom" ? configured : inbound;
}

/**
 * The conversation so far, read from the CRM so a colleague's hand-typed reply is context too.
 * A failure degrades the turn to a first message rather than failing it.
 */
export async function loadHistory(
  deps: WorkerDeps,
  request: TurnRequest,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const messages = await deps.ghlApis
      .conversations(request.locationId)
      .history(request.conversationId, 20);

    return (
      messages
        // The message that triggered this turn is passed separately; including it twice would have
        // the model answer the customer's words as though they had said them again.
        .filter((message) => !request.messageIds.includes(message.id))
        .map((message) => ({
          role: message.direction === "inbound" ? ("user" as const) : ("assistant" as const),
          content: message.body,
        }))
    );
  } catch (error) {
    deps.logger.warn("could not load conversation history", {
      conversationId: request.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * The details already recorded. The placeholder name is omitted: claiming "Web Visitor 2026-08-09"
 * is on file would stop the model recording the customer's real one.
 */
export async function loadKnownContact(
  deps: WorkerDeps,
  request: TurnRequest,
): Promise<Record<string, string>> {
  try {
    const contact = await deps.ghlApis.contacts(request.locationId).get(request.contactId);
    // The invented name is omitted, but a real one is reported even while the placeholder tag
    // lingers — otherwise the model re-saves the customer's name on every subsequent turn.
    const hasRealName = !isPlaceholderName(contact.firstName);
    return {
      ...(hasRealName && contact.firstName ? { firstName: contact.firstName } : {}),
      ...(hasRealName && contact.lastName ? { lastName: contact.lastName } : {}),
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
    };
  } catch (error) {
    deps.logger.warn("could not read contact", {
      contactId: request.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
