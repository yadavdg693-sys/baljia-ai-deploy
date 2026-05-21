// Payment Connection Service — CRUD for founder-owned Stripe/Razorpay creds
//
// Flow 2 from docs/baljiapayment.md: founder's customer pays founder directly,
// Baljia is just the integrator. Engineering agent reads connections via
// `getConnection(companyId, provider)` when running payment tools.
//
// Validation: on save we call the provider's identity endpoint to confirm the
// key works. Stripe: GET /v1/account. Razorpay: GET /v1/accounts/me.
// Validation runs at SAVE TIME ONLY — at agent runtime we trust the stored
// secret to avoid an extra round-trip per tool call.

import { db, paymentConnections } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { encryptPaymentSecret, decryptPaymentSecret, redactKey } from '@/lib/payment-crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('PaymentConnectionService');

export type PaymentProvider = 'stripe' | 'razorpay';
export type ConnectionMode = 'test' | 'live';
export type ConnectionStatus = 'connected' | 'invalid' | 'revoked';
export type AuthMethod = 'paste_key' | 'oauth';

export interface PublicConnection {
  id: string;
  company_id: string;
  provider: PaymentProvider;
  mode: ConnectionMode;
  auth_method: AuthMethod;
  publishable_key: string | null;
  account_id: string | null;
  display_name: string | null;
  status: ConnectionStatus;
  secret_key_redacted: string;  // for UI display, never the real key
  last_validated_at: Date | null;
  connected_at: Date;
}

export interface ResolvedConnection {
  provider: PaymentProvider;
  mode: ConnectionMode;
  secret_key: string;          // decrypted, plaintext
  publishable_key: string | null;
  webhook_secret: string | null;
  account_id: string | null;
}

interface SaveInput {
  company_id: string;
  provider: PaymentProvider;
  secret_key: string;
  publishable_key?: string;
  webhook_secret?: string;
}

// ─── Provider validators ─────────────────────────────────────────────────────

interface ValidationResult {
  ok: boolean;
  mode: ConnectionMode;
  account_id: string | null;
  display_name: string | null;
  error?: string;
}

async function validateStripeKey(secretKey: string): Promise<ValidationResult> {
  // sk_test_... or sk_live_... — the prefix tells us the mode
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
    return { ok: false, mode: 'test', account_id: null, display_name: null,
      error: 'Stripe key must start with sk_test_ or sk_live_' };
  }
  const mode: ConnectionMode = secretKey.startsWith('sk_live_') ? 'live' : 'test';
  try {
    const resp = await fetch('https://api.stripe.com/v1/account', {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, mode, account_id: null, display_name: null,
        error: `Stripe rejected the key (${resp.status}). ${body.substring(0, 200)}` };
    }
    const account = await resp.json() as { id: string; business_profile?: { name?: string }; settings?: { dashboard?: { display_name?: string } } };
    const display = account.settings?.dashboard?.display_name || account.business_profile?.name || account.id;
    return { ok: true, mode, account_id: account.id, display_name: display };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, mode, account_id: null, display_name: null, error: `Stripe validation failed: ${msg}` };
  }
}

