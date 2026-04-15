CREATE TABLE "memory_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"layer" integer NOT NULL,
	"content" text,
	"token_count" integer DEFAULT 0,
	"max_tokens" integer NOT NULL,
	"version" integer DEFAULT 1,
	"updated_at" timestamp with time zone DEFAULT now()
);