// Cron: onboarding cleanup
// Sweeps stuck onboarding_status='running' rows older than 10 min.
// Marks them 'failed' so the founder can retry + so new pipeline launches aren't
// blocked by the CAS idempotency guard in onboarding/orchestrator.ts.
// Runs every 5 minutes.
// Auth: CRON_SECRET header.

import { NextRequest, NextResponse } from 'next/server';
import { db, companies } from '@/lib/db';
import { eq, and, lt, sql } from 'drizzle-orm';
import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('CronOnboardingCleanup');
const STALE_THRESHOLD_MINUTES = 10;

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const staleSince = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  // Find stuck 'running' rows — updated_at is the best heartbeat we have
  // (orchestrator updates it on first CAS; later stages re-update via db writes).
  const stuck = await db.select({ id: companies.id, updated_at: companies.updated_at })
    .from(companies)
    .where(and(
      eq(companies.onboarding_status, 'running'),
      lt(companies.updated_at, staleSince),
    ));

  if (stuck.length === 0) {
    return NextResponse.json({ cleaned: 0, ids: [] });
  }

  log.warn('Sweeping stuck onboarding rows', {
    count: stuck.length,
    thresholdMinutes: STALE_THRESHOLD_MINUTES,
  });

  const ids = stuck.map((s) => s.id);

  // Atomic update — only flips rows that are still in 'running' state (guards
  // against a race where a pipeline resumes mid-sweep and legitimately flips
  // the row back to non-running).
  await db.execute(sql`
    UPDATE companies
    SET onboarding_status = 'failed', updated_at = NOW()
    WHERE id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'::uuid`).join(',')}]`)})
      AND onboarding_status = 'running'
      AND updated_at < ${staleSince}
  `);

  // Emit onboarding_failed for each stuck row so frontend + downstream consumers
  // (e.g. email retry, support triage) know the cleanup happened.
  for (const id of ids) {
    await eventService.emit(id, 'onboarding_failed', {
      error: `Pipeline stuck >${STALE_THRESHOLD_MINUTES}min — cleaned up by cron`,
      reason: 'stuck_watchdog_miss',
    }).catch((err) => {
      log.error('Failed to emit onboarding_failed after cleanup', { companyId: id }, err);
    });
  }

  return NextResponse.json({ cleaned: ids.length, ids });
}
