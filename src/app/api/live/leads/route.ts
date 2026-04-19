// POST /api/live/leads — public lead capture from company live wall / public site
// No auth required — visitors submit email from the public page.
// Stores lead in contacts table, emits event so CEO can follow up.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db, contacts, companies, platformEvents } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { parseJsonBody, isApiError } from '@/lib/api-utils';
import { leadCaptureSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = leadCaptureSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const slug = request.nextUrl.searchParams.get('company');
  if (!slug) {
    return NextResponse.json({ error: 'company slug required' }, { status: 400 });
  }

  // Resolve company by slug
  const [company] = await db.select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);

  if (!company) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Deduplicate — don't insert if this email already exists for this company
  const [existing] = await db.select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.company_id, company.id), eq(contacts.email, email)))
    .limit(1);

  if (existing) {
    return NextResponse.json({ captured: true, message: 'Already registered.' });
  }

  // Insert lead
  await db.insert(contacts).values({
    company_id: company.id,
    email,
    name: parsed.data.name ?? null,
    source: parsed.data.source ?? 'live_wall',
    lead_status: 'new',
    email_verified: false,
  });

  // Emit event so CEO/dashboard sees the new lead
  await db.insert(platformEvents).values({
    company_id: company.id,
    event_type: 'lead_captured',
    payload: { email, source: parsed.data.source ?? 'live_wall' },
    is_public_safe: false,
  });

  return NextResponse.json({ captured: true, message: 'Thanks for your interest!' });
}
