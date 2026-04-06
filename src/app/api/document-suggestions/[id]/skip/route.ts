import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, documentSuggestions, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/document-suggestions/:id/skip
export async function POST(_req: Request, { params }: Params) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;

  // Get suggestion to check ownership
  const [suggestion] = await db.select({ company_id: documentSuggestions.company_id })
    .from(documentSuggestions)
    .where(eq(documentSuggestions.id, id))
    .limit(1);

  if (!suggestion) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
  }

  // Verify the user owns the company
  const [company] = await db.select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, suggestion.company_id), eq(companies.owner_id, user.id)))
    .limit(1);

  if (!company) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Mark suggestion as skipped
  await db.update(documentSuggestions)
    .set({
      status: 'skipped',
      reviewed_at: new Date(),
    })
    .where(eq(documentSuggestions.id, id));

  return NextResponse.json({ ok: true });
}
