import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, documentSuggestions, documents } from '@/lib/db';
import { eq } from 'drizzle-orm';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/document-suggestions/:id/accept
export async function POST(_req: Request, { params }: Params) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;

  // Get the suggestion
  const [suggestion] = await db
    .select()
    .from(documentSuggestions)
    .where(eq(documentSuggestions.id, id))
    .limit(1);

  if (!suggestion) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
  }

  // Apply the suggested content to the document
  await db.update(documents)
    .set({
      content: suggestion.suggested_content,
      updated_at: new Date(),
    })
    .where(eq(documents.id, suggestion.document_id));

  // Mark suggestion as accepted
  await db.update(documentSuggestions)
    .set({
      status: 'accepted',
      reviewed_at: new Date(),
    })
    .where(eq(documentSuggestions.id, id));

  return NextResponse.json({ ok: true });
}
