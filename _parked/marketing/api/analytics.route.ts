// @ts-nocheck
// TODO: Marketing subsystem — build separately after core Baljia is complete
import { NextRequest, NextResponse } from 'next/server';
import * as marketingService from '@/lib/services/marketing.service';
import { requireAuthAndCompany, getRequiredCompanyId, isApiError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const startDate = request.nextUrl.searchParams.get('start_date');
  const endDate = request.nextUrl.searchParams.get('end_date');

  try {
    const analytics = await marketingService.getAnalyticsSummary(companyId, {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    return NextResponse.json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
