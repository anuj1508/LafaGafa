import { randomUUID } from "node:crypto";

/**
 * The name given to a visitor who has not introduced themselves.
 *
 * Shared because two places must agree on it: the chat route that writes it, and the turn
 * assembly that must not report it to the model as a name already on file — doing so would stop
 * the agent ever recording the customer's real one.
 */
const PLACEHOLDER_NAME_PREFIX = "Web Visitor";

export function visitorName(now: Date): string {
  // Suffixed because the CRM resolves an identical name to the existing contact, and a
  // minute-precision name put two visitors in one thread reading each other's messages.
  const unique = randomUUID().slice(0, 4);
  return `${PLACEHOLDER_NAME_PREFIX} ${now.toISOString().slice(0, 16).replace("T", " ")} ${unique}`;
}

export function isPlaceholderName(value: string | null | undefined): boolean {
  return (value ?? "").startsWith(PLACEHOLDER_NAME_PREFIX);
}
