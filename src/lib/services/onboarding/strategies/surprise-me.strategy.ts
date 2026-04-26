// Surprise Me — the "Baljia magic" path. Personal context creates substance.
// fullHeader populates LinkedIn + founder angle + geo.
// invent_idea generates the idea from background.
//
// Parallel execution map (60-90s target):
//   fullHeader (geo + LinkedIn enrichment)
//   invent_idea
//   ├─ name_company          ┐ parallel — naming hidden behind research
//   └─ market_research       ┘
//   infraGroup (provision + kickoff + startup email)
//   save_mission             (~5s — sets ctx.oneLiner needed by tasks + landing)
//   ├─ create_starter_tasks  ┐ parallel — both need mission+research, not each other
//   └─ generate_landing_page ┘
//   proofGroup (tweet + ceo + magic link + emails + celebrate)

import { stage } from '../stage-runner';
import { fullHeader } from '../shared/headers';
import { inventIdea } from '../shared/invent-idea';
import { nameCompany } from '../shared/naming';
import { generateSurpriseMarketResearch } from '../shared/market-research-surprise';
import { saveMission3Section } from '../shared/mission-3-section';
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

    // Naming + market research in parallel — both only need the invented idea
    await Promise.all([
      stage(ctx, 'name_company', () => nameCompany(ctx)),
      stage(ctx, 'generate_market_research', () => generateSurpriseMarketResearch(ctx)),
    ]);

    // Infra needs slug (set by name_company above)
    await infraGroup(ctx);

    // Mission is fast (~5s) and sets ctx.oneLiner — must complete before tasks + landing
    await stage(ctx, 'save_mission', () => saveMission3Section(ctx));

    // Tasks + landing in parallel — both have research + mission, neither needs the other
    await Promise.all([
      stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx)),
      stage(ctx, 'generate_landing_page', () => generateLandingPage(ctx), { optional: true }),
    ]);

    await proofGroup(ctx);
  }
}
