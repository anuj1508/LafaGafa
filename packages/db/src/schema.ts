import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/** OAuth installations, one row per location or company that installed the app. */
export const installations = pgTable("installations", {
  resourceId: text("resource_id").primaryKey(),
  userType: text("user_type").notNull(),
  companyId: text("company_id"),
  locationId: text("location_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-conversation agent state. `aiEnabled` is the kill switch every inbound message checks
 * before a turn is ever queued, so a handover silences the agent even if a later step failed.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    ghlConversationId: text("ghl_conversation_id").notNull(),
    contactId: text("contact_id").notNull(),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    /** Counts agent messages only — the reply cap that protects against loops. */
    repliesSent: integer("replies_sent").notNull().default(0),
    /** The deterministic half of handover: counts regardless of what the model decided. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    handoverReason: text("handover_reason"),
    handoverAt: timestamp("handover_at", { withTimezone: true }),
    lastHumanReplyAt: timestamp("last_human_reply_at", { withTimezone: true }),
    /** What the conversation established, not what was said. Stops the next turn rediscovering it. */
    memory: jsonb("memory").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byGhlConversation: uniqueIndex("conversations_ghl_conversation_idx").on(
      table.locationId,
      table.ghlConversationId,
    ),
  }),
);

/**
 * Webhook idempotency. GHL redelivers; the unique index is what turns a duplicate delivery into
 * a no-op instead of a second reply to the customer.
 */
export const processedMessages = pgTable(
  "processed_messages",
  {
    messageId: text("message_id").primaryKey(),
    locationId: text("location_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byReceivedAt: index("processed_messages_received_at_idx").on(table.receivedAt),
  }),
);

/**
 * Our own tenancy, and the only place a vendor's identifier appears.
 * Everything else keys on `sub_accounts.id`. See docs/architecture.md#tenancy.
 */
export const subAccounts = pgTable(
  "sub_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** The GHL location. Nullable so a sub-account can exist before it is connected. */
    ghlLocationId: text("ghl_location_id"),
    timezone: text("timezone").notNull().default("Europe/London"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byLocation: uniqueIndex("sub_accounts_location_idx").on(table.ghlLocationId),
  }),
);

/** The ordered event stream per turn. Every transparency surface is a query over this table. */
export const traceEvents = pgTable(
  "trace_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    /** The partition key. Eval turns have no conversation row, so a join would miss them. */
    subAccountId: uuid("sub_account_id"),
    /** Which agent ran, once a sub-account has more than one. */
    agentId: text("agent_id"),
    /** 'live' or 'eval', so a suite run and a customer turn share a viewer without mixing counts. */
    source: text("source").notNull().default("live"),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    latencyMs: integer("latency_ms"),
    payload: jsonb("payload").notNull(),
  },
  (table) => ({
    byTurn: uniqueIndex("trace_events_turn_seq_idx").on(table.turnId, table.seq),
    byConversation: index("trace_events_conversation_idx").on(table.conversationId, table.ts),
    byTenant: index("trace_events_tenant_idx").on(table.subAccountId, table.ts),
    bySource: index("trace_events_source_idx").on(table.source, table.ts),
  }),
);

/** Knowledge base chunks. `embedding` dimensions match text-embedding-3-small. */
export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: text("location_id").notNull(),
    source: text("source").notNull(),
    heading: text("heading"),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byEmbedding: index("kb_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    byLocation: index("kb_chunks_location_idx").on(table.locationId),
  }),
);

/**
 * Questions the KB could not answer. The operator reviews this list and writes the missing
 * document, so the knowledge base improves from real conversations rather than guesswork.
 */
export const knowledgeGaps = pgTable("knowledge_gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: text("location_id").notNull(),
  question: text("question").notNull(),
  bestScore: real("best_score"),
  turnId: uuid("turn_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per release-gate run, so eval results are history rather than a screenshot. */
export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  gitSha: text("git_sha"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  deterministicPassed: integer("deterministic_passed").notNull(),
  deterministicTotal: integer("deterministic_total").notNull(),
  judgeMean: real("judge_mean"),
  latencyP50Ms: integer("latency_p50_ms"),
  latencyP95Ms: integer("latency_p95_ms"),
  passed: boolean("passed").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
