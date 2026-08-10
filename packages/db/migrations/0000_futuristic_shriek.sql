-- Hand-added: drizzle-kit does not emit this, and every kb_chunks column below needs it.
-- Regenerating this file drops the line, so put it back.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"ghl_conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"replies_sent" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"handover_reason" text,
	"handover_at" timestamp with time zone,
	"last_human_reply_at" timestamp with time zone,
	"memory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"git_sha" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"deterministic_passed" integer NOT NULL,
	"deterministic_total" integer NOT NULL,
	"judge_mean" real,
	"latency_p50_ms" integer,
	"latency_p95_ms" integer,
	"passed" boolean NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installations" (
	"resource_id" text PRIMARY KEY NOT NULL,
	"user_type" text NOT NULL,
	"company_id" text,
	"location_id" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"source" text NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"question" text NOT NULL,
	"best_score" real,
	"turn_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sub_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ghl_location_id" text,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trace_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"conversation_id" text NOT NULL,
	"sub_account_id" uuid,
	"agent_id" text,
	"source" text DEFAULT 'live' NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"latency_ms" integer,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_ghl_conversation_idx" ON "conversations" USING btree ("location_id","ghl_conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_chunks_location_idx" ON "kb_chunks" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "processed_messages_received_at_idx" ON "processed_messages" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sub_accounts_location_idx" ON "sub_accounts" USING btree ("ghl_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trace_events_turn_seq_idx" ON "trace_events" USING btree ("turn_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trace_events_conversation_idx" ON "trace_events" USING btree ("conversation_id","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trace_events_tenant_idx" ON "trace_events" USING btree ("sub_account_id","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trace_events_source_idx" ON "trace_events" USING btree ("source","ts");