CREATE TABLE "provider_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" varchar(100) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"category" varchar(50) NOT NULL,
	"signup_url" varchar(500) NOT NULL,
	"api_key_url" varchar(500),
	"steps" jsonb NOT NULL,
	"api_key_env_var" varchar(100),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "provider_packs_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE INDEX "idx_provider_packs_category" ON "provider_packs" USING btree ("category");