// API: Get company roadmap with milestones and criteria
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany } from '@/lib/api-utils';
import * as roadmapService from '@/lib/services/roadmap.service';
import { isValidUUID } from '@/lib/uuid-validation';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  if (!isValidUUID(companyId)) return NextResponse.json({ error: 'Invalid companyId format' }, { status: 400 });

  const authResult = await requireAuthAndCompany(companyId);
  if (authResult instanceof NextResponse) return authResult;

  const data = await roadmapService.getRoadmap(companyId);

  if (!data) {
    return NextResponse.json({ roadmap: null, milestones: [] });
  }

  return NextResponse.json(data);
}
