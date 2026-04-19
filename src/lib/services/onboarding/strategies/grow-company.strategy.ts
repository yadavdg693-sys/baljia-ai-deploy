// Grow My Company — founder has an existing business, we research distribution + optimization opportunities
//
// Phase 0: uses shared select_strategy/market_research/save_mission/create_tasks (behaviors unchanged)
// Phase 3a will introduce fetch_business_url, distribution-focused market research, refine-existing mission
// Phase 3b will introduce 5-section optimization spec for engineering task

import { stage } from '../stage-runner';
import { leanHeader } from '../shared/headers';
import { selectStrategy } from '../shared/select-strategy';
import { generateMarketResearch } from '../shared/market-research';
import { saveMission } from '../shared/save-mission';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { infraGroup } from '../shared/infra-group';
import { roadmapGroup } from '../shared/roadmap-group';
import { proofGroup } from '../shared/proof-group';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

export class GrowCompanyStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await leanHeader(ctx);
    await stage(ctx, 'select_strategy', () => selectStrategy(ctx));
    await infraGroup(ctx);
    await stage(ctx, 'generate_market_research', () => generateMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => saveMission(ctx));
    await roadmapGroup(ctx);
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));
    await proofGroup(ctx);
  }
}
