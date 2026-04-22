// Onboarding watchdog — in-process stall detection + absolute timeout
// - 60s stall warning (configurable via ONBOARDING_STALL_MS)
// - 600s absolute kill (configurable via ONBOARDING_MAX_DURATION_MS)
// - 5s tick (configurable via ONBOARDING_TICK_MS)
//
// Integration: orchestrator creates Watchdog, calls start(), and stops it in
// finally. stage-runner calls watchdog.tick(stageName) on every stage entry via
// setWatchdogTick(). If stall/timeout fires, Watchdog throws inside its tick
// handler, which propagates up to the orchestrator's catch block.

import { createLogger } from '@/lib/logger';
import * as eventService from '@/lib/services/event.service';
import type { OnboardingStage, PipelineContext } from './types';
import { setWatchdogTick } from './stage-runner';

const log = createLogger('OnboardingWatchdog');

const STALL_MS = Number(process.env.ONBOARDING_STALL_MS ?? 60_000);
const MAX_DURATION_MS = Number(process.env.ONBOARDING_MAX_DURATION_MS ?? 600_000);
const TICK_MS = Number(process.env.ONBOARDING_TICK_MS ?? 5_000);

export class WatchdogTimeoutError extends Error {
  readonly reason: 'stall_exceeded' | 'absolute_timeout';
  constructor(reason: 'stall_exceeded' | 'absolute_timeout', stage: OnboardingStage | null) {
    super(`Onboarding watchdog ${reason} on stage ${stage ?? 'unknown'}`);
    this.reason = reason;
    this.name = 'WatchdogTimeoutError';
  }
}

export class OnboardingWatchdog {
  private interval: NodeJS.Timeout | null = null;
  private lastTickAt: number = 0;
  private currentStage: OnboardingStage | null = null;
  private stallWarned = false;
  private killed: { reason: 'stall_exceeded' | 'absolute_timeout'; stage: OnboardingStage | null } | null = null;

  constructor(private readonly ctx: PipelineContext) {}

  start(): void {
    this.lastTickAt = Date.now();
    this.interval = setInterval(() => {
      this.check();
    }, TICK_MS);
    setWatchdogTick((stage) => this.tick(stage));
    log.info('Watchdog started', {
      companyId: this.ctx.companyId,
      stallMs: STALL_MS,
      maxDurationMs: MAX_DURATION_MS,
      tickMs: TICK_MS,
    });
  }

  tick(stage: OnboardingStage): void {
    // If watchdog already decided to kill (from async check()), surface synchronously
    // at the NEXT stage entry so we don't run further stages
    if (this.killed) {
      throw new WatchdogTimeoutError(this.killed.reason, this.killed.stage);
    }
    this.lastTickAt = Date.now();
    this.currentStage = stage;
    this.stallWarned = false;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    setWatchdogTick(null);
    log.info('Watchdog stopped', { companyId: this.ctx.companyId });
  }

  // Throws if watchdog killed the run — called by orchestrator to surface the cause
  throwIfKilled(): void {
    if (this.killed) {
      throw new WatchdogTimeoutError(this.killed.reason, this.killed.stage);
    }
  }

  private check(): void {
    const now = Date.now();
    const sinceLastTick = now - this.lastTickAt;
    const elapsed = now - this.ctx.startedAt;

    // Absolute timeout — mark killed; orchestrator polls via throwIfKilled()
    // (we can't throw from setInterval — needs to propagate on next tick()
    // call which happens at every stage entry)
    if (elapsed > MAX_DURATION_MS) {
      if (!this.killed) {
        this.killed = { reason: 'absolute_timeout', stage: this.currentStage };
        log.error('Watchdog absolute timeout exceeded', {
          companyId: this.ctx.companyId,
          stage: this.currentStage,
          elapsedMs: elapsed,
          maxDurationMs: MAX_DURATION_MS,
        });
        eventService.emit(this.ctx.companyId, 'onboarding_activity', {
          text: `Pipeline exceeded ${Math.round(MAX_DURATION_MS / 1000)}s — terminating`,
          tool: 'watchdog',
          stage: this.currentStage,
          timestamp: now,
        }).catch(() => { /* non-fatal */ });
      }
      return;
    }

    // Stall warning (emit once per stall)
    if (sinceLastTick > STALL_MS && !this.stallWarned) {
      this.stallWarned = true;
      log.warn('Watchdog stall warning', {
        companyId: this.ctx.companyId,
        stage: this.currentStage,
        stallMs: sinceLastTick,
      });
      eventService.emit(this.ctx.companyId, 'onboarding_activity', {
        text: `Stage stalled >${Math.round(STALL_MS / 1000)}s: ${this.currentStage ?? 'unknown'}`,
        tool: 'watchdog',
        stage: this.currentStage,
        timestamp: now,
      }).catch(() => { /* non-fatal */ });
    }
  }
}
