ALTER TABLE "promo_video_jobs"
  ADD COLUMN IF NOT EXISTS "visual_mode" varchar(50) DEFAULT 'actual_site' NOT NULL,
  ADD COLUMN IF NOT EXISTS "ai_usage" jsonb;
