// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
import { NextRequest, NextResponse } from 'next/server';
import * as marketingService from '@/lib/services/marketing.service';
import { requireAuthAndCompany, getRequiredCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const platform = request.nextUrl.searchParams.get('platform');
  const status = request.nextUrl.searchParams.get('status');
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

  try {
    const posts = await marketingService.getPostsByCompany(companyId, {
      platform: platform || undefined,
      status: status || undefined,
      limit,
      offset,
    });

    return NextResponse.json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const {
    platform,
    post_type: postType,
    content,
    title,
    scheduled_for: scheduledFor,
    campaign_tag: campaignTag,
    phase,
    thread_parts: threadParts,
    media_urls: mediaUrls,
    hashtags,
    ai_generated: aiGenerated,
    ai_prompt: aiPrompt,
    task_id: taskId,
  } = body as any;

  if (!platform || !postType || !content) {
    return NextResponse.json(
      { error: 'platform, post_type, and content are required' },
      { status: 400 }
    );
  }

  try {
    const post = await marketingService.createPost({
      company_id: companyId,
      platform,
      post_type: postType,
      content,
      title,
      scheduled_for: scheduledFor ? new Date(scheduledFor) : undefined,
      campaign_tag: campaignTag,
      phase,
      thread_parts: threadParts,
      media_urls: mediaUrls,
      hashtags,
      ai_generated: aiGenerated || false,
      ai_prompt: aiPrompt,
      task_id: taskId,
    });

    return NextResponse.json(post, { status: 201 });
  } catch (error) {
    console.error('Error creating post:', error);
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  }
}
