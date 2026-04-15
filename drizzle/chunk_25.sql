CREATE TABLE "platform_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'medium',
	"status" text DEFAULT 'open',
	"created_at" timestamp with time zone DEFAULT now()
);