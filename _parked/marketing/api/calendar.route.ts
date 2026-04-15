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
    weeks = 4,
    platforms = ['twitter', 'linkedin'],
    tone = 'warm',
    phase = 'problem',
  } = body as any;

  if (!weeks || weeks < 1 || weeks > 52) {
    return NextResponse.json(
      { error: 'weeks must be between 1 and 52' },
      { status: 400 }
    );
  }

  if (!Array.isArray(platforms) || platforms.length === 0) {
    return NextResponse.json(
      { error: 'platforms must be a non-empty array' },
      { status: 400 }
    );
  }

  try {
    const calendar = {
      company_id: companyId,
      weeks,
      platforms,
      tone,
      phase,
      generated_posts: weeks * platforms.length,
      calendar: {
        message: `Content calendar generated for ${weeks} weeks across ${platforms.join(', ')}. Connect to Marketing agent for actual generation.`,
      },
      created_at: new Date(),
    };

    return NextResponse.json(calendar, { status: 201 });
  } catch (error) {
    console.error('Error generating calendar:', error);
    return NextResponse.json({ error: 'Failed to generate calendar' }, { status: 500 });
  }
}
