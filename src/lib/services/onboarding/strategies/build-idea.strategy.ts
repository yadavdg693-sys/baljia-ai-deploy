// Build My Idea — founder has an idea; refine + build MVP + product market research

import { stage } from '../stage-runner';
import { leanHeader } from '../shared/headers';
import { refineIdea } from '../shared/refine-idea';
import { generateBuildMarketResearch } from '../shared/market-research-build';
import { saveMission3Section } from '../shared/mission-3-section';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { infraGroup } from '../shared/infra-group';
import { proofGroup } from '../shared/proof-group';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

// Note: roadmapGroup (generate_roadmap + derive_active_milestone) disconnected
// 2026-04-24 — roadmap code remains at src/lib/services/roadmap.service.ts and
// src/lib/services/onboarding/shared/roadmap-group.ts for future decision. No
// call sites remain from onboarding. The dashboard RoadmapRail will show empty
// for new companies until a separate roadmap-generation surface is defined.

export class BuildIdeaStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await leanHeader(ctx);
    await stage(ctx, 'refine_idea', () => refineIdea(ctx));
    await infraGroup(ctx);
    await stage(ctx, 'generate_market_research', () => generateBuildMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => saveMission3Section(ctx));
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));
    await proofGroup(ctx);
  }
}
