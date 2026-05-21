CREATE TABLE IF NOT EXISTS "promo_video_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL,
  "status" varchar(50) DEFAULT 'queued' NOT NULL,
  "goal" varchar(50) NOT NULL,
  "duration_seconds" integer NOT NULL,
  "aspect_ratio" varchar(20) NOT NULL,
  "style" varchar(50) NOT NULL,
  "voice_mode" varchar(50) NOT NULL,
  "cta" text,
  "brief" jsonb,
  "storyboard" jsonb,
  "capture_assets" jsonb,
  "output_key" text,
  "output_url" text,
  "thumbnail_key" text,
  "thumbnail_url" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_promo_video_jobs_company" ON "promo_video_jobs" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_promo_video_jobs_task" ON "promo_video_jobs" ("task_id");
CREATE INDEX IF NOT EXISTS "idx_promo_video_jobs_status" ON "promo_video_jobs" ("status");
CREATE INDEX IF NOT EXISTS "idx_promo_video_jobs_company_created" ON "promo_video_jobs" ("company_id", "created_at");
