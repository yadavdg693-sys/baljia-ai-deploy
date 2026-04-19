// Onboarding orchestrator — entry point replacing runOnboardingPipeline
// Responsibilities:
//   1. Atomic CAS idempotency claim (prevents double-run)
//   2. Build initial PipelineContext
//   3. Select strategy by journey
//   4. Execute strategy.run()
//   5. Top-level error handling → mark onboarding_status = 'failed'
// Phase 2 will add watchdog lifecycle here.

import { db, companies } from '@/lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import * as eventService from '@/lib/services/event.service';
import type { OnboardingJourney } from '@/types';
import type { PipelineContext } from './types';
import type { OnboardingStrategy } from './strategies/base.strategy';
import { BuildIdeaStrategy } from './strategies/build-idea.strategy';
import { GrowCompanyStrategy } from './strategies/grow-company.strategy';
import { SurpriseMeStrategy } from './strategies/surprise-me.strategy';

const log = createLogger('Onboarding');

export interface RunOnboardingArgs {
  companyId: string;
  userId: string;
  journey: OnboardingJourney;
  input: string | undefined;
  requestIp?: string | null;
  browserTimezone?: string | null;
  browserLocale?: string | null;
  userAgent?: string | null;
}

export async function runOnboardingPipeline(
  companyId: string,
  userId: string,
  journey: OnboardingJourney,
  input: string | undefined,
  requestIp: string | null = null,
  browserTimezone: string | null = null,
  browserLocale: string | null = null,
  userAgent: string | null = null,
): Promise<void> {
  // Idempotency guard: atomic CAS to prevent duplicate pipeline runs
  const [claimed] = await db.update(companies)
    .set({ onboarding_status: 'running' })
    .where(and(
      eq(companies.id, companyId),
      inArray(companies.onboarding_status, ['initializing', 'failed']),
    ))
    .returning({ id: companies.id });

  if (!claimed) {
    log.warn('Onboarding pipeline already running or completed', { companyId });
    return;
  }

  const ctx: PipelineContext = {
    companyId,
    userId,
    journey,
    input,
    requestIp,
    browserTimezone,
    browserLocale,
    userAgent,
    founderName: null,
    founderEmail: '',
    founderEnrichment: null,
    enrichedBusinessSummary: null,
    enrichedFounderSummary: null,
    founderAngle: null,
    strategy: journey,
    companyName: 'My Company',
    slug: '',
    oneLiner: '',
    mission: '',
    marketResearch: null,
    activeMilestoneTitle: null,
    activeMilestoneTags: [],
    startedAt: Date.now(),
  };

  const strategy = selectStrategy(journey);

  try {
    await strategy.run(ctx);
  } catch (err) {
    log.error('Onboarding pipeline failed', { companyId, journey }, err);
    await db.update(companies)
      .set({ onboarding_status: 'failed' })
      .where(eq(companies.id, companyId));
    await eventService.emit(companyId, 'onboarding_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function selectStrategy(journey: OnboardingJourney): OnboardingStrategy {
  switch (journey) {
    case 'build_my_idea': return new BuildIdeaStrategy();
    case 'grow_my_company': return new GrowCompanyStrategy();
    case 'surprise_me': return new SurpriseMeStrategy();
    default: {
      const _exhaustive: never = journey;
      throw new Error(`Unknown onboarding journey: ${_exhaustive}`);
    }
  }
}
