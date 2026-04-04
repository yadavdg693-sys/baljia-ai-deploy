-- Migration 00003: Align plan_tier and onboarding_status constraints
-- plan_tier changes: free/full/keep_live → starter/growth/scale
-- onboarding_status changes: add 'running' and 'failed' states

-- ─── companies.plan_tier ──────────────────────────────────────────────────────
-- Update existing values before changing constraint
UPDATE companies SET plan_tier = 'trial'   WHERE plan_tier IN ('free');
UPDATE companies SET plan_tier = 'starter' WHERE plan_tier IN ('full');
UPDATE companies SET plan_tier = 'starter' WHERE plan_tier IN ('keep_live');

ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_plan_tier_check;

ALTER TABLE companies
  ADD CONSTRAINT companies_plan_tier_check
    CHECK (plan_tier IN ('trial', 'starter', 'growth', 'scale'));

ALTER TABLE companies
  ALTER COLUMN plan_tier SET DEFAULT 'trial';

-- ─── companies.onboarding_status ─────────────────────────────────────────────
ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_onboarding_status_check;

ALTER TABLE companies
  ADD CONSTRAINT companies_onboarding_status_check
    CHECK (onboarding_status IN ('initializing', 'running', 'completed', 'failed'));

-- ─── subscriptions.plan_tier (if it has a check constraint) ──────────────────
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_tier_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_tier_check
    CHECK (plan_tier IN ('trial', 'starter', 'growth', 'scale'));
