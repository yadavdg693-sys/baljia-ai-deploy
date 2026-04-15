CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" varchar(50) DEFAULT 'running' NOT NULL,
	"agent_id" integer,
	"execution_mode" varchar(50) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"ended_at" timestamp with time zone,
	"failure_class" varchar(50),
	"turn_count" integer DEFAULT 0,
	"token_usage" jsonb,
	"wall_clock_seconds" integer,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now()
);