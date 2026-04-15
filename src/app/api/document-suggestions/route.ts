import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany } from '@/lib/api-utils';
import * as documentService from '@/lib/services/document.service';
import { isValidUUID } from '@/lib/uuid-validation';
import { db, documentSuggestions, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

// GET /api/document-suggestions?company_id=<uuid>
// Returns all pending suggestions for a company
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId || !isValidUUID(companyId)) {
    return NextResponse.json({ error: 'Valid company_id required' }, { status: 400 });
  }

  const authResult = await requireAuthAndCompany(companyId);
  if (authResult instanceof NextResponse) return authResult;

  const suggestions = await documentService.getPendingSuggestions(companyId);
  return NextResponse.json({ suggestions });
}
