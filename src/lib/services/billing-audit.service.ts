// Billing Credit Auditor — ledger anomaly detection (SPEC-OPS-001)
// Runs as a daily cron via platform-ops route.
// Scans credit_ledger for phantom charges, double charges, negative balances, missing refunds.

import { db, creditLedger, tasks as tasksTable, companies } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingAudit');

export interface AuditAnomaly {
  type: 'phantom_charge' | 'double_charge' | 'negative_balance' | 'missing_refund';
  severity: 'warning' | 'critical';
  details: Record<string, unknown>;
}

export interface AuditReport {
  phantom_charges: AuditAnomaly[];
  double_charges: AuditAnomaly[];
  negative_balances: AuditAnomaly[];
  missing_refunds: AuditAnomaly[];
  total_anomalies: number;
  audited_at: string;
}

export async function auditCredits(): Promise<AuditReport> {
  const phantom_charges: AuditAnomaly[] = [];
  const double_charges: AuditAnomaly[] = [];
  const negative_balances: AuditAnomaly[] = [];
  const missing_refunds: AuditAnomaly[] = [];

  // 1. Phantom charges: deductions referencing a task_id that has no execution record
  try {
    const phantoms = await db.execute(sql`
      SELECT cl.id, cl.task_id, cl.company_id, cl.amount
      FROM credit_ledger cl
      WHERE cl.entry_type = 'deduction'
        AND cl.task_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM tasks t WHERE t.id = cl.task_id
        )
      LIMIT 50
    `);
    for (const row of phantoms.rows ?? []) {
      phantom_charges.push({
        type: 'phantom_charge',
        severity: 'critical',
        details: { ledger_id: row.id, task_id: row.task_id, company_id: row.company_id, amount: row.amount },
      });
    }
  } catch (e) {
    log.warn('Phantom charge check failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  // 2. Double charges: same task_id appears in deductions more than once
  try {
    const doubles = await db.execute(sql`
      SELECT task_id, COUNT(*) as charge_count, SUM(amount) as total_deducted
      FROM credit_ledger
      WHERE entry_type = 'deduction'
        AND task_id IS NOT NULL
      GROUP BY task_id
      HAVING COUNT(*) > 1
      LIMIT 50
    `);
    for (const row of doubles.rows ?? []) {
      double_charges.push({
        type: 'double_charge',
        severity: 'critical',
        details: { task_id: row.task_id, charge_count: row.charge_count, total_deducted: row.total_deducted },
      });
    }
  } catch (e) {
    log.warn('Double charge check failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  // 3. Negative balances: companies where latest balance_after < 0
  try {
    const negatives = await db.execute(sql`
      SELECT DISTINCT ON (company_id) company_id, balance_after
      FROM credit_ledger
      ORDER BY company_id, created_at DESC
    `);
    for (const row of negatives.rows ?? []) {
      if (typeof row.balance_after === 'number' && row.balance_after < 0) {
        negative_balances.push({
          type: 'negative_balance',
          severity: 'critical',
          details: { company_id: row.company_id, balance: row.balance_after },
        });
      }
    }
  } catch (e) {
    log.warn('Negative balance check failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  // 4. Missing refunds: failed tasks where no refund ledger entry exists
  try {
    const missingRefunds = await db.execute(sql`
      SELECT t.id as task_id, t.company_id, t.title
      FROM tasks t
      WHERE t.status = 'failed'
        AND t.source = 'system'
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger cl
          WHERE cl.task_id = t.id AND cl.entry_type = 'refund'
        )
        AND EXISTS (
          SELECT 1 FROM credit_ledger cl
          WHERE cl.task_id = t.id AND cl.entry_type = 'deduction'
        )
      LIMIT 50
    `);
    for (const row of missingRefunds.rows ?? []) {
      missing_refunds.push({
        type: 'missing_refund',
        severity: 'warning',
        details: { task_id: row.task_id, company_id: row.company_id, title: row.title },
      });
    }
  } catch (e) {
    log.warn('Missing refund check failed', { error: e instanceof Error ? e.message : 'unknown' });
  }

  const total_anomalies = phantom_charges.length + double_charges.length + negative_balances.length + missing_refunds.length;

  if (total_anomalies > 0) {
    log.warn('Billing audit found anomalies', {
      phantom: phantom_charges.length,
      double: double_charges.length,
      negative: negative_balances.length,
      refund: missing_refunds.length,
    });
  } else {
    log.info('Billing audit clean — no anomalies');
  }

  return {
    phantom_charges,
    double_charges,
    negative_balances,
    missing_refunds,
    total_anomalies,
    audited_at: new Date().toISOString(),
  };
}