async function validateRazorpayKey(secretKey: string, keyId?: string): Promise<ValidationResult> {
  // Razorpay uses (key_id, key_secret) basic auth. publishable_key field carries key_id.
  if (!keyId) {
    return { ok: false, mode: 'test', account_id: null, display_name: null,
      error: 'Razorpay requires both key_id (publishable) and key_secret.' };
  }
  const mode: ConnectionMode = keyId.startsWith('rzp_live_') ? 'live' : 'test';
  try {
    const auth = btoa(`${keyId}:${secretKey}`);
    // Razorpay doesn't expose a clean /me endpoint — use /v1/payments?count=1 as a cheap auth probe.
    const resp = await fetch('https://api.razorpay.com/v1/payments?count=1', {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, mode, account_id: null, display_name: null,
        error: `Razorpay rejected credentials (${resp.status}). ${body.substring(0, 200)}` };
    }
    return { ok: true, mode, account_id: keyId, display_name: `Razorpay (${keyId.substring(0, 14)}...)` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, mode, account_id: null, display_name: null, error: `Razorpay validation failed: ${msg}` };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function saveConnection(input: SaveInput): Promise<{ ok: true; connection: PublicConnection } | { ok: false; error: string }> {
  const { company_id, provider, secret_key, publishable_key, webhook_secret } = input;

  // 1. Validate the key against the provider before we store anything.
  const validation = provider === 'stripe'
    ? await validateStripeKey(secret_key)
    : await validateRazorpayKey(secret_key, publishable_key);

  if (!validation.ok) {
    log.info('Connection validation failed', { company_id, provider, error: validation.error });
    return { ok: false, error: validation.error ?? 'Validation failed' };
  }

  // 2. Encrypt the secret before persisting.
  const encryptedSecret = await encryptPaymentSecret(secret_key);
  const encryptedWebhookSecret = webhook_secret ? await encryptPaymentSecret(webhook_secret) : null;

  // 3. Upsert: one connection per (company, provider) thanks to the unique index.
  const existing = await db.select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(and(eq(paymentConnections.company_id, company_id), eq(paymentConnections.provider, provider)))
    .limit(1);

  const now = new Date();
  if (existing.length > 0) {
    await db.update(paymentConnections)
      .set({
        mode: validation.mode,
        secret_key_encrypted: encryptedSecret,
        publishable_key: publishable_key ?? null,
        webhook_secret_encrypted: encryptedWebhookSecret,
        account_id: validation.account_id,
        display_name: validation.display_name,
        status: 'connected',
        last_validated_at: now,
        updated_at: now,
      })
      .where(eq(paymentConnections.id, existing[0].id));
  } else {
    await db.insert(paymentConnections).values({
      company_id,
      provider,
      mode: validation.mode,
      secret_key_encrypted: encryptedSecret,
      publishable_key: publishable_key ?? null,
      webhook_secret_encrypted: encryptedWebhookSecret,
      account_id: validation.account_id,
      display_name: validation.display_name,
      status: 'connected',
      last_validated_at: now,
    });
  }

  log.info('Payment connection saved', { company_id, provider, mode: validation.mode, account: validation.account_id });

  const saved = await listConnections(company_id);
  const justSaved = saved.find(c => c.provider === provider);
  if (!justSaved) return { ok: false, error: 'Saved but could not re-read connection' };
  return { ok: true, connection: justSaved };
}

export async function listConnections(company_id: string): Promise<PublicConnection[]> {
  const rows = await db.select().from(paymentConnections).where(eq(paymentConnections.company_id, company_id));
  return rows.map(r => ({
    id: r.id,
    company_id: r.company_id,
    provider: r.provider as PaymentProvider,
    mode: r.mode as ConnectionMode,
    auth_method: r.auth_method as AuthMethod,
    publishable_key: r.publishable_key,
    account_id: r.account_id,
    display_name: r.display_name,
    status: r.status as ConnectionStatus,
    secret_key_redacted: redactKey(r.publishable_key ?? r.account_id ?? '****'),
    last_validated_at: r.last_validated_at,
    connected_at: r.connected_at,
  }));
}

// Used by Engineering agent at task runtime. Returns the DECRYPTED secret.
// Returns null if no connection exists or status is not 'connected'.
export async function resolveConnection(company_id: string, provider: PaymentProvider): Promise<ResolvedConnection | null> {
  const [row] = await db.select().from(paymentConnections)
    .where(and(
      eq(paymentConnections.company_id, company_id),
      eq(paymentConnections.provider, provider),
    ))
    .limit(1);

  if (!row) return null;
  if (row.status !== 'connected') return null;

  const secretKey = await decryptPaymentSecret(row.secret_key_encrypted);
  const webhookSecret = row.webhook_secret_encrypted ? await decryptPaymentSecret(row.webhook_secret_encrypted) : null;

  return {
    provider,
    mode: row.mode as ConnectionMode,
    secret_key: secretKey,
    publishable_key: row.publishable_key,
    webhook_secret: webhookSecret,
    account_id: row.account_id,
  };
}

export async function deleteConnection(company_id: string, provider: PaymentProvider): Promise<boolean> {
  // If this is an OAuth connection, ask Stripe to deauthorize our access_token
  // (best-effort — we delete locally regardless so the founder isn't stuck).
  const [existing] = await db.select().from(paymentConnections)
    .where(and(
      eq(paymentConnections.company_id, company_id),
      eq(paymentConnections.provider, provider),
    ))
    .limit(1);

  if (existing && existing.auth_method === 'oauth' && provider === 'stripe' && existing.account_id) {
    await deauthorizeStripeAccount(existing.account_id).catch((err) => {
      log.warn('Stripe deauthorize failed (continuing with local delete)', {
        company_id, account_id: existing.account_id, error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }

  const result = await db.delete(paymentConnections)
    .where(and(
      eq(paymentConnections.company_id, company_id),
      eq(paymentConnections.provider, provider),
    ));
  log.info('Payment connection deleted', { company_id, provider });
  return (result as { rowCount?: number }).rowCount !== 0;
}

// ─── Stripe Connect OAuth ────────────────────────────────────────────────────

interface StripeOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  livemode: boolean;
  stripe_user_id: string;
  stripe_publishable_key?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange a Stripe OAuth authorization code for an access_token bound to the
 * connected account. Called from /api/oauth/stripe/callback.
 *
 * Required env:
 *   - STRIPE_PLATFORM_SECRET_KEY: Baljia's own Stripe secret key (sk_live_/sk_test_)
 */
export async function exchangeStripeOAuthCode(code: string): Promise<{ ok: true; token: StripeOAuthTokenResponse } | { ok: false; error: string }> {
  const platformSecret = process.env.STRIPE_PLATFORM_SECRET_KEY;
  if (!platformSecret) {
    return { ok: false, error: 'STRIPE_PLATFORM_SECRET_KEY env var not set on the server.' };
  }
  try {
    const resp = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${platformSecret}`,
      },
      body: new URLSearchParams({
        client_secret: platformSecret,
        code,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const body = await resp.json() as StripeOAuthTokenResponse;
    if (!resp.ok || body.error) {
      return { ok: false, error: body.error_description ?? body.error ?? `Stripe returned ${resp.status}` };
    }
    return { ok: true, token: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'OAuth token exchange failed' };
  }
}

/**
 * Persist a Stripe OAuth connection. Skips paste-key validation because the
 * token itself proves Stripe has authenticated the account.
 */
export async function saveOAuthStripeConnection(input: {
  company_id: string;
  token: StripeOAuthTokenResponse;
}): Promise<PublicConnection> {
  const { company_id, token } = input;
  const mode: ConnectionMode = token.livemode ? 'live' : 'test';

  const encryptedSecret = await encryptPaymentSecret(token.access_token);
  const now = new Date();

  const existing = await db.select({ id: paymentConnections.id })
    .from(paymentConnections)
    .where(and(eq(paymentConnections.company_id, company_id), eq(paymentConnections.provider, 'stripe')))
    .limit(1);

  if (existing.length > 0) {
    await db.update(paymentConnections)
      .set({
        mode,
        auth_method: 'oauth',
        secret_key_encrypted: encryptedSecret,
        publishable_key: token.stripe_publishable_key ?? null,
        webhook_secret_encrypted: null,
        account_id: token.stripe_user_id,
        display_name: `Stripe ${token.stripe_user_id}`,
        status: 'connected',
        last_validated_at: now,
        updated_at: now,
      })
      .where(eq(paymentConnections.id, existing[0].id));
  } else {
    await db.insert(paymentConnections).values({
      company_id,
      provider: 'stripe',
      mode,
      auth_method: 'oauth',
      secret_key_encrypted: encryptedSecret,
      publishable_key: token.stripe_publishable_key ?? null,
      webhook_secret_encrypted: null,
      account_id: token.stripe_user_id,
      display_name: `Stripe ${token.stripe_user_id}`,
      status: 'connected',
      last_validated_at: now,
    });
  }

  log.info('Stripe OAuth connection saved', { company_id, account_id: token.stripe_user_id, mode });

  const list = await listConnections(company_id);
  return list.find(c => c.provider === 'stripe')!;
}

/**
 * Revoke Baljia's access to a connected Stripe account. Called when the founder
 * clicks Disconnect on an OAuth connection.
 */
export async function deauthorizeStripeAccount(stripeUserId: string): Promise<void> {
  const platformSecret = process.env.STRIPE_PLATFORM_SECRET_KEY;
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!platformSecret || !clientId) {
    log.warn('Cannot deauthorize Stripe — missing env vars', {
      hasSecret: !!platformSecret, hasClientId: !!clientId,
    });
    return;
  }
  const resp = await fetch('https://connect.stripe.com/oauth/deauthorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${platformSecret}`,
    },
    body: new URLSearchParams({
      client_id: clientId,
      stripe_user_id: stripeUserId,
    }).toString(),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Stripe deauthorize returned ${resp.status}: ${body.substring(0, 200)}`);
  }
  log.info('Stripe account deauthorized', { stripe_user_id: stripeUserId });
}

export function buildStripeOAuthUrl(opts: { state: string; redirectUri: string }): string | null {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    state: opts.state,
    redirect_uri: opts.redirectUri,
  });
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

// Convenience used by Engineering tool error messages.
export function notConnectedMessage(provider: PaymentProvider): string {
  const label = provider === 'stripe' ? 'Stripe' : 'Razorpay';
  return [
    `Founder hasn't connected ${label} yet.`,
    `Tell the founder: "Go to Settings → Payments and paste your ${label} secret key (test mode works for development). It takes 30 seconds. Then re-run this task."`,
  ].join(' ');
}
