CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" varchar(50) NOT NULL,
	"title" varchar(500),
	"content" text,
	"source" varchar(50),
	"version" integer DEFAULT 1,
	"is_empty" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);