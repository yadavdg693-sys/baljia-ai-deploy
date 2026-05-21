CREATE TABLE IF NOT EXISTS "agent_run_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "sequence" integer NOT NULL,
  "turn" integer,
  "event_type" varchar(80) NOT NULL,
  "provider" varchar(50),
  "tool_name" varchar(120),
  "status" varchar(50),
  "message" text,
  "input" jsonb,
  "output" jsonb,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "turn" integer,
  "role" varchar(40) NOT NULL,
  "provider" varchar(50),
  "content" text,
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "turn" integer,
  "tool_name" varchar(120) NOT NULL,
  "input" jsonb,
  "result" text,
  "status" varchar(50) DEFAULT 'completed' NOT NULL,
  "metadata" jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_gate_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "gate_name" varchar(100) NOT NULL,
  "status" varchar(50) NOT NULL,
  "reason" text,
  "evidence" jsonb,
  "turn" integer,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_provider_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "provider" varchar(50) NOT NULL,
  "model" varchar(120),
  "status" varchar(50) NOT NULL,
  "error" text,
  "latency_ms" integer,
  "token_usage" jsonb,
  "cost_usd" numeric(10, 6),
  "metadata" jsonb,
  "started_at" timestamp with time zone DEFAULT now(),
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_verification_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "verifier" varchar(100) NOT NULL,
  "level" varchar(50),
  "passed" boolean NOT NULL,
  "summary" text,
  "checks" jsonb,
  "evidence" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_subagent_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "role" varchar(50) NOT NULL,
  "status" varchar(50) DEFAULT 'completed' NOT NULL,
  "output" jsonb,
  "cannot_complete_task" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_patch_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "starting_commit" varchar(80),
  "last_good_commit" varchar(80),
  "task_commit_range" varchar(180),
  "failed_commit" varchar(80),
  "rollback_available" boolean DEFAULT false NOT NULL,
  "rollback_confidence" varchar(50),
  "patch_summary" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run_controls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid,
  "task_id" uuid NOT NULL,
  "execution_id" uuid,
  "action" varchar(80) NOT NULL,
  "status" varchar(50) DEFAULT 'requested' NOT NULL,
  "requested_by" varchar(120),
  "reason" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "handled_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_messages" ADD CONSTRAINT "agent_run_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_messages" ADD CONSTRAINT "agent_run_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_messages" ADD CONSTRAINT "agent_run_messages_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_gate_decisions" ADD CONSTRAINT "agent_gate_decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_gate_decisions" ADD CONSTRAINT "agent_gate_decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_gate_decisions" ADD CONSTRAINT "agent_gate_decisions_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_provider_attempts" ADD CONSTRAINT "agent_provider_attempts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_provider_attempts" ADD CONSTRAINT "agent_provider_attempts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_provider_attempts" ADD CONSTRAINT "agent_provider_attempts_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_verification_results" ADD CONSTRAINT "agent_verification_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_verification_results" ADD CONSTRAINT "agent_verification_results_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_verification_results" ADD CONSTRAINT "agent_verification_results_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_subagent_outputs" ADD CONSTRAINT "agent_subagent_outputs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_subagent_outputs" ADD CONSTRAINT "agent_subagent_outputs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_subagent_outputs" ADD CONSTRAINT "agent_subagent_outputs_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_patch_checkpoints" ADD CONSTRAINT "agent_patch_checkpoints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_patch_checkpoints" ADD CONSTRAINT "agent_patch_checkpoints_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_patch_checkpoints" ADD CONSTRAINT "agent_patch_checkpoints_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_controls" ADD CONSTRAINT "agent_run_controls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_controls" ADD CONSTRAINT "agent_run_controls_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_run_controls" ADD CONSTRAINT "agent_run_controls_execution_id_task_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "task_executions"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_events_run" ON "agent_run_events" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_events_task" ON "agent_run_events" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_events_execution" ON "agent_run_events" USING btree ("execution_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_events_type" ON "agent_run_events" USING btree ("event_type");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_run_events_execution_sequence" ON "agent_run_events" USING btree ("execution_id","sequence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_messages_run" ON "agent_run_messages" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_messages_task" ON "agent_run_messages" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_tool_calls_run" ON "agent_tool_calls" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_tool_calls_task" ON "agent_tool_calls" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_tool_calls_name" ON "agent_tool_calls" USING btree ("tool_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_gate_decisions_run" ON "agent_gate_decisions" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_gate_decisions_task" ON "agent_gate_decisions" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_gate_decisions_gate" ON "agent_gate_decisions" USING btree ("gate_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_provider_attempts_run" ON "agent_provider_attempts" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_provider_attempts_task" ON "agent_provider_attempts" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_provider_attempts_provider" ON "agent_provider_attempts" USING btree ("provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_verification_results_run" ON "agent_verification_results" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_verification_results_task" ON "agent_verification_results" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_verification_results_passed" ON "agent_verification_results" USING btree ("passed");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_subagent_outputs_run" ON "agent_subagent_outputs" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_subagent_outputs_task" ON "agent_subagent_outputs" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_subagent_outputs_role" ON "agent_subagent_outputs" USING btree ("role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_patch_checkpoints_run" ON "agent_patch_checkpoints" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_patch_checkpoints_task" ON "agent_patch_checkpoints" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_controls_run" ON "agent_run_controls" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_controls_task" ON "agent_run_controls" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_run_controls_status" ON "agent_run_controls" USING btree ("status");
