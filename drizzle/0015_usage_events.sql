CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" varchar(255),
  "app_slug" varchar(255) NOT NULL,
  "package_name" varchar(255) NOT NULL,
  "feature" varchar(255) NOT NULL,
  "units" integer DEFAULT 1,
  "cost_usd" numeric(12, 6) DEFAULT '0',
  "status" varchar(50) NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE "usage_events"
  ADD CONSTRAINT "usage_events_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE no action ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "idx_usage_events_company" ON "usage_events" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_usage_events_company_created" ON "usage_events" ("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_usage_events_package" ON "usage_events" ("package_name");
