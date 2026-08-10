import type { Settings } from "@harness/config";
import type { KnowledgeStore, ProviderRegistry, SkillRegistry, TraceSink } from "@harness/core";
import type { Database } from "@harness/db";
import type { ContactsApi, ConversationsApi } from "@harness/ghl";
import type { ChatHub } from "../chat/hub.js";
import type { Logger } from "../logger.js";
import type { ConversationStore } from "../store/conversation-store.js";

type RecordGap = (input: {
  locationId: string;
  question: string;
  bestScore: number | null;
  turnId: string;
}) => Promise<void>;

/** Everything a turn needs from outside itself. Assembled once at boot, in `context.ts`. */
export interface WorkerDeps {
  conversationsFor: (locationId: string) => ConversationsApi;
  conversations: ConversationStore;
  hub: ChatHub;
  logger: Logger;
  settings: Settings;
  providers: ProviderRegistry;
  skills: SkillRegistry;
  proceduralDocs: string[];
  soul: string;
  knowledge: (KnowledgeStore & { recordGap: RecordGap }) | undefined;
  sinks: TraceSink[];
  db: Database;
  ghlApis: {
    conversations(locationId: string): ConversationsApi;
    contacts(locationId: string): ContactsApi;
  };
}
