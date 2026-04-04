import { NextRequest, NextResponse } from 'next/server';
import * as documentService from '@/lib/services/document.service';
import * as eventService from '@/lib/services/event.service';
import { updateDocumentSchema } from '@/lib/validations';
import { requireAuth, requireCompanyOwnership, parseJsonBody, isApiError } from '@/lib/api-utils';

async function getDocWithAuth(documentId: string) {
  const auth = await requireAuth();
  if (isApiError(auth)) return { error: auth } as const;

  const doc = await documentService.getDocument(documentId);
  if (!doc) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const;

  const ownership = await requireCompanyOwnership(doc.company_id, auth.user.id);
  if (isApiError(ownership)) return { error: ownership } as const;

  return { doc } as const;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const result = await getDocWithAuth(documentId);
  if ('error' in result) return result.error;

  return NextResponse.json(result.doc);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const result = await getDocWithAuth(documentId);
  if ('error' in result) return result.error;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = updateDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await documentService.updateDocument(documentId, parsed.data.content);

  await eventService.emit(result.doc.company_id, 'document_updated', {
    document_id: result.doc.id,
    doc_type: result.doc.doc_type,
  });

  return NextResponse.json(updated);
}
