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
import { initCosts, flushCosts } from './shared/cost-tracker';
import { OnboardingWatchdog } from './watchdog';

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
  // Idempotency guard: atomic CAS to prevent duplicate pipeline runs.
  // We also pull back the row's current name + slug so a resume run can
  // hydrate ctx with the values the prior run already committed (Bug 1
  // — resume must NOT regenerate a new company name/slug).
  const [claimed] = await db.update(companies)
    .set({ onboarding_status: 'running' })
    .where(and(
      eq(companies.id, companyId),
      inArray(companies.onboarding_status, ['initializing', 'failed']),
    ))
    .returning({ id: companies.id, name: companies.name, slug: companies.slug });

  if (!claimed) {
    log.warn('Onboarding pipeline already running or completed', { companyId });
    return;
  }

  // A "real" name/slug means the prior pipeline progressed past
  // provision_infrastructure. The placeholder name written by createCompany
  // is the literal string 'My Company'. Anything else is treated as the
  // founder's locked identity and must be preserved across resumes.
  const isResumeWithName =
    !!claimed.name && claimed.name !== 'My Company' && !!claimed.slug;

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
    companyName: isResumeWithName ? claimed.name : 'My Company',
    slug: isResumeWithName ? claimed.slug : '',
    oneLiner: '',
    mission: '',
    marketResearch: null,
    startedAt: Date.now(),
  };

  if (isResumeWithName) {
    log.info('Resume run — preserving existing company identity', {
      companyId,
      name: claimed.name,
      slug: claimed.slug,
    });
  }

  initCosts(ctx);

  const strategy = selectStrategy(journey);
  const watchdog = new OnboardingWatchdog(ctx);
  watchdog.start();

  try {
    await strategy.run(ctx);
    // If watchdog marked the run as killed (timeout), surface it
    watchdog.throwIfKilled();
  } catch (err) {
    log.error('Onboarding pipeline failed', { companyId, journey }, err);
    await db.update(companies)
      .set({ onboarding_status: 'failed' })
      .where(eq(companies.id, companyId));
    await eventService.emit(companyId, 'onboarding_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    watchdog.stop();
    await flushCosts(ctx);
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
