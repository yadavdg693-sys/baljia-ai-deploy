import { NextRequest, NextResponse } from 'next/server';
import * as documentService from '@/lib/services/document.service';
import { requireAuthAndCompany, getRequiredCompanyId, isApiError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const documents = await documentService.getDocuments(companyId);
  return NextResponse.json(documents);
}
