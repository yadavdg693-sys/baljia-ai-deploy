// Build My Idea - founder has an idea; plan, research, publish, then prepare task drafts.
//
// Order follows the Mini Cycle 1 shape:
//   header/context -> planning -> name -> market report -> welcome email
//   -> tweet -> landing -> mission -> starter tasks -> inbox/link/summary.

import { stage } from '../stage-runner';
import { leanHeader } from '../shared/headers';
import { nameCompany } from '../shared/naming';
import { runBuildPlanningAgent, type BuildPlanningArtifacts } from '../shared/build-planning-agent';
import { persistMarketResearch, renderBuildMarkdown } from '../shared/market-research-render';
import { persistMissionDoc } from '../shared/mission-3-section';
import { createStarterTasks } from '../shared/create-starter-tasks';
import { generateLandingPage } from '../shared/landing';
import { infraGroup } from '../shared/infra-group';
import { postLaunchTweet } from '../shared/tweets';
import { generateCeoSummary } from '../shared/ceo-summary';
import { generateOnboardingMagicLink, type MagicLinkExtension } from '../shared/generate-magic-link';
import { sendInboxMessage } from '../shared/send-inbox-message';
import { sendCompletionEmail } from '../shared/emails';
import { awaitFounderAppProvisioning } from '../shared/provision-founder-app';
import { flushDiagnostics, celebrate } from '../shared/celebrate';
import type { OnboardingStrategy } from './base.strategy';
import type { PipelineContext } from '../types';

export class BuildIdeaStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await leanHeader(ctx);

    let artifacts!: BuildPlanningArtifacts;
    await stage(ctx, 'refine_idea', async () => {
      artifacts = await runBuildPlanningAgent(ctx);
    });

    await stage(ctx, 'name_company', () => nameCompany(ctx));

    if (!artifacts) {
      throw new Error('Build planning did not return artifacts');
    }

    await stage(ctx, 'generate_market_research', async () => {
      const markdown = renderBuildMarkdown(artifacts.market_research, ctx.companyName);
      await persistMarketResearch(ctx, artifacts.market_research, markdown);
    });

    await infraGroup(ctx);
    await stage(ctx, 'post_launch_tweet', () => postLaunchTweet(ctx), { optional: true });
    await stage(ctx, 'generate_landing_page', () => generateLandingPage(ctx), { optional: true });
    await stage(ctx, 'save_mission', () => persistMissionDoc(ctx, artifacts.mission_doc));
    await stage(ctx, 'create_starter_tasks', () => createStarterTasks(ctx));

    await stage(ctx, 'generate_ceo_summary', () => generateCeoSummary(ctx), { optional: true });
    await stage(ctx, 'await_founder_app', () => awaitFounderAppProvisioning(ctx), { optional: true });
    await stage(ctx, 'send_inbox_message', () => sendInboxMessage(ctx), { optional: true });
    await stage(ctx, 'generate_magic_link', () => generateOnboardingMagicLink(ctx), { optional: true });
    await stage(ctx, 'send_completion_email', async () => {
      const magicLinkUrl = (ctx as PipelineContext & MagicLinkExtension).magicLinkUrl;
      await sendCompletionEmail(ctx, magicLinkUrl);
    }, { optional: true });
    await stage(ctx, 'flush_diagnostics', () => flushDiagnostics(ctx));
    await stage(ctx, 'celebrate', () => celebrate(ctx));
  }
}
