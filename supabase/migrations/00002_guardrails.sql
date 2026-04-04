-- Baljia AI — Guardrails Migration
-- Fixes: C-CREDIT-001 (atomic deduction), G-BILL-002 (trial expiration trigger)

-- ============================================
-- C-CREDIT-001: Atomic credit deduction
-- Eliminates check-then-act race condition
-- ============================================
CREATE OR REPLACE FUNCTION deduct_credit_atomic(
  p_company_id UUID,
  p_amount INTEGER,
  p_task_id UUID,
  p_description TEXT
) RETURNS JSON AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Lock the company's ledger row to prevent concurrent modifications
  SELECT COALESCE(
    (SELECT balance_after FROM credit_ledger
     WHERE company_id = p_company_id
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE),
    0
  ) INTO v_current_balance;

  -- Check sufficient balance
  IF v_current_balance < p_amount THEN
    RETURN json_build_object('success', false, 'new_balance', v_current_balance, 'reason', 'insufficient_credits');
  END IF;

  v_new_balance := v_current_balance - p_amount;

  -- Insert ledger entry atomically
  INSERT INTO credit_ledger (company_id, entry_type, amount, balance_after, task_id, description)
  VALUES (p_company_id, 'task_deduction', -p_amount, v_new_balance, p_task_id, p_description);

  RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- G-BILL-002: Trial expiration trigger
-- Automatically expires trials after 14 days
-- Call via: SELECT expire_stale_trials();
-- Should be run by a cron job (e.g., pg_cron or external scheduler)
-- ============================================
CREATE OR REPLACE FUNCTION expire_stale_trials()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE companies
  SET lifecycle = 'trial_expired',
      execution_state = 'suspended',
      updated_at = now()
  WHERE lifecycle = 'trial_active'
    AND created_at < (now() - interval '14 days')
    AND id NOT IN (
      SELECT DISTINCT company_id FROM subscriptions
      WHERE status IN ('active', 'past_due')
      AND company_id IS NOT NULL
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
