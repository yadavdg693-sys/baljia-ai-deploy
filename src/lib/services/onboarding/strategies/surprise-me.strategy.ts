// Surprise Me - invent an idea, validate/plan it, publish, then prepare task drafts.
//
// After invent_idea, the flow mirrors Build My Idea:
//   header/context -> invent -> planning -> name -> market report -> infra
//   -> landing -> mission -> starter tasks -> proof group.

import { stage } from '../stage-runner';
import { fullHeader } from '../shared/headers';
import { inventIdea } from '../shared/invent-idea';
import { nameCompany } from '../shared/naming';
import { runSurprisePlanningAgent, type SurprisePlanningArtifacts } from '../shared/surprise-planning-agent';
import { persistMarketResearch, renderBuildMarkdown } from '../shared/market-research-render';
import { persistMissionDoc } from '../shared/mission-3-section';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { generateLandingPage } from '../shared/landing';
import { infraGroup } from '../shared/infra-group';
import { proofGroup } from '../shared/proof-group';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

export class SurpriseMeStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await fullHeader(ctx);
    await stage(ctx, 'invent_idea', () => inventIdea(ctx));

    let artifacts!: SurprisePlanningArtifacts;
    await stage(ctx, 'refine_idea', async () => {
      artifacts = await runSurprisePlanningAgent(ctx);
    });

    await stage(ctx, 'name_company', () => nameCompany(ctx));

    if (!artifacts) {
      throw new Error('Surprise planning did not return artifacts');
    }

    await stage(ctx, 'generate_market_research', async () => {
      const markdown = renderBuildMarkdown(artifacts.market_research, ctx.companyName);
      await persistMarketResearch(ctx, artifacts.market_research, markdown);
    });

    await infraGroup(ctx);
    await stage(ctx, 'generate_landing_page', () => generateLandingPage(ctx), { optional: true });
    await stage(ctx, 'save_mission', () => persistMissionDoc(ctx, artifacts.mission_doc));
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));

    await proofGroup(ctx);
  }
}
