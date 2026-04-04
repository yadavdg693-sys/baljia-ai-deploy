// Cron: Recurring task tick
// Called hourly to check for and create due recurring tasks
// Auth: CRON_SECRET header

import { NextRequest, NextResponse } from 'next/server';
import { db, companies } from '@/lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { processDueRecurring } from '@/lib/services/recurring.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('CronRecurring');

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const companyRows = await db.select({ id: companies.id }).from(companies)
    .where(and(
      inArray(companies.lifecycle, ['trial_active', 'full_active', 'keep_live_active']),
      eq(companies.execution_state, 'active')
    ));

  const companyIds = companyRows.map((c) => c.id);
  log.info('Recurring tick', { companies: companyIds.length });

  let totalCreated = 0;

  for (const companyId of companyIds) {
    try {
      const created = await processDueRecurring(companyId);
      totalCreated += created;
    } catch (err) {
      log.error('Recurring tick failed for company', { companyId }, err);
    }
  }

  return NextResponse.json({ ok: true, companies: companyIds.length, tasks_created: totalCreated });
}
