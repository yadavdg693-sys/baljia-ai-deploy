ALTER TABLE "platform_feedback" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN IF NOT EXISTS "area" text;
--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN IF NOT EXISTS "fingerprint" text;
--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN IF NOT EXISTS "occurrence_count" integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "platform_feedback" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone DEFAULT now();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_feedback_source_status" ON "platform_feedback" USING btree ("source","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_feedback_area" ON "platform_feedback" USING btree ("area");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_feedback_fingerprint" ON "platform_feedback" USING btree ("fingerprint");
