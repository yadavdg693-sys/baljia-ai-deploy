// GET  /api/companies — list all companies owned by the authenticated user
// PATCH /api/companies — update company fields (requires company_id in body)

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAuthAndCompany, resolveBodyCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET() {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const rows = await db.select({
    id: companies.id,
    name: companies.name,
    slug: companies.slug,
    one_liner: companies.one_liner,
    plan_tier: companies.plan_tier,
    lifecycle: companies.lifecycle,
    company_stage: companies.company_stage,
  }).from(companies).where(eq(companies.owner_id, auth.user.id));

  return NextResponse.json(rows);
}

export async function PATCH(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const companyId = await resolveBodyCompanyId(body as Record<string, unknown>);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const { name } = body as { name?: string };
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (name !== undefined) updates.name = name.trim() || null;

  await db.update(companies).set(updates).where(eq(companies.id, companyId));

  return NextResponse.json({ ok: true });
}
