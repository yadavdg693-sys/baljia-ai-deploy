// GET    /api/payment-connections?company_id=... — list founder's connected providers
// POST   /api/payment-connections — connect / re-connect a provider (Stripe or Razorpay)
// DELETE /api/payment-connections?company_id=...&provider=stripe — disconnect a provider

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, parseJsonBody, isApiError } from '@/lib/api-utils';
import { saveConnection, listConnections, deleteConnection, type PaymentProvider } from '@/lib/services/payment-connection.service';
import { z } from 'zod';

const ALLOWED_PROVIDERS: PaymentProvider[] = ['stripe', 'razorpay'];

const postSchema = z.object({
  company_id: z.string().uuid(),
  provider: z.enum(['stripe', 'razorpay']),
  secret_key: z.string().min(8).max(500),
  publishable_key: z.string().max(500).optional(),
  webhook_secret: z.string().max(500).optional(),
});

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const connections = await listConnections(companyId);
  return NextResponse.json({ connections });
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await requireAuthAndCompany(parsed.data.company_id);
  if (isApiError(auth)) return auth;

  const result = await saveConnection(parsed.data);
  if (!result.ok) {
    // Validation failed against the provider (bad key, network error, etc.)
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ connection: result.connection });
}

export async function DELETE(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('company_id');
  const provider = request.nextUrl.searchParams.get('provider');
  if (!companyId || !provider) {
    return NextResponse.json({ error: 'company_id and provider are required' }, { status: 400 });
  }
  if (!ALLOWED_PROVIDERS.includes(provider as PaymentProvider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const deleted = await deleteConnection(companyId, provider as PaymentProvider);
  return NextResponse.json({ deleted });
}
