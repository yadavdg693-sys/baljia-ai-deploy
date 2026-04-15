CREATE TABLE "document_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"task_id" uuid,
	"suggested_content" text NOT NULL,
	"reason" text,
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"reviewed_at" timestamp with time zone
);