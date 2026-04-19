// Build My Idea — founder has an idea, we refine + build MVP + research product landscape
//
// Phase 0: uses shared select_strategy/market_research/save_mission/create_tasks (behaviors unchanged)
// Phase 3a will introduce refine_idea, per-journey market research, 3-section mission
// Phase 3b will introduce CEO-framework-inheriting task creation

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

export class BuildIdeaStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await leanHeader(ctx); // heartbeat + enrich_geo + persist_context
    await stage(ctx, 'select_strategy', () => selectStrategy(ctx));
    await infraGroup(ctx); // name → provision → startup email
    await stage(ctx, 'generate_market_research', () => generateMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => saveMission(ctx));
    await roadmapGroup(ctx); // generate_roadmap → derive_active_milestone
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));
    await proofGroup(ctx); // landing → tweet → ceo_summary → completion → diagnostics → celebrate
  }
}
