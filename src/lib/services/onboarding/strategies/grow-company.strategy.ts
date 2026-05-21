// Grow My Company - founder has an existing business; research growth,
// sharpen mission, publish a growth page, then prepare starter task drafts.

import { stage } from '../stage-runner';
import { leanHeader } from '../shared/headers';
import { fetchBusinessUrl } from '../shared/fetch-business-url';
import { nameCompany } from '../shared/naming';
import { runGrowPlanningAgent, type GrowPlanningArtifacts } from '../shared/grow-planning-agent';
import { persistMarketResearch, renderGrowMarkdown } from '../shared/market-research-render';
import { persistMissionDoc } from '../shared/mission-3-section';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { generateLandingPage } from '../shared/landing';
import { infraGroup } from '../shared/infra-group';
import { proofGroup } from '../shared/proof-group';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

export class GrowCompanyStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await leanHeader(ctx);
    await stage(ctx, 'fetch_business_url', () => fetchBusinessUrl(ctx));
    await stage(ctx, 'name_company', () => nameCompany(ctx));

    let artifacts!: GrowPlanningArtifacts;
    await stage(ctx, 'generate_market_research', async () => {
      artifacts = await runGrowPlanningAgent(ctx);
      const markdown = renderGrowMarkdown(artifacts.market_research, ctx.companyName);
      await persistMarketResearch(ctx, artifacts.market_research, markdown);
    });

    if (!artifacts) {
      throw new Error('Grow planning did not return artifacts');
    }

    await infraGroup(ctx);
    await stage(ctx, 'generate_landing_page', () => generateLandingPage(ctx), { optional: true });
    await stage(ctx, 'save_mission', () => persistMissionDoc(ctx, artifacts.mission_doc));
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));

    await proofGroup(ctx);
  }
}
