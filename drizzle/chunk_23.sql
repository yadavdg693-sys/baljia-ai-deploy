CREATE TABLE "night_shift_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_number" integer,
	"company_stage" varchar(50),
	"trust_score" numeric(3, 2),
	"planned_tasks" jsonb,
	"executed_tasks" jsonb,
	"summary" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);