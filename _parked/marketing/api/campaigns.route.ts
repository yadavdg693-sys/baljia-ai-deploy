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
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0');

  try {
    const campaigns = await marketingService.getCampaignsByCompany(companyId, {
      status: status || undefined,
      limit,
      offset,
    });

    return NextResponse.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 });
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
    name,
    description,
    phase,
    start_date: startDate,
    end_date: endDate,
    platforms,
    tone,
    target_audience: targetAudience,
    content_pillars: contentPillars,
  } = body as any;

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const campaign = await marketingService.createCampaign({
      company_id: companyId,
      name,
      description,
      phase,
      start_date: startDate ? new Date(startDate) : undefined,
      end_date: endDate ? new Date(endDate) : undefined,
      platforms,
      tone,
      target_audience: targetAudience,
      content_pillars: contentPillars,
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error('Error creating campaign:', error);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}
