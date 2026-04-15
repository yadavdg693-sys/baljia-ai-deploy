// PATCH /api/users/profile — update logged-in user's profile fields
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/auth';
import { db, users } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const { name, twitter_handle, timezone } = body as Record<string, string | null | undefined>;

  // Validate twitter_handle format
  if (twitter_handle != null && twitter_handle !== '' && !/^@?[A-Za-z0-9_]{1,50}$/.test(twitter_handle)) {
    return NextResponse.json({ error: 'Invalid Twitter handle format' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (name !== undefined) updates.name = name?.trim() || null;
  if (twitter_handle !== undefined) {
    // Normalise: always store with @ prefix
    const handle = twitter_handle?.trim().replace(/^@/, '');
    updates.twitter_handle = handle ? `@${handle}` : null;
  }
  if (timezone !== undefined) updates.timezone = timezone?.trim() || null;

  await db.update(users).set(updates).where(eq(users.id, session.id));

  return NextResponse.json({ ok: true });
}
