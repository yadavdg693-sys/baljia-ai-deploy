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

  const status = request.nextUrl.searchParams.get('status');

  try {
    const queue = await marketingService.getEngagementQueue(companyId, status || undefined);
    return NextResponse.json(queue);
  } catch (error) {
    console.error('Error fetching engagement queue:', error);
    return NextResponse.json({ error: 'Failed to fetch engagement queue' }, { status: 500 });
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
    external_post_url: externalPostUrl,
    author_name: authorName,
    author_handle: authorHandle,
    post_snippet: postSnippet,
    relevance_score: relevanceScore,
    suggested_reply: suggestedReply,
  } = body as any;

  if (!platform || !externalPostUrl) {
    return NextResponse.json(
      { error: 'platform and external_post_url are required' },
      { status: 400 }
    );
  }

  try {
    const item = await marketingService.addToEngagementQueue({
      company_id: companyId,
      platform,
      external_post_url: externalPostUrl,
      author_name: authorName,
      author_handle: authorHandle,
      post_snippet: postSnippet,
      relevance_score: relevanceScore,
      suggested_reply: suggestedReply,
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('Error adding to engagement queue:', error);
    return NextResponse.json({ error: 'Failed to add to engagement queue' }, { status: 500 });
  }
}
