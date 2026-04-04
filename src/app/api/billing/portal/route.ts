// POST /api/billing/portal — Stripe customer portal session
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, parseJsonBody, isApiError } from '@/lib/api-utils';
import { createBillingPortalSession } from '@/lib/services/billing.service';

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const { companyId } = body as { companyId?: string };
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/${companyId}`;

  try {
    const session = await createBillingPortalSession(companyId, returnUrl);
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Portal session failed' },
      { status: 500 }
    );
  }
}
