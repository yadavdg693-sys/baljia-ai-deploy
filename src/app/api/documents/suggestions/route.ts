import { NextRequest, NextResponse } from 'next/server';
import * as documentService from '@/lib/services/document.service';
import { documentSuggestionReviewSchema } from '@/lib/validations';
import { requireAuthAndCompany, requireAuth, requireCompanyOwnership, getRequiredCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';
import { db, documentSuggestions } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const suggestions = await documentService.getPendingSuggestions(companyId);
  return NextResponse.json(suggestions);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const { suggestion_id, ...reviewData } = body as Record<string, unknown>;
  if (!suggestion_id || typeof suggestion_id !== 'string') {
    return NextResponse.json({ error: 'suggestion_id required' }, { status: 400 });
  }

  const parsed = documentSuggestionReviewSchema.safeParse(reviewData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify ownership: suggestion → document → company → owner
  const [suggestion] = await db.select({ document_id: documentSuggestions.document_id })
    .from(documentSuggestions).where(eq(documentSuggestions.id, suggestion_id)).limit(1);

  if (!suggestion) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });

  const doc = await documentService.getDocument(suggestion.document_id);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ownership = await requireCompanyOwnership(doc.company_id, auth.user.id);
  if (isApiError(ownership)) return ownership;

  await documentService.reviewSuggestion(
    suggestion_id as string,
    parsed.data.action,
    parsed.data.edited_content
  );

  return NextResponse.json({ success: true });
}
