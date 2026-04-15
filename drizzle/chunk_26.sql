CREATE TABLE "recurring_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"tag" varchar(50) NOT NULL,
	"priority" integer DEFAULT 0,
	"cadence" varchar(50) NOT NULL,
	"monthly_credits_estimate" integer,
	"is_active" boolean DEFAULT true,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);