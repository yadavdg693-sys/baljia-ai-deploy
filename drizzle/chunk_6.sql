CREATE TABLE "browser_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_domain" varchar(255) NOT NULL,
	"site_tier" integer DEFAULT 3,
	"username" varchar(255),
	"password_encrypted" text,
	"browser_context_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now()
);