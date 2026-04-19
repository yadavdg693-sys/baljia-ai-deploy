// Composite: landing → tweet → ceo_summary → magic_link → inbox_message →
// completion email (with embedded magic link) → diagnostics → celebrate

import { stage } from '../stage-runner';
import { generateLandingPage } from './landing';
import { postLaunchTweet } from './tweets';
import { generateCeoSummary } from './ceo-summary';
import { generateOnboardingMagicLink, type MagicLinkExtension } from './generate-magic-link';
import { sendInboxMessage } from './send-inbox-message';
import { sendCompletionEmail } from './emails';
import { flushDiagnostics, celebrate } from './celebrate';
import type { PipelineContext } from '../types';

export async function proofGroup(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'generate_landing_page', () => generateLandingPage(ctx), { optional: true });
  await stage(ctx, 'post_launch_tweet', () => postLaunchTweet(ctx), { optional: true });
  await stage(ctx, 'generate_ceo_summary', () => generateCeoSummary(ctx));
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
