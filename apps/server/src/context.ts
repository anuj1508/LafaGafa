import { loadEnv, loadSettings, type Env, type Settings } from "@harness/config";
import { createDatabase, warmPool, type Database } from "@harness/db";
import { Embedder, ProviderRegistry, type TraceSink } from "@harness/core";
import { CalendarsApi, ContactsApi, ConversationsApi, GhlClient } from "@harness/ghl";
import { createGhlSkillRegistry } from "@harness/skills-ghl";
import { ChatHub } from "./chat/hub.js";
import { createLogger, type Logger } from "./logger.js";
import { fromRepoRoot } from "./paths.js";
import { loadProceduralDocs, loadSoul } from "./skill-docs.js";
import { InProcessTurnQueue } from "./queue/in-process-queue.js";
import type { TurnQueue } from "./queue/types.js";
import { ConversationStore } from "./store/conversation-store.js";
import { ProcessedMessageLog } from "./store/message-log.js";
import { PostgresTokenStore } from "./token-store.js";
import { JsonlTraceSink } from "./tracing/jsonl-sink.js";
import { PgKnowledgeStore } from "./store/knowledge-store.js";
import { PostgresTraceSink } from "./tracing/postgres-sink.js";
import { createAgentWorker } from "./worker.js";

/** The typed API surfaces, bound lazily to a location so one client serves every installation. */
export interface GhlApis {
  contacts(locationId: string): ContactsApi;
  conversations(locationId: string): ConversationsApi;
  calendars(locationId: string): CalendarsApi;
}

/**
 * Everything the routes need, built once at boot. Assembled here rather than imported as module
 * singletons so tests can construct a server against a throwaway database and a fake GHL client.
 */
export interface AppContext {
  env: Env;
  settings: Settings;
  db: Database;
  ghl: GhlClient;
  ghlApis: GhlApis;
  hub: ChatHub;
  queue: TurnQueue;
  conversations: ConversationStore;
  messageLog: ProcessedMessageLog;
  logger: Logger;
  providers: ProviderRegistry;
  /**
   * Reorders the chat chain in place for this process.
   *
   * `settings` is handed to the worker by reference, so mutating the chain here changes the next
   * turn without a restart and without a settings-file write.
   */
  promoteProvider(provider: string): void;
  close(): Promise<void>;
}

export async function createAppContext(): Promise<AppContext> {
  const env = loadEnv();
  const settings = await loadSettings(fromRepoRoot(env.SETTINGS_PATH), {
    ...(env.MODEL_PROVIDER ? { preferProvider: env.MODEL_PROVIDER } : {}),
  });
  const promoteProvider = (provider: string): void => {
    const chosen = settings.model.chain.find((entry) => entry.provider === provider);
    if (!chosen) return;
    settings.model.chain = [chosen, ...settings.model.chain.filter((entry) => entry !== chosen)];
  };
  const logger = createLogger(env.LOG_LEVEL);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  // Retrieval issues one query per question, so the second one would otherwise open a connection
  // mid-turn and put the handshake on the customer's latency.
  await warmPool(pool);

  const ghl = new GhlClient({
    apiDomain: env.GHL_API_DOMAIN,
    clientId: env.GHL_APP_CLIENT_ID,
    clientSecret: env.GHL_APP_CLIENT_SECRET,
    tokens: new PostgresTokenStore(db),
  });

  const contactsByLocation = new Map<string, ContactsApi>();
  const conversationsByLocation = new Map<string, ConversationsApi>();
  const calendarsByLocation = new Map<string, CalendarsApi>();
  const ghlApis: GhlApis = {
    contacts(locationId) {
      const existing = contactsByLocation.get(locationId);
      if (existing) return existing;
      const api = new ContactsApi(ghl, locationId);
      contactsByLocation.set(locationId, api);
      return api;
    },
    conversations(locationId) {
      const existing = conversationsByLocation.get(locationId);
      if (existing) return existing;
      const api = new ConversationsApi(ghl, locationId);
      conversationsByLocation.set(locationId, api);
      return api;
    },
    calendars(locationId) {
      const existing = calendarsByLocation.get(locationId);
      if (existing) return existing;
      const api = new CalendarsApi(ghl, locationId);
      calendarsByLocation.set(locationId, api);
      return api;
    },
  };

  const hub = new ChatHub();
  const conversations = new ConversationStore(db);

  const providers = new ProviderRegistry({
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
    google: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const skills = createGhlSkillRegistry({
    contacts: (locationId) => ghlApis.contacts(locationId),
    calendars: (locationId) => ghlApis.calendars(locationId),
    conversations: (locationId) => ghlApis.conversations(locationId),
    silenceAgent: ({ locationId, conversationId, reason }) =>
      conversations.setAiEnabled({
        locationId,
        ghlConversationId: conversationId,
        enabled: false,
        reason,
      }),
  });
  const soul = await loadSoul(settings.soulPath);
  // Absent when no embedding key is configured: the agent then answers from the conversation
  // alone rather than failing every turn on a knowledge base it cannot search.
  const knowledge = env.OPENAI_API_KEY
    ? new PgKnowledgeStore(
        db,
        new Embedder({ ...settings.model.embedding, apiKey: env.OPENAI_API_KEY }),
      )
    : undefined;
  if (!knowledge) logger.warn("no embedding key; the knowledge base will not be searched");
  const proceduralDocs = await loadProceduralDocs(
    skills.enabled(settings.skills).map((skill) => skill.proceduralDoc),
    logger,
  );
  const sinks: TraceSink[] = [
    new PostgresTraceSink(db, logger),
    new JsonlTraceSink(fromRepoRoot("traces"), logger),
  ];

  const queue = new InProcessTurnQueue({
    debounceMs: settings.behavior.debounceMs,
    logger,
    handler: createAgentWorker({
      conversationsFor: (locationId) => ghlApis.conversations(locationId),
      conversations,
      db,
      hub,
      logger,
      settings,
      providers,
      skills,
      proceduralDocs,
      soul,
      knowledge,
      sinks,
      ghlApis,
    }),
  });

  return {
    env,
    settings,
    db,
    ghl,
    ghlApis,
    hub,
    queue,
    conversations,
    messageLog: new ProcessedMessageLog(db),
    logger,
    providers,
    promoteProvider,
    close: async () => {
      await queue.close();
      await pool.end();
    },
  };
}
