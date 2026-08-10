import type { CalendarsApi, ContactsApi, ConversationsApi } from "@harness/ghl";

/**
 * Everything the skills need from outside themselves.
 *
 * The API surfaces are bound per location because one installation of this app serves many
 * businesses. `silenceAgent` is a port rather than a direct write: the kill switch lives in our
 * own database, and this package may not reach it — which is also what lets a test assert the
 * switch was flipped without standing up Postgres.
 */
export interface GhlSkillDeps {
  contacts(locationId: string): ContactsApi;
  calendars(locationId: string): CalendarsApi;
  conversations(locationId: string): ConversationsApi;
  silenceAgent(input: {
    locationId: string;
    conversationId: string;
    reason: string;
  }): Promise<void>;
}
