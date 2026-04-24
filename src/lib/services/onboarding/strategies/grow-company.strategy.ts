// Grow My Company — founder has an existing business; distribution research + optimization tasks

import { stage } from '../stage-runner';
import { leanHeader } from '../shared/headers';
import { fetchBusinessUrl } from '../shared/fetch-business-url';
import { generateGrowMarketResearch } from '../shared/market-research-grow';
import { saveMission3Section } from '../shared/mission-3-section';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { infraGroup } from '../shared/infra-group';
import { proofGroup } from '../shared/proof-group';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

// Note: roadmapGroup disconnected 2026-04-24 — see build-idea.strategy.ts for context.

export class GrowCompanyStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await leanHeader(ctx);
    await stage(ctx, 'fetch_business_url', () => fetchBusinessUrl(ctx));
    await infraGroup(ctx);
    await stage(ctx, 'generate_market_research', () => generateGrowMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => saveMission3Section(ctx));
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));
    await proofGroup(ctx);
  }
}
