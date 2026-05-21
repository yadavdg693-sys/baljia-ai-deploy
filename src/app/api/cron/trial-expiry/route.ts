// Trial Expiry Cron — calls expire_stale_trials() PG function, then tears down
// each newly-expired trial's live Render app while preserving the GitHub repo.
// Frequency: daily (0 3 * * *)
// Auth: x-cron-secret header required

import { NextRequest, NextResponse } from 'next/server';
import { db, companies } from '@/lib/db';
import { sql, eq, and, isNotNull } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { archiveExpiredTrialApp } from '@/lib/services/trial-paid-migration.service';

const log = createLogger('Cron:TrialExpiry');

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const cronSecret = request.headers.get('x-cron-secret');
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Flip lifecycle/execution_state for trials whose trial_ends_at has passed.
    //    expire_stale_trials() is the existing PG function that handles this.
    const expireResult = await db.execute(sql`SELECT expire_stale_trials()`);

    // 2. Past-due billing → suspend.
    const pastDue = await db.execute(sql`
      UPDATE companies SET
        lifecycle = 'suspended_billing',
        execution_state = 'suspended'
      WHERE billing_state = 'past_due'
        AND lifecycle NOT IN ('suspended_billing', 'archived', 'deleted')
      RETURNING id, slug
    `);

    // 3. Find companies that just transitioned to trial_expired and still have
    //    a hosting_state of 'live' — these are the ones we need to archive.
    //    (If hosting_state is already 'suspended' / 'archived', archival
    //    already ran or never had a Worker.)
    const newlyExpired = await db
      .select({ id: companies.id, slug: companies.slug })
      .from(companies)
      .where(and(
        eq(companies.lifecycle, 'trial_expired'),
        eq(companies.hosting_state, 'live'),
        isNotNull(companies.slug),
      ))
      .limit(50);  // bound the cron's work — leftover trials get picked up next day

    log.info('Trial expiry cron — companies to archive', { count: newlyExpired.length });

    let archived = 0;
    let archiveFailed = 0;
    const archiveDetails: Array<{ companyId: string; slug: string; ok: boolean; reason?: string }> = [];
    for (const c of newlyExpired) {
      try {
        const result = await archiveExpiredTrialApp(c.id);
        if (result.success) {
          archived++;
          archiveDetails.push({ companyId: c.id, slug: c.slug ?? '?', ok: true });
        } else {
          archiveFailed++;
          archiveDetails.push({ companyId: c.id, slug: c.slug ?? '?', ok: false, reason: result.reason });
          log.warn('Archive failed for company', { companyId: c.id, reason: result.reason });
        }
      } catch (err) {
        archiveFailed++;
        archiveDetails.push({ companyId: c.id, slug: c.slug ?? '?', ok: false, reason: err instanceof Error ? err.message : String(err) });
        log.error('Archive threw for company', { companyId: c.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const expiredCount = expireResult.rows?.length ?? 0;
    const pastDueCount = pastDue.rows?.length ?? 0;

    log.info('Trial expiry cron completed', {
      expiredCount,
      pastDueCount,
      archiveAttempted: newlyExpired.length,
      archived,
      archiveFailed,
    });

    return NextResponse.json({
      ok: true,
      expired_trials: expiredCount,
      suspended_billing: pastDueCount,
      archived,
      archive_failed: archiveFailed,
      archive_details: archiveDetails,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Trial expiry cron failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cron failed' },
      { status: 500 }
    );
  }
}
