-- Migration 00007: Schema drift fixes
-- Resolves runtime-vs-schema mismatches identified in docs/FULL_REPO_AUDIT_2026-04-08.md.
-- All changes are additive / reconciling; no data is destroyed.

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: subscriptions.plan_type CHECK constraint
-- 00001 allowed ('trial','full','keep_live'); 00003 tried to update the wrong
-- column name (plan_tier) on this table, so the constraint was never updated.
-- billing.service.ts writes 'starter'/'growth'/'scale' → currently violates CHECK.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE subscriptions SET plan_type = 'starter' WHERE plan_type IN ('full', 'keep_live');

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_type_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_type_check
    CHECK (plan_type IN ('trial', 'starter', 'growth', 'scale'));

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: companies.company_email
-- Runtime (company-email.service.ts, schema.ts, types/index.ts) reads/writes
-- this column but it was never added to the migrations.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_email VARCHAR(255);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: email_threads — rename content → body, add external_id
-- Drizzle schema uses `body` and `external_id`; SQL had `content` and no external_id.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_threads' AND column_name = 'content'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_threads' AND column_name = 'body'
  ) THEN
    ALTER TABLE email_threads RENAME COLUMN content TO body;
  END IF;
END $$;

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_email_threads_external_id
  ON email_threads(external_id) WHERE external_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4: ad_campaigns — add external_id, platform, spend; convert placements to jsonb
-- Drizzle schema has these columns; original SQL did not.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS platform    VARCHAR(50) DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS spend       DECIMAL(10, 2) DEFAULT 0;

-- Convert placements VARCHAR[] → JSONB (runtime uses jsonb().$type<string[]>())
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_campaigns'
      AND column_name = 'placements'
      AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE ad_campaigns
      ALTER COLUMN placements TYPE JSONB
      USING COALESCE(to_jsonb(placements), '[]'::jsonb);
  END IF;
END $$;
