import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, documentSuggestions, documents, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

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

  // Verify the user owns the company this suggestion belongs to
  const [company] = await db.select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, suggestion.company_id), eq(companies.owner_id, user.id)))
    .limit(1);

  if (!company) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
