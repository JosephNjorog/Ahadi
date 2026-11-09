CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb,
	"result" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promise_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"head_hash" text NOT NULL,
	"anchored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_anchors_promise_id_seq_unique" UNIQUE("promise_id","seq")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"promise_id" uuid,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"channels" text[] NOT NULL,
	"deliveries" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passports" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"stats" jsonb NOT NULL,
	"score" numeric(4, 3) DEFAULT 0 NOT NULL,
	"show_exact_earnings" boolean DEFAULT false NOT NULL,
	"recomputed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passports_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone_e164" text NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"wa_message_id" text,
	"action" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "api_key_prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "data" "bytea";--> statement-breakpoint
ALTER TABLE "mediations" ADD COLUMN "status" text DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "mediations" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "mediations" ADD COLUMN "resolution_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "mediations" ADD COLUMN "client_decision" text;--> statement-breakpoint
ALTER TABLE "mediations" ADD COLUMN "worker_decision" text;--> statement-breakpoint
ALTER TABLE "mediations" ADD COLUMN "rejections" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "promises" ADD COLUMN "budget_minor" bigint;--> statement-breakpoint
ALTER TABLE "promises" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "promises" ADD COLUMN "invite_email" text;--> statement-breakpoint
ALTER TABLE "promises" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "promises" ADD COLUMN "terms_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "promises" ADD COLUMN "terms_error" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "explanation_client" jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "explanation_worker" jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "mediation_id" uuid;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD COLUMN "source" text DEFAULT 'architect' NOT NULL;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD COLUMN "change_summary" text;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD COLUMN "critique" jsonb;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD COLUMN "notes" jsonb;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_anchors" ADD CONSTRAINT "ledger_anchors_promise_id_promises_id_fk" FOREIGN KEY ("promise_id") REFERENCES "public"."promises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passports" ADD CONSTRAINT "passports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_actions_agent_idx" ON "agent_actions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_subject_idx" ON "agent_runs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_phone_idx" ON "whatsapp_messages" USING btree ("phone_e164","created_at");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_api_key_hash_unique" UNIQUE("api_key_hash");