// Final stages — diagnostics flush + completion status + public event

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import * as eventService from '@/lib/services/event.service';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingCelebrate');

export async function flushDiagnostics(ctx: PipelineContext): Promise<void> {
  const elapsed = Date.now() - ctx.startedAt;
  log.info('Onboarding complete', {
    companyId: ctx.companyId,
    journey: ctx.journey,
    strategy: ctx.strategy,
    companyName: ctx.companyName,
    elapsedMs: elapsed,
  });
}

export async function celebrate(ctx: PipelineContext): Promise<void> {
  await db.update(companies)
    .set({ onboarding_status: 'completed' })
    .where(eq(companies.id, ctx.companyId));

  await eventService.emit(
    ctx.companyId,
    'onboarding_completed',
    {
      company_name: ctx.companyName,
      journey: ctx.journey,
      strategy: ctx.strategy,
      one_liner: ctx.oneLiner,
      slug: ctx.slug,
      trial_days: 3,
      trial_credits: 10,
      trial_night_shifts: 3,
    },
    true,
  );
}
