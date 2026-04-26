// Cron: Nightly night shift runner
// Called by Render cron or Upstash QStash at a set schedule (e.g. 2am UTC)
// Auth: CRON_SECRET header (prevents unauthorized triggers)

import { NextRequest, NextResponse } from 'next/server';
import { db, companies, subscriptions } from '@/lib/db';
import { eq, and, gt, inArray } from 'drizzle-orm';
import { runNightShift } from '@/lib/services/night-shift.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('CronNightShift');

export async function POST(request: NextRequest) {
  // Verify cron secret
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get all active companies eligible for night shift.
  // Gates:
  //   1. Lifecycle is trial_active or full_active (no keep_live_active grace)
  //   2. Execution is not suspended
  //   3. An active subscription exists with night_shifts_remaining > 0
  // Night shifts are subscription-funded — no subscription or no remaining
  // allowance means the company is skipped entirely for this cycle.
  let companyRows: { id: string }[];
  try {
    companyRows = await db.select({ id: companies.id })
      .from(companies)
      .innerJoin(subscriptions, eq(subscriptions.company_id, companies.id))
      .where(and(
        inArray(companies.lifecycle, ['trial_active', 'full_active']),
        eq(companies.execution_state, 'active'),
        eq(subscriptions.status, 'active'),
        gt(subscriptions.night_shifts_remaining, 0),
      ));
  } catch (err) {
    log.error('Failed to fetch companies', {}, err);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const companyIds = companyRows.map((c) => c.id);
  log.info('Starting cron night shift', { companies: companyIds.length });

  const results: Array<{ companyId: string; status: 'ok' | 'error'; summary?: string; error?: string }> = [];

  // Run night shifts sequentially to avoid overwhelming the system
  for (const companyId of companyIds) {
    try {
      const cycle = await runNightShift(companyId);
      results.push({
        companyId,
        status: 'ok',
        summary: cycle.summary?.substring(0, 200),
      });
    } catch (err) {
      log.error('Night shift failed for company', { companyId }, err);
      results.push({
        companyId,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const failed = results.filter((r) => r.status === 'error').length;

  log.info('Cron night shift complete', { ok, failed });

  return NextResponse.json({
    ok: true,
    companies_processed: companyIds.length,
    succeeded: ok,
    failed,
    results,
  });
}
