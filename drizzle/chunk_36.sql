CREATE TABLE "task_failure_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"fingerprint_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);