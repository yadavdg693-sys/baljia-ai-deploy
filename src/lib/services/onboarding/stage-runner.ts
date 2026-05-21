// Stage runner — wraps each stage with emit + error policy + watchdog hook
// Default: catastrophic (throw bubbles up)
// optional: true → log + emit skipped + continue (best-effort stages)
// retryOnce: true → one retry on transient failure before throwing

import * as eventService from '@/lib/services/event.service';
import { db, companies } from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { onboardingContext } from './context';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import { registerPlatformIssue, type PlatformFeedbackSeverity } from '@/lib/services/platform-feedback.service';
import { eq } from 'drizzle-orm';
import type { OnboardingStage, PipelineContext, MoodState } from './types';

const log = createLogger('OnboardingStage');

export interface StageOptions {
  optional?: boolean;
  retryOnce?: boolean;
  mood?: MoodState;
}

// Watchdog integration point. Multiple onboarding pipelines can run in the
// same process, so handlers are keyed by company instead of one global slot.
const watchdogTicks = new Map<string, (stage: OnboardingStage) => void>();
export function setWatchdogTick(companyId: string, fn: ((stage: OnboardingStage) => void) | null): void {
  if (fn) {
    watchdogTicks.set(companyId, fn);
  } else {
    watchdogTicks.delete(companyId);
  }
}

// Auto-emit mood per stage (strategies can still override via opts.mood)
const STAGE_MOODS: Partial<Record<OnboardingStage, MoodState>> = {
  heartbeat: 'listening',
  enrich_geo: 'researching',
  enrich_linkedin: 'researching',
  enrich_twitter: 'researching',
  extract_founder_angle: 'researching',
  persist_context: 'writing',
  select_strategy: 'researching',
  refine_idea: 'researching',
  fetch_business_url: 'researching',
  invent_idea: 'researching',
  name_company: 'building',
  provision_infrastructure: 'building',
  provision_founder_app_kickoff: 'building',
  await_founder_app: 'building',
  send_startup_email: 'writing',
  generate_market_research: 'researching',
  save_mission: 'writing',
  create_starter_tasks: 'building',
  generate_landing_page: 'writing',
  post_launch_tweet: 'writing',
  generate_ceo_summary: 'writing',
  generate_magic_link: 'writing',
  send_inbox_message: 'writing',
  send_completion_email: 'writing',
  flush_diagnostics: 'writing',
  celebrate: 'celebrating',
};

// Human-readable stage labels used for automatic activity emission
const STAGE_LABELS: Partial<Record<OnboardingStage, string>> = {
  heartbeat: 'Starting pipeline...',
  enrich_geo: 'Detecting your location...',
  enrich_linkedin: 'Reading your professional background...',
  enrich_twitter: 'Reading your public profile...',
  extract_founder_angle: 'Analyzing your positioning...',
  persist_context: 'Saving context to memory...',
  select_strategy: 'Choosing strategy...',
  refine_idea: 'Clarifying your idea and market direction...',
  fetch_business_url: 'Reading your business site...',
  invent_idea: 'Inventing an idea from your background...',
  name_company: 'Naming your company...',
  provision_infrastructure: 'Provisioning infrastructure...',
  provision_founder_app_kickoff: 'Starting your app infrastructure (DB + repo)...',
  await_founder_app: 'Finalizing your app infrastructure...',
  send_startup_email: 'Sending your first company email...',
  generate_market_research: 'Researching market opportunity...',
  save_mission: 'Writing mission statement...',
  create_starter_tasks: 'Preparing your first operating plan...',
  generate_landing_page: 'Generating your landing page...',
  post_launch_tweet: 'Posting launch announcement...',
  generate_ceo_summary: 'Preparing CEO briefing...',
  generate_magic_link: 'Generating your one-click dashboard link...',
  send_inbox_message: 'Sending a welcome note to your inbox...',
  send_completion_email: 'Sending your summary email...',
  flush_diagnostics: 'Finalizing setup...',
  celebrate: 'Ready!',
};

