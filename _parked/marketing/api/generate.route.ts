import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, getRequiredCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';

export async function POST(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const {
    platform,
    topic,
    tone,
    post_type: postType,
    thread_length: threadLength,
  } = body as any;

  if (!platform || !topic || !postType) {
    return NextResponse.json(
      { error: 'platform, topic, and post_type are required' },
      { status: 400 }
    );
  }

  try {
    const validTones = ['technical', 'visionary', 'relatable', 'warm'];
    const validPlatforms = ['twitter', 'linkedin', 'reddit', 'producthunt'];

    if (!validTones.includes(tone)) {
      return NextResponse.json(
        { error: 'tone must be one of: technical, visionary, relatable, warm' },
        { status: 400 }
      );
    }

    if (!validPlatforms.includes(platform)) {
      return NextResponse.json(
        { error: 'platform must be one of: twitter, linkedin, reddit, producthunt' },
        { status: 400 }
      );
    }

    const generated = {
      platform,
      post_type: postType,
      topic,
      tone,
      thread_length: threadLength || 1,
      content: `This is a placeholder for AI-generated content about "${topic}" for ${platform} in ${tone} tone. Connect to your preferred LLM agent to generate actual content.`,
      created_at: new Date(),
    };

    return NextResponse.json(generated, { status: 201 });
  } catch (error) {
    console.error('Error generating content:', error);
    return NextResponse.json({ error: 'Failed to generate content' }, { status: 500 });
  }
}
