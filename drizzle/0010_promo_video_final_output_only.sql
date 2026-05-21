UPDATE "promo_video_jobs"
SET
  "output_key" = NULL,
  "output_url" = NULL
WHERE
  "status" = 'preview_ready'
  AND "preview_url" IS NOT NULL
  AND "output_url" = "preview_url";
