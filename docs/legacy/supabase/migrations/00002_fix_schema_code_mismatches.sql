-- Migration 00002: Fix Schema-Code Mismatches
-- Resolves 4 critical issues where TypeScript code doesn't match DB schema.
-- These mismatches will cause runtime failures on first use.

-- ============================================
-- FIX 1: memory_layers.layer → layer_type (INT → VARCHAR)
-- Code uses: layer_type VARCHAR ('domain_knowledge', 'user_preferences', 'cross_company')
-- Schema had: layer INTEGER (1, 2, 3)
-- ============================================

-- Drop old unique index
DROP INDEX IF EXISTS idx_memory_company_layer;

-- Add new column
ALTER TABLE memory_layers ADD COLUMN layer_type VARCHAR(50);

-- Migrate existing data (1 → domain_knowledge, 2 → user_preferences, 3 → cross_company)
UPDATE memory_layers SET layer_type = CASE
  WHEN layer = 1 THEN 'domain_knowledge'
  WHEN layer = 2 THEN 'user_preferences'
  WHEN layer = 3 THEN 'cross_company'
END;

-- Set NOT NULL and CHECK constraint
ALTER TABLE memory_layers ALTER COLUMN layer_type SET NOT NULL;
ALTER TABLE memory_layers ADD CONSTRAINT chk_memory_layer_type
  CHECK (layer_type IN ('domain_knowledge', 'user_preferences', 'cross_company'));

-- Drop old column
ALTER TABLE memory_layers DROP COLUMN layer;

-- Recreate unique index on new column
CREATE UNIQUE INDEX idx_memory_company_layer ON memory_layers(company_id, layer_type);

-- ============================================
-- FIX 2: platform_events.is_public_safe → is_public
-- Code uses: is_public
-- Schema had: is_public_safe
-- ============================================

-- Drop old index
DROP INDEX IF EXISTS idx_events_public;

-- Rename column
ALTER TABLE platform_events RENAME COLUMN is_public_safe TO is_public;

-- Recreate index with new column name
CREATE INDEX idx_events_public ON platform_events(is_public, created_at DESC);

-- ============================================
-- FIX 3: credit_ledger.entry_type CHECK values
-- Align DB CHECK with TypeScript LedgerEntryType union.
-- DB had: 'monthly_grant','welcome_bonus','addon_purchase','task_deduction','refund','night_shift_deduction','referral_bonus'
-- TS has: 'monthly_grant','welcome_bonus','purchase','task_debit','refund','night_shift_deduction','referral_bonus'
-- Decision: Expand DB CHECK to accept BOTH old and new names for forward compatibility,
--           plus add 'monthly_grant' to TS types (see types/index.ts change).
-- ============================================

-- Drop old CHECK constraint (Postgres names it automatically)
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_entry_type_check;

-- Add expanded CHECK that supports both naming conventions
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_entry_type_check
  CHECK (entry_type IN (
    'monthly_grant',
    'welcome_bonus',
    'addon_purchase', 'purchase',           -- old + new
    'task_deduction', 'task_debit',         -- old + new
    'refund',
    'night_shift_deduction',
    'referral_bonus'
  ));

-- ============================================
-- FIX 4: credit_ledger.balance_after — make NULLABLE for MVP
-- The code doesn't compute balance_after on writes. Long-term fix is
-- a Postgres function, but for MVP safety, allow NULL and compute via
-- get_credit_balance() which already reads sum(amount).
-- ============================================

-- Allow NULL for balance_after (code will populate it; function still works)
ALTER TABLE credit_ledger ALTER COLUMN balance_after DROP NOT NULL;

-- Update get_credit_balance to use SUM(amount) instead of latest balance_after
-- This is more resilient and doesn't depend on balance_after being set.
CREATE OR REPLACE FUNCTION get_credit_balance(p_company_id UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(
    (SELECT SUM(amount)::INTEGER FROM credit_ledger
     WHERE company_id = p_company_id),
    0
  );
$$ LANGUAGE sql STABLE;

-- ============================================
-- FIX 1 (continued): Update trigger to use new column name
-- ============================================

CREATE OR REPLACE FUNCTION create_core_documents()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO documents (company_id, doc_type, title, is_empty) VALUES
    (NEW.id, 'mission', 'Mission', true),
    (NEW.id, 'product_overview', 'Product Overview', true),
    (NEW.id, 'tech_notes', 'Tech Notes', true),
    (NEW.id, 'brand_voice', 'Brand Voice', true),
    (NEW.id, 'user_research', 'User Research', true);

  -- Create 3 memory layers using new column name
  INSERT INTO memory_layers (company_id, layer_type, max_tokens) VALUES
    (NEW.id, 'domain_knowledge', 15000),
    (NEW.id, 'user_preferences', 3000),
    (NEW.id, 'cross_company', 15000);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
