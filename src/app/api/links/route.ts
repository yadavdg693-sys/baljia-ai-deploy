// Dashboard quick links — founder-managed shortcuts surfaced in the dashboard.
// Mirrors the CEO `update_link` tool but exposed to the user-side UI.

import { NextRequest, NextResponse } from 'next/server';
import { db, dashboardLinks } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { requireAuthAndCompany, resolveBodyCompanyId, parseJsonBody, isApiError, getRequiredCompanyId } from '@/lib/api-utils';
import { upsertLinkSchema } from '@/lib/validations';

// GET /api/links?company_id=...
export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const rows = await db.select().from(dashboardLinks)
    .where(eq(dashboardLinks.company_id, companyId));
  return NextResponse.json(rows);
}

// POST /api/links — upsert a link by (company_id, label)
export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const companyId = await resolveBodyCompanyId(body as Record<string, unknown>);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const { company_id: _, ...rest } = body as Record<string, unknown>;
  const parsed = upsertLinkSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await db.insert(dashboardLinks).values({
    company_id: companyId,
    label: parsed.data.label,
    url: parsed.data.url,
  }).onConflictDoUpdate({
    target: [dashboardLinks.company_id, dashboardLinks.label],
    set: { url: parsed.data.url },
  });

  return NextResponse.json({ ok: true, label: parsed.data.label, url: parsed.data.url });
}

// DELETE /api/links?company_id=...&label=...
export async function DELETE(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const label = request.nextUrl.searchParams.get('label');
  if (!label) return NextResponse.json({ error: 'label query param required' }, { status: 400 });

  await db.delete(dashboardLinks).where(and(
    eq(dashboardLinks.company_id, companyId),
    eq(dashboardLinks.label, label),
  ));
  return NextResponse.json({ ok: true });
}
