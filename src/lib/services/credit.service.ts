// Credit Service — migrated to Drizzle + Neon
import { db, creditLedger, platformEvents } from '@/lib/db';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { LedgerEntryType } from '@/types';

const log = createLogger('Credit');

// G-FIN-001: Daily spend cap (configurable per plan)
const DAILY_SPEND_CAP = 20;
const LOW_BALANCE_THRESHOLD = 5;

export async function getBalance(companyId: string): Promise<number> {
  const result = await db.select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.company_id, companyId));

  return result[0]?.total ?? 0;
}

/**
 * Deduct credits with daily spend cap enforcement.
 * Uses application-level check (atomic PG function can be added later).
 */
export async function deductCredit(
  companyId: string,
  amount: number,
  taskId: string,
  description: string
): Promise<boolean> {
  if (amount <= 0) throw new Error('Deduction amount must be positive');

  // G-FIN-001: Check daily spend cap
  const today = new Date().toISOString().split('T')[0];
  const dailySpend = await db.select({ amount: creditLedger.amount })
    .from(creditLedger)
    .where(and(
      eq(creditLedger.company_id, companyId),
      eq(creditLedger.entry_type, 'task_deduction'),
      gte(creditLedger.created_at, new Date(`${today}T00:00:00Z`))
    ));

  const spentToday = dailySpend.reduce((sum, e) => sum + Math.abs(e.amount), 0);

  if (spentToday + amount > DAILY_SPEND_CAP) {
    log.warn('Daily spend cap reached', { companyId, spentToday, cap: DAILY_SPEND_CAP });
    return false;
  }

  // Check balance
  const balance = await getBalance(companyId);
  if (balance < amount) return false;

  const balanceAfter = balance - amount;
  await writeLedgerEntry({
    company_id: companyId,
    amount: -amount,
    balance_after: balanceAfter,
    entry_type: 'task_deduction',
    description,
    task_id: taskId,
  });

  // G-FIN-002: Low balance warning
  if (balanceAfter <= LOW_BALANCE_THRESHOLD) {
    await emitLowBalanceWarning(companyId, balanceAfter);
  }

  return true;
}

/**
 * Add credits. Validates amount > 0.
 */
export async function addCredit(
  companyId: string,
  amount: number,
  entryType: LedgerEntryType,
  description: string,
  taskId?: string
): Promise<void> {
  if (amount <= 0) {
    throw new Error(`addCredit amount must be positive, got ${amount}. Use deductCredit for deductions.`);
  }

  const currentBalance = await getBalance(companyId);
  const balanceAfter = currentBalance + amount;

  await writeLedgerEntry({
    company_id: companyId,
    amount,
    balance_after: balanceAfter,
    entry_type: entryType,
    description,
    task_id: taskId,
  });
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
