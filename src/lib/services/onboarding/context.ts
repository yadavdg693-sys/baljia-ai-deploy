// Async-local storage for the current onboarding stage.
// Populated by stage-runner's stage() wrapper. Read by cost-tracking wrappers
// (tracked-calls.ts, llm/small-llm.ts) so LLM / Tavily / email calls can
// auto-attribute their cost to the current stage without threading ctx through
// every signature.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { OnboardingStage, PipelineContext } from './types';

export interface StageExecutionContext {
  ctx: PipelineContext;
  stage: OnboardingStage;
}

export const onboardingContext = new AsyncLocalStorage<StageExecutionContext>();
