// Stage runner — wraps each stage with emit + error policy + watchdog hook
// Default: catastrophic (throw bubbles up)
// optional: true → log + emit skipped + continue (best-effort stages)
// retryOnce: true → one retry on transient failure before throwing

import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';
import { onboardingContext } from './context';
import type { OnboardingStage, PipelineContext, MoodState } from './types';

const log = createLogger('OnboardingStage');

export interface StageOptions {
  optional?: boolean;
  retryOnce?: boolean;
  mood?: MoodState;
}

// Watchdog integration point (Phase 2 will populate this)
let watchdogTick: ((stage: OnboardingStage) => void) | null = null;
export function setWatchdogTick(fn: ((stage: OnboardingStage) => void) | null): void {
  watchdogTick = fn;
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
  generate_roadmap: 'writing',
  derive_active_milestone: 'writing',
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
  refine_idea: 'Refining your idea into buildable scope...',
  fetch_business_url: 'Reading your business site...',
  invent_idea: 'Inventing an idea from your background...',
  name_company: 'Naming your company...',
  provision_infrastructure: 'Provisioning infrastructure...',
  provision_founder_app_kickoff: 'Starting your app infrastructure (DB + repo)...',
  await_founder_app: 'Finalizing your app infrastructure...',
  send_startup_email: 'Sending your first company email...',
  generate_market_research: 'Researching market opportunity...',
  save_mission: 'Writing mission statement...',
  generate_roadmap: 'Building your company roadmap...',
  derive_active_milestone: 'Setting your first milestone...',
  create_starter_tasks: 'Creating your starter tasks...',
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

  watchdogTick?.(name);

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
    throw err;
  }
}

// Activity channel — human-readable log line (Phase 1 richer usage; exposed here for strategies)
export async function emitActivity(ctx: PipelineContext, text: string, tool?: string): Promise<void> {
  await eventService.emit(ctx.companyId, 'onboarding_activity', {
    text,
    tool: tool ?? null,
    timestamp: Date.now(),
  });
}

export async function emitMood(ctx: PipelineContext, mood: MoodState, stage?: OnboardingStage): Promise<void> {
  await eventService.emit(ctx.companyId, 'onboarding_mood', { mood, stage: stage ?? null });
}
