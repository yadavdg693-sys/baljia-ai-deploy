// Launch tweet — bootstrap proof artifact via Late.dev

import { createLogger } from '@/lib/logger';
import { isLateDevConfigured } from '@/lib/services/latedev.service';
import type { PipelineContext } from '../types';

const log = createLogger('OnboardingTweet');

export async function postLaunchTweet(ctx: PipelineContext): Promise<void> {
  if (!isLateDevConfigured()) {
    log.info('Late.dev not configured — launch tweet skipped', { companyId: ctx.companyId });
    return;
  }

  const tweetText = [
    `🚀 ${ctx.companyName} just launched!`,
    '',
    ctx.oneLiner || ctx.mission.slice(0, 200),
    '',
    ctx.slug ? `🌐 ${ctx.slug}.baljia.app` : '',
    '',
    `Built and operated by @baljia_ai`,
  ].filter(Boolean).join('\n').slice(0, 280);

  try {
    const { createPost } = await import('@/lib/services/latedev.service');
    await createPost({ text: tweetText, platforms: ['twitter'] });
    log.info('Launch tweet posted', { companyId: ctx.companyId });
  } catch (err) {
    log.warn('Launch tweet failed — non-blocking', {
      companyId: ctx.companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
