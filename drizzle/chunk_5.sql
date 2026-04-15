CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"artifact_type" varchar(50) NOT NULL,
	"content_ref" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);