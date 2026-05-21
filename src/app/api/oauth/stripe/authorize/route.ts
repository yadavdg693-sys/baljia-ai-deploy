// GET /api/oauth/stripe/authorize?company_id=<uuid>&return_to=<path>
//
// Starts the Stripe Connect Standard OAuth flow:
//   1. Verify the caller owns the company.
//   2. Generate a CSRF state nonce + set it in an httpOnly cookie.
//      The cookie also encodes company_id and return_to so the callback
//      knows where to land after the exchange.
//   3. 302 redirect to Stripe's authorize URL.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, isApiError } from '@/lib/api-utils';
import { buildStripeOAuthUrl } from '@/lib/services/payment-connection.service';

const STATE_COOKIE = 'baljia-stripe-oauth-state';
const STATE_COOKIE_TTL_S = 600; // 10 minutes

export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('company_id');
  const returnTo = request.nextUrl.searchParams.get('return_to') ?? '/portfolio';
  if (!companyId) return NextResponse.json({ error: 'company_id is required' }, { status: 400 });

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  // Build the redirect URI Stripe will send the user back to. Use the same
  // origin as the incoming request so it works in dev / preview / prod
  // without an extra env var.
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/oauth/stripe/callback`;

  // CSRF state = random nonce. We also need to remember which company + return_to
  // when the callback fires — pack everything into the cookie value.
  const nonce = generateNonce(32);
  const cookieValue = JSON.stringify({ nonce, company_id: companyId, return_to: returnTo });

  const authorizeUrl = buildStripeOAuthUrl({ state: nonce, redirectUri });
  if (!authorizeUrl) {
    return NextResponse.json({
      error: 'Stripe Connect OAuth is not configured on this server (STRIPE_CONNECT_CLIENT_ID missing).',
    }, { status: 500 });
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_COOKIE_TTL_S,
  });
  return response;
}

function generateNonce(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
