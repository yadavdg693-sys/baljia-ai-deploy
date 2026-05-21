ALTER TABLE "promo_video_jobs"
  ADD COLUMN IF NOT EXISTS "preview_key" text,
  ADD COLUMN IF NOT EXISTS "preview_url" text,
  ADD COLUMN IF NOT EXISTS "audio_key" text,
  ADD COLUMN IF NOT EXISTS "audio_url" text;
