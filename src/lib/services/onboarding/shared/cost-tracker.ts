// Cost instrumentation — tracks LLM calls, Tavily searches, email sends per pipeline run
// Emitted as onboarding_costs event at pipeline completion

import * as eventService from '@/lib/services/event.service';
import type { OnboardingStage, PipelineContext } from '../types';

export interface OnboardingCosts {
  llm_calls: number;
  llm_total_tokens_est: number;
  tavily_calls: number;
  emails_sent: number;
  per_stage: Partial<Record<OnboardingStage, { llm: number; tavily: number; email: number }>>;
}

// Attached to ctx.costs at pipeline init; read+updated by stages
interface CostContextExtension {
  costs?: OnboardingCosts;
}

export function initCosts(ctx: PipelineContext): void {
  (ctx as PipelineContext & CostContextExtension).costs = {
    llm_calls: 0,
    llm_total_tokens_est: 0,
    tavily_calls: 0,
    emails_sent: 0,
    per_stage: {},
  };
}

export function recordLLMCall(
  ctx: PipelineContext,
  stage: OnboardingStage,
  maxTokensEstimate: number,
): void {
  const costs = (ctx as PipelineContext & CostContextExtension).costs;
  if (!costs) return;
  costs.llm_calls += 1;
  costs.llm_total_tokens_est += maxTokensEstimate;
  costs.per_stage[stage] ??= { llm: 0, tavily: 0, email: 0 };
  costs.per_stage[stage]!.llm += 1;
}

export function recordTavilyCall(ctx: PipelineContext, stage: OnboardingStage): void {
  const costs = (ctx as PipelineContext & CostContextExtension).costs;
  if (!costs) return;
  costs.tavily_calls += 1;
  costs.per_stage[stage] ??= { llm: 0, tavily: 0, email: 0 };
  costs.per_stage[stage]!.tavily += 1;
}

export function recordEmailSend(ctx: PipelineContext, stage: OnboardingStage): void {
  const costs = (ctx as PipelineContext & CostContextExtension).costs;
  if (!costs) return;
  costs.emails_sent += 1;
  costs.per_stage[stage] ??= { llm: 0, tavily: 0, email: 0 };
  costs.per_stage[stage]!.email += 1;
}

export async function flushCosts(ctx: PipelineContext): Promise<void> {
  const costs = (ctx as PipelineContext & CostContextExtension).costs;
  if (!costs) return;
  await eventService.emit(ctx.companyId, 'onboarding_costs', {
    elapsed_ms: Date.now() - ctx.startedAt,
    ...costs,
  });
}
