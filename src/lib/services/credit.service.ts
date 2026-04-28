// Credit Service — migrated to Drizzle + Neon
import { db, creditLedger, platformEvents, subscriptions, tasks as tasksTable } from '@/lib/db';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { LedgerEntryType, PlanTier } from '@/types';

const log = createLogger('Credit');

// G-FIN-001: Per-plan daily spend caps (replaces hardcoded 20)
// Trial cap was 10 — tightened to 3 because each task is ~$0.10-1.00 in LLM
// tokens, and 10 trials × 3 days × ~$0.50/task = ~$15/founder = bleed at 50
// trials. 3/day caps the worst case at ~$5/founder over the 3-day trial.
const PLAN_SPEND_CAPS: Record<PlanTier, number> = {
  trial: 3,
  starter: 30,
  growth: 75,
  scale: 200,
};
const DEFAULT_SPEND_CAP = 20; // Fallback if plan tier unavailable
const LOW_BALANCE_THRESHOLD = 5;

/**
 * Look up a company's plan tier from its subscription.
 * Returns 'trial' if no active subscription found.
 */
async function getCompanyPlanTier(companyId: string): Promise<PlanTier> {
  try {
    const [sub] = await db.select({ plan_type: subscriptions.plan_type })
      .from(subscriptions)
      .where(and(eq(subscriptions.company_id, companyId), eq(subscriptions.status, 'active')))
      .limit(1);
    return (sub?.plan_type as PlanTier) ?? 'trial';
  } catch {
    return 'trial';
  }
}

/**
 * Get credit balance scoped to current billing period.
 * Credits don't roll over between billing periods (spec invariant).
 */
