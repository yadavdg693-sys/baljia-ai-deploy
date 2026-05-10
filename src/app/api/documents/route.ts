import { NextRequest, NextResponse } from 'next/server';
import * as documentService from '@/lib/services/document.service';
import { requireAuthAndCompany, getRequiredCompanyId, isApiError } from '@/lib/api-utils';
import { CODEBASE_MAP_DOC_TYPE } from '@/lib/services/codebase-map.service';

// Internal-only doc types — never returned to founder dashboard.
const INTERNAL_DOC_TYPES = new Set<string>([CODEBASE_MAP_DOC_TYPE]);

export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const documents = await documentService.getDocuments(companyId);
  // Filter out engineering-internal documents (codebase_map etc.) so they
  // don't render as cards on the founder dashboard.
  const founderVisible = documents.filter((d) => !INTERNAL_DOC_TYPES.has(d.doc_type));
  return NextResponse.json(founderVisible);
}
