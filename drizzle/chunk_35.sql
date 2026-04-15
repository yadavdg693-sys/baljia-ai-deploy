CREATE TABLE "task_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" integer NOT NULL,
	"execution_mode" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'running',
	"turn_count" integer DEFAULT 0,
	"max_turns" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"wall_clock_seconds" integer,
	"token_usage" jsonb,
	"error_summary" text,
	"watchdog_events" jsonb,
	"verification_evidence" jsonb,
	"execution_log" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);