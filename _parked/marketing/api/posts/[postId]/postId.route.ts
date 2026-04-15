// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
import { NextRequest, NextResponse } from 'next/server';
import * as marketingService from '@/lib/services/marketing.service';
import { requireAuth, requireCompanyOwnership, parseJsonBody, isApiError } from '@/lib/api-utils';
import { marketingPosts, db } from '@/lib/db';
import { eq } from 'drizzle-orm';

async function getPostWithAuth(postId: string) {
  const auth = await requireAuth();
  if (isApiError(auth)) return { error: auth } as const;

  const [post] = await db.select()
    .from(marketingPosts)
    .where(eq(marketingPosts.id, postId))
    .limit(1);

  if (!post) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const;

  const ownership = await requireCompanyOwnership(post.company_id, auth.user.id);
  if (isApiError(ownership)) return { error: ownership } as const;

  return { post } as const;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const result = await getPostWithAuth(postId);
  if ('error' in result) return result.error;

  try {
    const postWithAnalytics = await marketingService.getPostWithAnalytics(postId);
    return NextResponse.json(postWithAnalytics);
  } catch (error) {
    console.error('Error fetching post:', error);
    return NextResponse.json({ error: 'Failed to fetch post' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const result = await getPostWithAuth(postId);
  if ('error' in result) return result.error;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  try {
    const updated = await marketingService.updatePost(postId, body as any);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating post:', error);
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const result = await getPostWithAuth(postId);
  if ('error' in result) return result.error;

  try {
    await marketingService.deletePost(postId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting post:', error);
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
  }
}
