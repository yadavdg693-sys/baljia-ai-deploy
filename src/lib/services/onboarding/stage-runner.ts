// Stage runner — wraps each stage with emit + error policy + watchdog hook
// Default: catastrophic (throw bubbles up)
// optional: true → log + emit skipped + continue (best-effort stages)
// retryOnce: true → one retry on transient failure before throwing

import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';
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

export async function stage(
  ctx: PipelineContext,
  name: OnboardingStage,
  fn: () => Promise<void>,
  opts: StageOptions = {},
): Promise<void> {
  log.info(`Stage: ${name}`, { companyId: ctx.companyId });
  await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'running' });

  if (opts.mood) {
    await eventService.emit(ctx.companyId, 'onboarding_mood', { mood: opts.mood, stage: name });
  }

  watchdogTick?.(name);

  const executeOnce = async (): Promise<void> => {
    await fn();
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
