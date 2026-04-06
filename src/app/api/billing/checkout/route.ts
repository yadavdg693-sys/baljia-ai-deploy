// POST /api/billing/checkout
// Body: { companyId, planTier } — subscription upgrade
// Body: { companyId, credits }  — credit purchase
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, parseJsonBody, isApiError } from '@/lib/api-utils';
import { createCheckoutSession, createCreditPurchaseSession } from '@/lib/services/billing.service';
import type { PlanTier } from '@/types';

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const { companyId, planTier, credits } = body as {
    companyId?: string;
    planTier?: string;
    credits?: number;
  };

  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/${companyId}`;

  try {
    if (credits) {
      // Validate credits is a positive integer from allowed packages
      const ALLOWED_CREDIT_AMOUNTS = [10, 50, 100];
      if (!Number.isInteger(credits) || credits <= 0) {
        return NextResponse.json({ error: 'credits must be a positive integer' }, { status: 400 });
      }
      if (!ALLOWED_CREDIT_AMOUNTS.includes(credits)) {
        return NextResponse.json({ error: `credits must be one of: ${ALLOWED_CREDIT_AMOUNTS.join(', ')}` }, { status: 400 });
      }
      const session = await createCreditPurchaseSession(companyId, credits, returnUrl);
      return NextResponse.json(session);
    }

    if (planTier && planTier !== 'trial') {
      const session = await createCheckoutSession(companyId, planTier as Exclude<PlanTier, 'trial'>, returnUrl);
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: 'planTier or credits required' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
