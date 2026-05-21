CREATE TABLE "known_issue_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint_pattern" varchar(255) NOT NULL,
	"description" text,
	"fix_status" varchar(50) DEFAULT 'open' NOT NULL,
	"fix_commit" varchar(100),
	"regression_count" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "known_issue_registry_fingerprint_pattern_unique" UNIQUE("fingerprint_pattern")
);
--> statement-breakpoint
CREATE TABLE "platform_ops_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_id" uuid NOT NULL,
	"agent_role" text NOT NULL,
	"phase" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"diagnosis" text,
	"root_cause" text,
	"files_to_modify" jsonb,
	"estimated_risk" text,
	"reproduces" boolean,
	"branch_name" text,
	"commit_sha" text,
	"diff_hash" text,
	"pr_url" text,
	"pr_number" integer,
	"repro_evidence" jsonb,
	"test_evidence" jsonb,
	"verifier_vote" text,
	"verifier_reasoning" text,
	"turns" integer,
	"wall_clock_seconds" integer,
	"cost_cents" integer,
	"llm_provider" text,
	"llm_model" text,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runtime_ai_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"execution_id" uuid,
	"model" varchar(100) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"jti" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_sessions_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "refund_policy" SET DEFAULT 'no_refund';--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "idempotency_key" varchar(100);--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "source" text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "occurrence_count" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "diagnosis" text;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "estimated_risk" text;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "ops_run_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "reproduced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "repair_attempt_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_holder" varchar(255);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "attempt_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "openai_codex_id" varchar(255);--> statement-breakpoint
ALTER TABLE "platform_ops_runs" ADD CONSTRAINT "platform_ops_runs_feedback_id_platform_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."platform_feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_ai_costs" ADD CONSTRAINT "runtime_ai_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_ai_costs" ADD CONSTRAINT "runtime_ai_costs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_known_issue_registry_status" ON "known_issue_registry" USING btree ("fix_status");--> statement-breakpoint
CREATE INDEX "idx_platform_ops_runs_feedback" ON "platform_ops_runs" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "idx_platform_ops_runs_status" ON "platform_ops_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_platform_ops_runs_role_phase" ON "platform_ops_runs" USING btree ("agent_role","phase");--> statement-breakpoint
CREATE INDEX "idx_runtime_ai_costs_company" ON "runtime_ai_costs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_ai_costs_task" ON "runtime_ai_costs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_user" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_jti" ON "user_sessions" USING btree ("jti");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_credit_ledger_idempotency" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_status" ON "platform_feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_source_status" ON "platform_feedback" USING btree ("source","status");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_area" ON "platform_feedback" USING btree ("area");--> statement-breakpoint
CREATE INDEX "idx_platform_feedback_fingerprint" ON "platform_feedback" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_tasks_claim" ON "tasks" USING btree ("status","lease_expires_at");--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "company_stage";--> statement-breakpoint
ALTER TABLE "night_shift_cycles" DROP COLUMN "company_stage";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_openai_codex_id_unique" UNIQUE("openai_codex_id");