export async function getBalance(companyId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(SUM(cl.amount), 0)::int AS total
    FROM credit_ledger cl
    LEFT JOIN subscriptions s
      ON s.company_id = cl.company_id AND s.status = 'active'
    WHERE cl.company_id = ${companyId}
      AND (s.id IS NULL OR s.current_period_start IS NULL
           OR cl.created_at >= s.current_period_start)
  `);

  const rows = result.rows ?? [];
  return (rows[0] as { total: number })?.total ?? 0;
}

/**
 * Atomic claim-and-charge: checks company slot, claims task, checks daily cap,
 * and deducts credit — all in a single SQL statement. No partial failure windows.
 *
 * This replaces the previous separate calls to:
 * - worker-launcher slot check (SELECT for in_progress tasks)
 * - taskService.startTask()
 * - creditService.deductCredit()
 */
export async function claimSlotAndCharge(params: {
  companyId: string;
  taskId: string;
  amount: number;
  description: string;
}): Promise<{ success: boolean; reason?: 'slot_occupied' | 'insufficient_credits' | 'daily_cap' | 'task_not_todo' }> {
  const { companyId, taskId, amount, description } = params;
  if (amount <= 0) throw new Error('Charge amount must be positive');

  const planTier = await getCompanyPlanTier(companyId);
  const dailyCap = PLAN_SPEND_CAPS[planTier] ?? DEFAULT_SPEND_CAP;
  const today = new Date().toISOString().split('T')[0];
  const idempotencyKey = `deduct:${taskId}:${today}`;

  // Single CTE chain: slot check → claim → cap check → balance check → deduct
  const result = await db.execute(sql`
    WITH slot_check AS (
      SELECT id FROM tasks
      WHERE company_id = ${companyId} AND status = 'in_progress'
      LIMIT 1
    ),
    claim AS (
      UPDATE tasks SET
        status = 'in_progress',
        started_at = NOW(),
        updated_at = NOW()
      WHERE id = ${taskId}
        AND status = 'todo'
        AND NOT EXISTS (SELECT 1 FROM slot_check)
      RETURNING id, company_id
    ),
    cap_check AS (
      SELECT COALESCE(SUM(ABS(amount)), 0)::int AS spent_today
      FROM credit_ledger
      WHERE company_id = ${companyId}
        AND entry_type = 'task_deduction'
        AND created_at >= ${`${today}T00:00:00Z`}::timestamptz
    ),
    balance_check AS (
      SELECT COALESCE(SUM(cl.amount), 0)::int AS balance
      FROM credit_ledger cl
      LEFT JOIN subscriptions s
        ON s.company_id = cl.company_id AND s.status = 'active'
      WHERE cl.company_id = ${companyId}
        AND (s.id IS NULL OR s.current_period_start IS NULL
             OR cl.created_at >= s.current_period_start)
    ),
    deduct AS (
      INSERT INTO credit_ledger (id, company_id, entry_type, amount, balance_after, task_id, description, idempotency_key, created_at)
      SELECT
        gen_random_uuid(),
        ${companyId},
        'task_deduction',
        ${-amount},
        balance_check.balance - ${amount},
        ${taskId},
        ${description},
        ${idempotencyKey},
        NOW()
      FROM claim, cap_check, balance_check
      WHERE claim.id IS NOT NULL
        AND balance_check.balance >= ${amount}
        AND cap_check.spent_today + ${amount} <= ${dailyCap}
      RETURNING balance_after
    )
    SELECT
      (SELECT COUNT(*) FROM slot_check)::int AS slot_busy,
      (SELECT COUNT(*) FROM claim)::int AS claimed,
      (SELECT spent_today FROM cap_check) AS spent_today,
      (SELECT balance FROM balance_check) AS balance,
      (SELECT COUNT(*) FROM deduct)::int AS deducted,
      (SELECT balance_after FROM deduct) AS balance_after
  `);

  const rows = result.rows ?? [];
  const row = rows[0] as {
    slot_busy: number; claimed: number; spent_today: number;
    balance: number; deducted: number; balance_after: number | null;
  };

  if (!row) return { success: false, reason: 'task_not_todo' };

  // Determine failure reason from the CTE results
  if (row.slot_busy > 0) {
    return { success: false, reason: 'slot_occupied' };
  }
  if (row.claimed === 0) {
    return { success: false, reason: 'task_not_todo' };
  }
  if (row.deducted === 0) {
    // Claimed but couldn't deduct — need to revert the claim
    await db.execute(sql`
      UPDATE tasks SET status = 'todo', started_at = NULL, updated_at = NOW()
      WHERE id = ${taskId} AND status = 'in_progress'
    `);
    if (row.balance < amount) {
      return { success: false, reason: 'insufficient_credits' };
    }
    return { success: false, reason: 'daily_cap' };
  }

  // Success — emit low balance warning if needed
  if (row.balance_after !== null && row.balance_after <= LOW_BALANCE_THRESHOLD) {
    await emitLowBalanceWarning(companyId, row.balance_after);
  }

  return { success: true };
}

/**
 * Atomic slot claim WITHOUT credit deduction.
 *
 * For work fueled by subscription allowance rather than founder credits —
 * i.e. night-shift cycles. Caller is responsible for consuming the correct
 * allowance (e.g. subscriptions.night_shifts_remaining) separately.
 *
 * Does the same slot-busy check + todo→in_progress transition as
 * claimSlotAndCharge, just skips the balance/cap checks and the
 * credit_ledger insert.
 */
export async function claimSlotOnly(params: {
  companyId: string;
  taskId: string;
}): Promise<{ success: boolean; reason?: 'slot_occupied' | 'task_not_todo' }> {
  const { companyId, taskId } = params;

  const result = await db.execute(sql`
    WITH slot_check AS (
      SELECT id FROM tasks
      WHERE company_id = ${companyId} AND status = 'in_progress'
      LIMIT 1
    ),
    claim AS (
      UPDATE tasks SET
        status = 'in_progress',
        started_at = NOW(),
        updated_at = NOW()
      WHERE id = ${taskId}
        AND status = 'todo'
        AND NOT EXISTS (SELECT 1 FROM slot_check)
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*) FROM slot_check)::int AS slot_busy,
      (SELECT COUNT(*) FROM claim)::int AS claimed
  `);

  const row = (result.rows ?? [])[0] as { slot_busy: number; claimed: number } | undefined;
  if (!row) return { success: false, reason: 'task_not_todo' };
  if (row.slot_busy > 0) return { success: false, reason: 'slot_occupied' };
  if (row.claimed === 0) return { success: false, reason: 'task_not_todo' };
  return { success: true };
}

/**
 * Deduct credits with per-plan daily spend cap enforcement.
 * Atomic: daily cap check + balance check + insert are in a single CTE.
 */
export async function deductCredit(
  companyId: string,
  amount: number,
  taskId: string,
  description: string
): Promise<boolean> {
  if (amount <= 0) throw new Error('Deduction amount must be positive');

  const planTier = await getCompanyPlanTier(companyId);
  const dailyCap = PLAN_SPEND_CAPS[planTier] ?? DEFAULT_SPEND_CAP;
  const today = new Date().toISOString().split('T')[0];
  const idempotencyKey = `deduct:${taskId}:${today}`;

  // Atomic: balance check + daily cap check + deduction in single CTE
  const result = await db.execute(sql`
    WITH balance_check AS (
      SELECT COALESCE(SUM(cl.amount), 0)::int AS balance
      FROM credit_ledger cl
      LEFT JOIN subscriptions s
        ON s.company_id = cl.company_id AND s.status = 'active'
      WHERE cl.company_id = ${companyId}
        AND (s.id IS NULL OR s.current_period_start IS NULL
             OR cl.created_at >= s.current_period_start)
    ),
    cap_check AS (
      SELECT COALESCE(SUM(ABS(amount)), 0)::int AS spent_today
      FROM credit_ledger
      WHERE company_id = ${companyId}
        AND entry_type = 'task_deduction'
        AND created_at >= ${`${today}T00:00:00Z`}::timestamptz
    )
    INSERT INTO credit_ledger (id, company_id, entry_type, amount, balance_after, task_id, description, idempotency_key, created_at)
    SELECT
      gen_random_uuid(),
      ${companyId},
      'task_deduction',
      ${-amount},
      balance_check.balance - ${amount},
      ${taskId},
      ${description},
      ${idempotencyKey},
      NOW()
    FROM balance_check, cap_check
    WHERE balance_check.balance >= ${amount}
      AND cap_check.spent_today + ${amount} <= ${dailyCap}
    RETURNING balance_after
  `);

  const rows = result.rows ?? [];
  if (rows.length === 0) return false;

  const balanceAfter = (rows[0] as { balance_after: number }).balance_after;

  // G-FIN-002: Low balance warning
  if (balanceAfter <= LOW_BALANCE_THRESHOLD) {
    await emitLowBalanceWarning(companyId, balanceAfter);
  }

  return true;
}

/**
 * Add credits with optional idempotency key to prevent duplicate grants.
 * Validates amount > 0.
 */
export async function addCredit(
  companyId: string,
  amount: number,
  entryType: LedgerEntryType,
  description: string,
  taskId?: string,
  idempotencyKey?: string
): Promise<void> {
  if (amount <= 0) {
    throw new Error(`addCredit amount must be positive, got ${amount}. Use deductCredit for deductions.`);
  }

  await db.execute(sql`
    WITH current AS (
      SELECT COALESCE(SUM(amount), 0)::int AS balance
      FROM credit_ledger WHERE company_id = ${companyId}
    )
    INSERT INTO credit_ledger (id, company_id, entry_type, amount, balance_after, task_id, description, idempotency_key, created_at)
    SELECT
      gen_random_uuid(),
      ${companyId},
      ${entryType},
      ${amount},
      current.balance + ${amount},
      ${taskId ?? null},
      ${description},
      ${idempotencyKey ?? null},
      NOW()
    FROM current
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING balance_after
  `);
}

export async function getLedger(companyId: string, limit = 20) {
  return db.select().from(creditLedger)
    .where(eq(creditLedger.company_id, companyId))
    .orderBy(desc(creditLedger.created_at))
    .limit(limit);
}

// G-FIN-002: Low balance warning
async function emitLowBalanceWarning(companyId: string, balance: number): Promise<void> {
  try {
    await db.insert(platformEvents).values({
      company_id: companyId,
      event_type: 'credits_depleted',
      payload: {
        balance,
        warning: balance === 0
          ? 'Credit balance is zero. Task execution paused.'
          : `Low credit balance: ${balance} remaining. Consider purchasing more.`,
        threshold: LOW_BALANCE_THRESHOLD,
      },
      is_public_safe: false,
    });
  } catch {
    log.error('Failed to emit low balance warning', { companyId });
  }
}

interface LedgerInput {
  company_id: string;
  amount: number;
  balance_after: number;
  entry_type: LedgerEntryType;
  description: string;
  task_id?: string;
}

async function writeLedgerEntry(entry: LedgerInput): Promise<void> {
  await db.insert(creditLedger).values({
    company_id: entry.company_id,
    amount: entry.amount,
    balance_after: entry.balance_after,
    entry_type: entry.entry_type,
    description: entry.description,
    task_id: entry.task_id ?? null,
  });
}

/**
 * SPEC-BILL-103: Manual-only refund for platform-fault failures.
 * Called by platform support/admin — never by the runtime automatically.
 * Creates a positive 'refund' ledger entry (idempotent per task).
 */
export async function refundCredit(
  companyId: string,
  taskId: string,
  amount: number,
  reason: string
): Promise<boolean> {
  if (amount <= 0) return false;

  // Atomic check-and-insert for refunds
  const result = await db.execute(sql`
    WITH current AS (
      SELECT COALESCE(SUM(amount), 0)::int AS balance
      FROM credit_ledger WHERE company_id = ${companyId}
    ),
    existing_refund AS (
      SELECT id FROM credit_ledger 
      WHERE company_id = ${companyId} AND task_id = ${taskId} AND entry_type = 'refund'
      LIMIT 1
    )
    INSERT INTO credit_ledger (id, company_id, entry_type, amount, balance_after, task_id, description, created_at)
    SELECT
      gen_random_uuid(),
      ${companyId},
      'refund',
      ${amount},
      current.balance + ${amount},
      ${taskId},
      ${`Refund: ${reason}`},
      NOW()
    FROM current
    WHERE NOT EXISTS (SELECT 1 FROM existing_refund)
    RETURNING balance_after
  `);

  const rows = result.rows ?? [];
  if (rows.length === 0) {
    log.warn('Refund skipped (already refunded or error)', { companyId, taskId });
    return false;
  }

  const balanceAfter = (rows[0] as { balance_after: number }).balance_after;


  log.info('Credit refunded', { companyId, taskId, amount, balanceAfter });

  await db.insert(platformEvents).values({
    company_id: companyId,
    event_type: 'credit_refunded',
    payload: { task_id: taskId, amount, reason, balance_after: balanceAfter },
    is_public_safe: false,
  });

  return true;
}
