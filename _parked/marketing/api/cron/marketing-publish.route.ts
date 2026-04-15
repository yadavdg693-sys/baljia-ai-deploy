// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
import { NextRequest, NextResponse } from 'next/server';
import * as marketingService from '@/lib/services/marketing.service';

/**
 * Cron job to publish scheduled posts
 * Called periodically to check for scheduled posts that should be published
 * Requires CRON_SECRET header for security
 */
export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (!cronSecret || !expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const scheduledPosts = await marketingService.getScheduledPosts(now);

    const results = {
      total_checked: scheduledPosts.length,
      published: 0,
      failed: 0,
      errors: [] as { post_id: string; error: string }[],
    };

    for (const post of scheduledPosts) {
      try {
        await marketingService.publishPost(
          post.id,
          undefined,
          `Published post ${post.id} via cron`
        );
        results.published++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          post_id: post.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in marketing-publish cron:', error);
    return NextResponse.json(
      { error: 'Failed to process scheduled posts' },
      { status: 500 }
    );
  }
}
