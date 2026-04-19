// Surprise Me — the "Baljia magic" path; personal context creates substance
//
// Uses fullHeader (LinkedIn + Twitter + founder angle + geo) since there's no user-declared idea.
// Phase 0: uses shared select_strategy (which generates the idea from founder background)
// Phase 3a will replace select_strategy with invent_idea producing structured invented_idea shape
// Phase 3b task creation will include Idea Refinements section reasoning

import { stage } from '../stage-runner';
import { fullHeader } from '../shared/headers';
import { selectStrategy } from '../shared/select-strategy';
import { generateMarketResearch } from '../shared/market-research';
import { saveMission } from '../shared/save-mission';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { infraGroup } from '../shared/infra-group';
import { roadmapGroup } from '../shared/roadmap-group';
import { proofGroup } from '../shared/proof-group';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

export class SurpriseMeStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await fullHeader(ctx); // heartbeat + enrich_geo + enrich_linkedin + enrich_twitter + extract_founder_angle + persist_context
    await stage(ctx, 'select_strategy', () => selectStrategy(ctx));
    await infraGroup(ctx);
    await stage(ctx, 'generate_market_research', () => generateMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => saveMission(ctx));
    await roadmapGroup(ctx);
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));
    await proofGroup(ctx);
  }
}
