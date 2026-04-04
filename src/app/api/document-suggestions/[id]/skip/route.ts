import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, documentSuggestions } from '@/lib/db';
import { eq } from 'drizzle-orm';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/document-suggestions/:id/skip
export async function POST(_req: Request, { params }: Params) {
  const user = await getSessionFromCookies();
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;

  // Mark suggestion as skipped
  await db.update(documentSuggestions)
    .set({
      status: 'skipped',
      reviewed_at: new Date(),
    })
    .where(eq(documentSuggestions.id, id));

  return NextResponse.json({ ok: true });
}
