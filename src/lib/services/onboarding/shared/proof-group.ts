// Composite: landing → tweet → ceo_summary → magic_link → inbox_message →
// completion email (with embedded magic link) → diagnostics → celebrate

import { stage } from '../stage-runner';
import { generateLandingPage } from './landing';
import { postLaunchTweet } from './tweets';
import { generateCeoSummary } from './ceo-summary';
import { generateOnboardingMagicLink, type MagicLinkExtension } from './generate-magic-link';
import { sendInboxMessage } from './send-inbox-message';
import { sendCompletionEmail } from './emails';
import { awaitFounderAppProvisioning } from './provision-founder-app';
import { flushDiagnostics, celebrate } from './celebrate';
import type { PipelineContext } from '../types';

export async function proofGroup(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'generate_landing_page', () => generateLandingPage(ctx), { optional: true });
  await stage(ctx, 'post_launch_tweet', () => postLaunchTweet(ctx), { optional: true });
  await stage(ctx, 'generate_ceo_summary', () => generateCeoSummary(ctx));
  // Phase 6: collect the Neon DB + GitHub repo that were kicked off in infra-group.
  // Placed late so their ~20s background work had plenty of time to finish during
  // market-research + mission + tasks. Optional — deferred to engineering agent on failure.
  await stage(ctx, 'await_founder_app', () => awaitFounderAppProvisioning(ctx), { optional: true });
  // Magic link must run BEFORE completion email so the URL can be embedded
  await stage(ctx, 'generate_magic_link', () => generateOnboardingMagicLink(ctx), { optional: true });
  await stage(ctx, 'send_inbox_message', () => sendInboxMessage(ctx), { optional: true });
  await stage(ctx, 'send_completion_email', async () => {
    const magicLinkUrl = (ctx as PipelineContext & MagicLinkExtension).magicLinkUrl;
    await sendCompletionEmail(ctx, magicLinkUrl);
  }, { optional: true });
  await stage(ctx, 'flush_diagnostics', () => flushDiagnostics(ctx));
  await stage(ctx, 'celebrate', () => celebrate(ctx));
}
