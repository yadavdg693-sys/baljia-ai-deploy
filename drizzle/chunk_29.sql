CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid,
	"title" varchar(500),
	"content" text,
	"report_type" varchar(50),
	"structured_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);