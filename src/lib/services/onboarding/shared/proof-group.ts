// Composite: landing → tweet → ceo_summary → completion email → diagnostics → celebrate

import { stage } from '../stage-runner';
import { generateLandingPage } from './landing';
import { postLaunchTweet } from './tweets';
import { generateCeoSummary } from './ceo-summary';
import { sendCompletionEmail } from './emails';
import { flushDiagnostics, celebrate } from './celebrate';
import type { PipelineContext } from '../types';

export async function proofGroup(ctx: PipelineContext): Promise<void> {
  await stage(ctx, 'generate_landing_page', () => generateLandingPage(ctx), { optional: true });
  await stage(ctx, 'post_launch_tweet', () => postLaunchTweet(ctx), { optional: true });
  await stage(ctx, 'generate_ceo_summary', () => generateCeoSummary(ctx));
  await stage(ctx, 'send_completion_email', () => sendCompletionEmail(ctx), { optional: true });
  await stage(ctx, 'flush_diagnostics', () => flushDiagnostics(ctx));
  await stage(ctx, 'celebrate', () => celebrate(ctx));
}
