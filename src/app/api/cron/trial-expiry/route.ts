// Trial Expiry Cron — calls expire_stale_trials() PG function
// Intended to be called by external cron (Render cron job, Vercel cron, etc.)
// Frequency: daily
// Auth: CRON_SECRET header required

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('Cron:TrialExpiry');

export async function GET(request: NextRequest) {
  // Validate cron key to prevent unauthorized invocation
  const expected = process.env.CRON_SECRET;
  const cronSecret = request.headers.get('x-cron-secret');
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Call the PG function that handles trial expiration
    // This function sets lifecycle='trial_expired', execution_state='suspended'
    // for companies whose trial_ends_at has passed
    const result = await db.execute(sql`SELECT expire_stale_trials()`);

    // Also check for past_due subscriptions (billing lifecycle)
    const pastDue = await db.execute(sql`
      UPDATE companies SET 
        lifecycle = 'suspended_billing',
        execution_state = 'suspended'
      WHERE billing_state = 'past_due'
        AND lifecycle NOT IN ('suspended_billing', 'archived', 'deleted')
      RETURNING id, slug
    `);

    const expiredCount = result.rows?.length ?? 0;
    const pastDueCount = pastDue.rows?.length ?? 0;

    log.info('Trial expiry cron completed', { expiredCount, pastDueCount });

    return NextResponse.json({
      ok: true,
      expired_trials: expiredCount,
      suspended_billing: pastDueCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Trial expiry cron failed', {}, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cron failed' },
      { status: 500 }
    );
  }
}
