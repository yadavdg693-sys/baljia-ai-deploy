// PATCH /api/companies/[companyId]/settings — update company settings
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany } from '@/lib/api-utils';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { isValidUUID } from '@/lib/uuid-validation';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  if (!isValidUUID(companyId)) {
    return NextResponse.json({ error: 'Invalid companyId' }, { status: 400 });
  }

  const authResult = await requireAuthAndCompany(companyId);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const { one_liner, timezone } = body as Record<string, string | undefined>;

  // C5-FIX: execution_state is NOT user-settable. Only internal services
  // (billing.service, guardrail.service, night-shift) may modify it.

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (typeof one_liner === 'string') updates.one_liner = one_liner.trim() || null;
  if (typeof timezone === 'string') updates.timezone = timezone.trim() || null;

  await db.update(companies).set(updates).where(eq(companies.id, companyId));

  return NextResponse.json({ ok: true });
}
