import { NextRequest, NextResponse } from 'next/server';
import * as eventService from '@/lib/services/event.service';
import { getRequiredCompanyId, requireAuthAndCompany, isApiError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  // Support both 'company_id' and 'companyId' query params
  const companyIdRaw = request.nextUrl.searchParams.get('company_id')
    ?? request.nextUrl.searchParams.get('companyId');

  if (!companyIdRaw) {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }

  const auth = await requireAuthAndCompany(companyIdRaw);
  if (isApiError(auth)) return auth;

  const limitStr = request.nextUrl.searchParams.get('limit');
  const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;

  const events = await eventService.getCompanyEvents(companyIdRaw, limit);

  return NextResponse.json({ events });
}