export async function stage(
  ctx: PipelineContext,
  name: OnboardingStage,
  fn: () => Promise<void>,
  opts: StageOptions = {},
): Promise<void> {
  log.info(`Stage: ${name}`, { companyId: ctx.companyId });
  await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'running' });

  // Auto-emit human-readable activity line per stage entry
  const label = STAGE_LABELS[name];
  if (label) {
    await eventService.emit(ctx.companyId, 'onboarding_activity', {
      text: label,
      tool: null,
      stage: name,
      timestamp: Date.now(),
    });
  }

  // Emit mood — opts.mood overrides default stage mood
  const mood = opts.mood ?? STAGE_MOODS[name];
  if (mood) {
    await eventService.emit(ctx.companyId, 'onboarding_mood', { mood, stage: name });
  }

  watchdogTicks.get(ctx.companyId)?.(name);

  await db.update(companies)
    .set({ updated_at: new Date() })
    .where(eq(companies.id, ctx.companyId));

  // Wrap fn() with AsyncLocalStorage so nested LLM / Tavily / email calls can
  // attribute their cost to the current stage via onboardingContext.getStore()
  const executeOnce = async (): Promise<void> => {
    await onboardingContext.run({ ctx, stage: name }, fn);
  };

  try {
    if (opts.retryOnce) {
      try {
        await executeOnce();
      } catch (err) {
        log.warn(`Stage ${name} failed, retrying once`, { error: err instanceof Error ? err.message : String(err) });
        await executeOnce();
      }
    } else {
      await executeOnce();
    }

    await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'done' });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (opts.optional) {
      await recordOnboardingIssue(ctx, {
        stage: name,
        severity: 'low',
        kind: 'optional_stage_skipped',
        error: errorMsg,
        message: 'Optional onboarding stage failed, but the founder flow continued.',
        fallbackUsed: true,
      });
      log.warn(`Optional stage ${name} failed — continuing`, { error: errorMsg });
      await eventService.emit(ctx.companyId, 'onboarding_stage', {
        stage: name,
        status: 'skipped',
        error: errorMsg,
      });
      return;
    }

    await eventService.emit(ctx.companyId, 'onboarding_stage', {
      stage: name,
      status: 'error',
      error: errorMsg,
    });
    await recordOnboardingIssue(ctx, {
      stage: name,
      severity: 'high',
      kind: 'stage_failed',
      error: errorMsg,
      message: 'Required onboarding stage failed and the pipeline could not complete.',
      fallbackUsed: false,
    });
    throw err;
  }
}

// Activity channel — human-readable log line (Phase 1 richer usage; exposed here for strategies)
//
// Founder-safety: activity text streams live to the onboarding page, so we
// sanitize in SOFT mode on every emit. Banned terms get replaced with
// [redacted] and a Sentry breadcrumb is written so we can catch regressions
// without breaking onboarding. Hardcoded strings should never trigger this
// — the test suite catches them first — but LLM-generated text occasionally
// does, and we'd rather show the founder a clean line with a redaction than
// leak "Neon DB ready" to their screen.
export async function recordOnboardingIssue(ctx: PipelineContext, input: {
  stage?: OnboardingStage | 'orchestrator';
  kind: string;
  error?: string;
  message?: string;
  severity?: PlatformFeedbackSeverity;
  fallbackUsed?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const stageName = input.stage ?? onboardingContext.getStore()?.stage ?? 'orchestrator';
  const severity = input.severity ?? (input.fallbackUsed ? 'low' : 'medium');
  const description = [
    input.message,
    `Journey: ${ctx.journey}.`,
    `Stage: ${stageName}.`,
    input.error ? `Error: ${input.error}` : null,
  ].filter(Boolean).join('\n');

  const payload = {
    stage: stageName,
    kind: input.kind,
    severity,
    fallback_used: input.fallbackUsed ?? false,
    error: input.error ?? null,
    message: input.message ?? null,
    journey: ctx.journey,
    timestamp: Date.now(),
    ...(input.metadata ?? {}),
  };

  try {
    await eventService.emit(ctx.companyId, 'onboarding_issue', payload);
  } catch (err) {
    log.warn('Failed to emit onboarding_issue event', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await registerPlatformIssue({
      companyId: ctx.companyId,
      type: 'bug',
      title: `Onboarding ${String(stageName)}: ${input.kind}`,
      description,
      severity,
      source: 'onboarding',
      area: 'onboarding',
      metadata: {
        ...payload,
        company_id: ctx.companyId,
      },
    });
  } catch (err) {
    log.warn('Failed to register onboarding issue in platform feedback', {
      companyId: ctx.companyId,
      stage: stageName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function emitActivity(ctx: PipelineContext, text: string, tool?: string): Promise<void> {
  const currentStage = onboardingContext.getStore()?.stage ?? null;
  const safe = sanitizeForFounder(text, {
    mode: 'soft',
    context: { callsite: 'emitActivity', companyId: ctx.companyId, stage: currentStage, tool: tool ?? null },
  });
  await eventService.emit(ctx.companyId, 'onboarding_activity', {
    text: safe.clean,
    tool: tool ?? null,
    timestamp: Date.now(),
  });
  await db.update(companies)
    .set({ updated_at: new Date() })
    .where(eq(companies.id, ctx.companyId));
}

export async function emitMood(ctx: PipelineContext, mood: MoodState, stage?: OnboardingStage): Promise<void> {
  await eventService.emit(ctx.companyId, 'onboarding_mood', { mood, stage: stage ?? null });
}
