// Surprise Me — the "Baljia magic" path. Personal context creates substance.
// fullHeader populates LinkedIn + founder angle + geo (Twitter enrichment
// removed 2026-04-24 — low signal vs Tavily cost).
// invent_idea generates the idea from background.

import { stage } from '../stage-runner';
import { fullHeader } from '../shared/headers';
import { inventIdea } from '../shared/invent-idea';
import { generateSurpriseMarketResearch } from '../shared/market-research-surprise';
import { saveMission3Section } from '../shared/mission-3-section';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { infraGroup } from '../shared/infra-group';
import { proofGroup } from '../shared/proof-group';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

// Note: roadmapGroup disconnected 2026-04-24 — see build-idea.strategy.ts for context.

export class SurpriseMeStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await fullHeader(ctx);
    await stage(ctx, 'invent_idea', () => inventIdea(ctx));
    await infraGroup(ctx);
    await stage(ctx, 'generate_market_research', () => generateSurpriseMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => saveMission3Section(ctx));
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));
    await proofGroup(ctx);
  }
}
