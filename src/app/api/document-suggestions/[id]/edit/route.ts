import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, documentSuggestions, documents, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/document-suggestions/:id/edit
// Applies founder-edited content to the document, then marks suggestion as 'edited'
export async function POST(req: Request, { params }: Params) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;

  let content: string;
  try {
    const body = await req.json() as { content?: unknown };
    if (typeof body.content !== 'string' || body.content.trim().length === 0) {
      return NextResponse.json({ error: 'content must be a non-empty string' }, { status: 400 });
    }
    content = body.content.trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Fetch suggestion + verify ownership in one join
  const [row] = await db
    .select({
      document_id: documentSuggestions.document_id,
      company_id: documentSuggestions.company_id,
      owner_id: companies.owner_id,
    })
    .from(documentSuggestions)
    .innerJoin(companies, eq(documentSuggestions.company_id, companies.id))
    .where(and(
      eq(documentSuggestions.id, id),
      eq(companies.owner_id, user.id),
    ))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Apply edited content to the document
  await db.update(documents)
    .set({ content, updated_at: new Date() })
    .where(eq(documents.id, row.document_id));

  // Mark suggestion as 'edited' (distinct from 'accepted' — tracks founder modified it)
  await db.update(documentSuggestions)
    .set({ status: 'edited', reviewed_at: new Date() })
    .where(eq(documentSuggestions.id, id));

  return NextResponse.json({ ok: true });
}
