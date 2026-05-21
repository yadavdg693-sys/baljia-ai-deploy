// GET /api/oauth/stripe/callback?code=...&state=...
//
// Stripe redirects here after the founder authorizes Baljia. We:
//   1. Validate the state nonce against the cookie set by /authorize.
//   2. Confirm the caller still owns the company encoded in the cookie.
//   3. Exchange the code for an access_token via Stripe's OAuth endpoint.
//   4. Persist the OAuth connection (encrypted access_token + stripe_user_id).
//   5. Redirect back to the founder's settings page.
//
// On error we redirect back to settings with ?stripe_error=<msg> so the UI
// can surface what went wrong.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAndCompany, isApiError } from '@/lib/api-utils';
import { exchangeStripeOAuthCode, saveOAuthStripeConnection } from '@/lib/services/payment-connection.service';

const STATE_COOKIE = 'baljia-stripe-oauth-state';

interface StateCookiePayload {
  nonce: string;
  company_id: string;
  return_to: string;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const stripeError = request.nextUrl.searchParams.get('error_description') ?? request.nextUrl.searchParams.get('error');

  const cookieRaw = request.cookies.get(STATE_COOKIE)?.value;
  let cookie: StateCookiePayload | null = null;
  try {
    cookie = cookieRaw ? JSON.parse(cookieRaw) as StateCookiePayload : null;
  } catch {
    cookie = null;
  }

  // Default landing page if anything is malformed: the portfolio.
  const fallbackOrigin = request.nextUrl.origin;
  function fail(msg: string): NextResponse {
    const target = cookie?.return_to
      ? `${fallbackOrigin}${cookie.return_to}${cookie.return_to.includes('?') ? '&' : '?'}stripe_error=${encodeURIComponent(msg)}`
      : `${fallbackOrigin}/portfolio?stripe_error=${encodeURIComponent(msg)}`;
    const resp = NextResponse.redirect(target);
    resp.cookies.delete(STATE_COOKIE);
    return resp;
  }

  if (stripeError) return fail(stripeError);
  if (!code) return fail('Missing code from Stripe callback');
  if (!cookie) return fail('OAuth state cookie missing or expired. Try again.');
  if (!state || state !== cookie.nonce) return fail('OAuth state nonce mismatch (CSRF guard).');

  // Re-verify ownership at callback time — protects against the user logging
  // out / changing accounts between /authorize and /callback.
  const auth = await requireAuthAndCompany(cookie.company_id);
  if (isApiError(auth)) return fail('You are not authorized for this company.');

  const exchange = await exchangeStripeOAuthCode(code);
  if (!exchange.ok) return fail(exchange.error);

  try {
    await saveOAuthStripeConnection({ company_id: cookie.company_id, token: exchange.token });
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Failed to save connection');
  }

  const target = `${fallbackOrigin}${cookie.return_to}${cookie.return_to.includes('?') ? '&' : '?'}stripe_connected=1`;
  const response = NextResponse.redirect(target);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
