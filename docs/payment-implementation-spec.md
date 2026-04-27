# Payment Implementation Spec

**Audience:** Engineers building Flow 1 / Flow 2 payment code
**Companion to:** [baljiapayment.md](./baljiapayment.md) (decision log)
**Scope:** TypeScript contracts, database schema, webhook architecture, idempotency, secrets, testing, code drift audit

---

## PaymentProvider Interface (TypeScript contract)

All Flow 1 provider implementations conform to this interface. Defined in `src/lib/services/payment-provider.service.ts`.

```typescript
export type BillingProvider = 'dodo' | 'razorpay' | 'stripe' | 'paddle' | 'stripe_legacy';

export interface ProviderCheckoutOptions {
  companyId: string;
  email: string;
  country: string;           // ISO-2
  currency: 'USD' | 'INR' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
  planPriceId: string;       // provider-scoped price id
  trialDays?: number;        // null/0 means no trial
  idempotencyKey: string;    // required, format: baljia:{companyId}:checkout:{yyyy-mm-ddThh}
  returnUrlSuccess: string;
  returnUrlCancel: string;
  metadata: Record<string, string>;
}

export interface ProviderCheckoutResult {
  sessionId: string;
  url: string;
  customerId: string;
  subscriptionId?: string;
  status: 'trialing' | 'active' | 'incomplete' | 'unpaid';
}

export interface CreditPurchaseOptions {
  companyId: string;
  email: string;
  country: string;
  credits: 30 | 100 | 300;   // pack sizes
  priceCents: number;
  idempotencyKey: string;
  returnUrlSuccess: string;
  returnUrlCancel: string;
}

export interface PaymentDomainEvent {
  kind:
    | 'subscription.trial_started'
    | 'subscription.activated'
    | 'subscription.renewed'
    | 'subscription.past_due'
    | 'subscription.cancelled'
    | 'payment.failed'
    | 'payment.succeeded'
    | 'refund.issued'
    | 'dispute.opened'
    | 'dispute.resolved'
    | 'credit_pack.purchased';
  providerEventId: string;
  providerEventTs: number;    // ms since epoch, from provider
  companyId: string | null;
  subscriptionId: string | null;
  customerId: string;
  currency: string;
  amountCents: number | null;
  raw: unknown;               // original payload, for replay
}

export interface PaymentProvider {
  readonly provider: BillingProvider;
  readonly supportedCountries: readonly string[];   // ISO-2 allow list
  readonly supportedCurrencies: readonly string[];

  createCheckout(opts: ProviderCheckoutOptions): Promise<ProviderCheckoutResult>;
  createCreditPurchase(opts: CreditPurchaseOptions): Promise<ProviderCheckoutResult>;
  getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string>;

  cancelSubscription(
    subscriptionId: string,
    when: 'now' | 'period_end',
    idempotencyKey: string
  ): Promise<void>;

  refund(
    chargeId: string,
    amountCents: number | 'full',
    idempotencyKey: string
  ): Promise<string>;                    // returns refundId

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    secret: string,
  ): { valid: true; providerEvent: unknown } | { valid: false; reason: string };

  normalizeEvent(providerEvent: unknown): PaymentDomainEvent | null;
}

// Routing — SIMPLIFIED: Dodo-only for Flow 1 (all countries including India)
// Paddle is warm fallback; activated via env var PRIMARY_PROVIDER=paddle if Dodo freezes Baljia

export function selectProvider(country: string): BillingProvider {
  const primary = (process.env.PRIMARY_PROVIDER ?? 'dodo') as BillingProvider;
  // No GeoIP routing needed — single provider for all countries
  return primary;
}

// For Flow 2 (founder-picks-own-provider): selectProvider is NOT used — founder chooses
// at connection time in the Integrations panel:
//   - Foreign founders connect Stripe
//   - Indian founders connect Dodo
//   - Both patterns use Payment Link URL + webhook secret (provider-agnostic in our code)

// Error hierarchy
export class ProviderError extends Error {
  constructor(
    public provider: BillingProvider,
    public code: 'transient' | 'permanent' | 'rate_limited' | 'fraud_declined' | 'unknown',
    public retryable: boolean,
    message: string,
    public providerDetail?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
```

### Routing rules (simplified Dodo-only)

**Flow 1:** all founders route to Dodo (single provider). No GeoIP needed.

**Flow 1 fallback:** if Dodo freezes Baljia → flip `PRIMARY_PROVIDER=paddle` env var and redeploy. `PaymentProvider` abstraction makes this a config change, not a code rewrite.

**Flow 2 (founder picks own provider in Integrations panel):**
- Foreign founders → Stripe (Payment Link URL + webhook secret)
- Indian founders → Dodo (Payment Link URL + webhook secret)
- Both stored identically in `founder_payment_connections` — provider is just a label

**Why no GeoIP for Flow 1:** Dodo as MoR handles all currencies, all countries, all tax compliance. Baljia receives net USD payout from Dodo via SWIFT (or configured bank method). No per-country routing logic needed.

---

## Database Schema Migration (Drizzle)

### Step 1: Additive columns (non-destructive)

```typescript
// src/lib/db/schema.ts — subscriptions additions
export const subscriptions = pgTable('subscriptions', {
  // ... existing columns ...

  // NEW polymorphic columns (all nullable during migration)
  billing_provider: varchar('billing_provider', { length: 20 }).default('stripe_legacy'),
  billing_provider_customer_id: varchar('billing_provider_customer_id', { length: 255 }),
  billing_provider_subscription_id: varchar('billing_provider_subscription_id', { length: 255 }),
  billing_country: varchar('billing_country', { length: 5 }),
  currency: varchar('currency', { length: 5 }).default('USD'),
  provider_status: varchar('provider_status', { length: 50 }),
  latest_provider_event_id: varchar('latest_provider_event_id', { length: 255 }),
  latest_provider_event_ts: timestamp('latest_provider_event_ts', { withTimezone: true }),
}, (t) => [
  uniqueIndex('idx_subscriptions_company_provider').on(t.company_id, t.billing_provider),
  index('idx_subscriptions_billing_country').on(t.billing_country),
]);

// revenue_ledger rename
ALTER TABLE revenue_ledger RENAME COLUMN stripe_charge_id TO provider_charge_id;
ALTER TABLE revenue_ledger ADD COLUMN billing_provider varchar(20) DEFAULT 'stripe_legacy';

// ad_spend_ledger — same rename
```

### Step 2: New table — `webhook_events` (race-free dedupe)

```typescript
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: varchar('provider', { length: 20 }).notNull(),
  provider_event_id: varchar('provider_event_id', { length: 255 }).notNull(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  signature_header: text('signature_header'),
  received_at: timestamp('received_at', { withTimezone: true }).defaultNow(),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  processing_attempts: integer('processing_attempts').default(0),
  last_error: text('last_error'),
}, (t) => [
  // Unique constraint enables ON CONFLICT DO NOTHING for dedupe
  uniqueIndex('idx_webhook_events_provider_id').on(t.provider, t.provider_event_id),
  // Partial index for unprocessed events (webhook retry scanning)
  index('idx_webhook_events_unprocessed').on(t.provider, t.received_at),
]);
```

**Replaces** `platform_events.payload->>'stripe_event_id'` LIKE-style dedupe — which has a race condition + no unique index.

### Step 3: New table — `founder_payment_connections` (Flow 2)

```typescript
export const founderPaymentConnections = pgTable('founder_payment_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 20 }).notNull(),
  connection_type: varchar('connection_type', { length: 30 }).notNull(),
  // connection_type: 'payment_link' | 'oauth' | 'secret_key'

  // For Payment Link pattern (v1)
  payment_link_url: text('payment_link_url'),
  webhook_secret_encrypted: text('webhook_secret_encrypted'),

  // For OAuth pattern (v1.1)
  oauth_access_token_encrypted: text('oauth_access_token_encrypted'),
  oauth_refresh_token_encrypted: text('oauth_refresh_token_encrypted'),
  oauth_token_expires_at: timestamp('oauth_token_expires_at', { withTimezone: true }),
  scopes: jsonb('scopes').$type<string[]>(),

  // Encryption versioning
  key_version: integer('key_version').default(1),   // for CREDENTIAL_KEK rotation

  status: varchar('status', { length: 30 }).default('pending'),
  // status: 'pending' | 'active' | 'revoked' | 'failed' | 'expired'

  last_verified_at: timestamp('last_verified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('idx_fpc_company_provider_type').on(t.company_id, t.provider, t.connection_type),
  index('idx_fpc_status').on(t.status),
]);
```

### Step 4: Missing `expire_stale_trials()` PG function

`src/app/api/cron/trial-expiry/route.ts:25` calls `expire_stale_trials()` which doesn't exist. Either define it in a migration OR replace with Drizzle SQL:

```typescript
// Option B: replace function call with Drizzle
await db.update(companies)
  .set({ onboarding_status: 'failed', billing_state: 'cancelled' })
  .where(and(
    eq(companies.onboarding_status, 'running'),
    lt(companies.updated_at, sql`now() - interval '10 minutes'`),
  ));
```

### Migration rollout

1. **PR 1:** Add columns + tables (nullable, non-destructive). Default `billing_provider='stripe_legacy'` on existing rows. Deploy.
2. **PR 2:** Dual-write — billing service writes both old and new columns for 48h observation.
3. **PR 3:** Flip readers to new columns. Keep old columns nullable for rollback window.
4. **PR 4 (post-30 days):** Drop old Stripe-only columns (`stripe_customer_id`, `stripe_subscription_id`, etc.).

Existing Stripe customers remain on `billing_provider='stripe_legacy'` indefinitely. New signups route Dodo/Razorpay.

---

## Webhook Architecture

### Endpoint layout — simplified (Dodo-only + legacy + fallback)

All routes use Node.js runtime for raw-body access:

```
POST /api/webhooks/stripe       — existing, legacy (only for stripe_legacy customers)
POST /api/webhooks/dodo         — primary Flow 1
POST /api/webhooks/paddle       — warm fallback (enabled if Dodo freezes)
```

~~`POST /api/webhooks/razorpay`~~ — NOT needed in simplified architecture

### Processing pipeline (enforced by shared wrapper)

```
1. Read raw body (request.text()) — NEVER use request.json() (mangles signature)

2. Verify signature:
   const result = provider.verifyWebhookSignature(rawBody, headers, env.SECRET);
   if (!result.valid) {
     Sentry.captureMessage('webhook.signature_invalid', { tags: { provider } });
     return NextResponse.json({ error: result.reason }, { status: 400 });
   }

3. Dedupe via unique constraint:
   const [inserted] = await db.insert(webhookEvents).values({
     provider, provider_event_id, event_type, payload, ...
   }).onConflictDoNothing().returning({ id: webhookEvents.id });

   if (!inserted) return NextResponse.json({ deduplicated: true });

4. Normalize to internal event:
   const event = provider.normalizeEvent(result.providerEvent);
   if (!event) return NextResponse.json({ unhandled: true });

5. Apply in single DB transaction:
   await db.transaction(async (tx) => {
     // a. Out-of-order protection
     const sub = await tx.select().from(subscriptions)
       .where(eq(subscriptions.id, event.subscriptionId)).for('update');
     if (sub.latest_provider_event_ts >= event.providerEventTs) {
       // older event, skip
       return;
     }

     // b. Apply business effect
     await applyDomainEvent(tx, event);

     // c. Mark webhook processed + update subscription event marker
     await tx.update(webhookEvents)
       .set({ processed_at: new Date() })
       .where(eq(webhookEvents.id, inserted.id));
     await tx.update(subscriptions)
       .set({
         latest_provider_event_id: event.providerEventId,
         latest_provider_event_ts: new Date(event.providerEventTs),
       })
       .where(eq(subscriptions.id, event.subscriptionId));
   });

6. Return 200.

7. On exception in step 5: rollback, leave processed_at NULL, increment processing_attempts.
   Return 500. Provider retries.
```

### Signature verification per provider

| Provider | Algorithm | Verification approach |
|---|---|---|
| **Dodo (primary)** | [standardwebhooks](https://github.com/standard-webhooks/standard-webhooks) — `webhook-id`, `webhook-timestamp`, `webhook-signature` headers, HMAC-SHA256 `v1,{signature}` | `new Webhook(secret).verify(body, headers)` |
| Paddle (fallback) | `paddle-signature` header with `ts={timestamp};h1={signature}` parts, HMAC-SHA256 over `{timestamp}:{body}` | Custom verifier function |
| Stripe (legacy only) | HMAC-SHA256 with `Stripe-Signature` header (includes `t=` timestamp + `v1=` signature) | `stripe.webhooks.constructEvent(body, signature, secret)` |

### Dev webhook tunneling

**Recommended: Cloudflare Tunnel** (Windows-compatible, stable URL):

```bash
cloudflared tunnel --url http://localhost:3000
# Copy the generated https://XXXX.trycloudflare.com URL
# Register in each provider's dashboard with NON-PROD webhook secret
```

Each dev uses their own tunnel + their own `DODO_SANDBOX_WEBHOOK_SECRET` (not shared), so registering tunnels doesn't conflict.

`npm run dev:webhook-tunnel` helper script prints the URLs to register at:
- Dodo: `https://your-tunnel.trycloudflare.com/api/webhooks/dodo`
- Razorpay: `https://your-tunnel.trycloudflare.com/api/webhooks/razorpay`
- Paddle: `https://your-tunnel.trycloudflare.com/api/webhooks/paddle`

---

## Idempotency Key Conventions

All outbound Flow 1 provider calls MUST pass an idempotency key. This protects against:
- Double-submit from frontend (two rapid clicks)
- Transient network retry on failed call
- Browser tab duplication

### Key scopes and formats

| Operation | Key format | Valid retry window |
|---|---|---|
| Create customer | `baljia:{companyId}:customer:{country}` | Forever (customer created once per country per company) |
| Create checkout session | `baljia:{companyId}:checkout:{yyyy-mm-ddThh}` | 1 hour (rotate hourly to allow retry) |
| Create credit purchase | `baljia:{companyId}:creditpack:{packSize}:{nonce}` | One-shot (each click is unique via nonce) |
| Cancel subscription | `baljia:{companyId}:cancel:{subscriptionId}` | Forever |
| Refund | `baljia:{taskId}:refund:{amountCents}` | Forever (task-level refund is unique) |

### Per-provider wiring

```typescript
// Stripe
stripe.checkout.sessions.create(params, { idempotencyKey });

// Razorpay
await fetch('https://api.razorpay.com/v1/...', {
  headers: { 'X-Razorpay-Idempotency': idempotencyKey, ... },
});

// Dodo
await fetch('https://api.dodopayments.com/...', {
  headers: { 'Idempotency-Key': idempotencyKey, ... },
});

// Paddle
await paddleClient.transactions.create({ ...params, custom_data: { request_id: idempotencyKey } });
```

### Frontend double-submit guard

```typescript
// UpgradeDialog.tsx
const [busy, setBusy] = useState(false);

async function handleStartTrial() {
  if (busy) return;                  // guard 1
  setBusy(true);

  const idempotencyKey = crypto.randomUUID();  // unique per click
  try {
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({
        company_id: company.id,
        plan: 'pro',
        idempotency_key: idempotencyKey,
      }),
    });
    const { url } = await res.json();
    window.location.href = url;
  } catch (err) {
    setBusy(false);
    toast.error('Something went wrong. Try again.');
  }
}
```

### Server-side advisory lock (race protection)

```typescript
// src/lib/services/billing.service.ts — createCheckoutSession
await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing:' + companyId}))`);
// Lock held for duration of transaction
```

Prevents two concurrent requests from creating two customers for the same company.

---

## Secrets & Key Management

### Env var layout

| Env var | Purpose | Rotation cadence | Storage |
|---|---|---|---|
| `AUTH_SECRET` | Session JWT signing only | Quarterly | Render `sync:false` |
| **`CREDENTIAL_KEK`** (NEW) | AES-256-GCM KEK for `founder_payment_connections.*_encrypted` | Yearly | Render + `key_version` column for rollover |
| `DODO_API_KEY` / `DODO_WEBHOOK_SIGNING_SECRET` | Dodo Flow 1 | On compromise | Render |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Razorpay Flow 1 | On compromise | Render |
| `PADDLE_API_KEY` / `PADDLE_NOTIFICATION_SECRET` | Paddle fallback | On compromise | Render |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Legacy existing-customer handling only | On compromise | Render |
| `RAZORPAY_PARTNER_CLIENT_ID` / `RAZORPAY_PARTNER_CLIENT_SECRET` | Flow 2 OAuth (v1.1) | On compromise | Render |

### Critical fix: split AUTH_SECRET from CREDENTIAL_KEK

**Current bug in `src/lib/credential-crypto.ts:64-68`:**

```typescript
// CURRENT (wrong): derives AES key from AUTH_SECRET
const key = crypto.createHash('sha256').update(process.env.AUTH_SECRET).digest();
```

**Consequence:** rotating `AUTH_SECRET` bricks every stored credential + every session cookie simultaneously. Existential rotation hazard.

**Fix:**

```typescript
// FIXED: separate env var for credential encryption
const CURRENT_KEK = Buffer.from(process.env.CREDENTIAL_KEK!, 'base64');
const PREVIOUS_KEK = process.env.CREDENTIAL_KEK_PREVIOUS
  ? Buffer.from(process.env.CREDENTIAL_KEK_PREVIOUS, 'base64')
  : null;

export function encrypt(plaintext: string): { ciphertext: string; keyVersion: number } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CURRENT_KEK, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, ct]).toString('base64'),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decrypt(ciphertext: string, keyVersion: number): string {
  const key = keyVersion === CURRENT_KEY_VERSION ? CURRENT_KEK : PREVIOUS_KEK;
  if (!key) throw new Error(`No KEK for version ${keyVersion}`);
  // ... decrypt with correct KEK based on key_version
}
```

### Rotation SOP — webhook secrets (dual-signing window)

1. Generate new secret at provider dashboard
2. Store as `{PROVIDER}_WEBHOOK_SECRET_NEXT` in Render env alongside current
3. Deploy handler that tries NEXT first, falls back to current
4. Register new secret at provider (provider starts signing with new secret)
5. Wait 48h (in-flight events all processed)
6. Remove old secret env var, simplify handler

### Rotation SOP — `CREDENTIAL_KEK`

1. Generate new KEK: `openssl rand -base64 32`
2. Store as `CREDENTIAL_KEK_PREVIOUS = <current>` and `CREDENTIAL_KEK = <new>`
3. Bump `CURRENT_KEY_VERSION` constant
4. Background job reads all `founder_payment_connections` where `key_version != CURRENT_KEY_VERSION`:
   - Decrypt with PREVIOUS
   - Re-encrypt with CURRENT
   - Update row with new ciphertext + `key_version`
5. Once job completes, remove `CREDENTIAL_KEK_PREVIOUS`

---

## Trial Mechanics — Implementation Details

### Current code gaps (from drift audit)

| File | Issue | Fix |
|---|---|---|
| `src/lib/services/billing.service.ts:39-48` | `createCheckoutSession` doesn't pass `trial_period_days` | Add `subscription_data: { trial_period_days: 3 }` |
| `src/lib/services/billing.service.ts:89-127` | `handleSubscriptionCreated` grants plan credits immediately | Grant 10 trial credits only; plan credits on first `invoice.paid` with `billing_reason=subscription_create` AND `status==='active'` |

### Fixed implementation

```typescript
// billing.service.ts — createCheckoutSession
const session = await provider.createCheckout({
  companyId,
  email: user.email,
  country: detectedCountry,
  currency: detectedCurrency,
  planPriceId: PLAN_PRO_PRICE_ID,
  trialDays: 3,
  idempotencyKey: `baljia:${companyId}:checkout:${new Date().toISOString().slice(0, 13)}`,
  returnUrlSuccess: `${APP}/dashboard/${companyId}?trial=started&taskId=${optional}`,
  returnUrlCancel: `${APP}/dashboard/${companyId}`,
  metadata: { company_id: companyId, plan: 'pro' },
});

// Subscription created in 'trialing' state:
await db.update(subscriptions).set({
  status: 'trialing',
  billing_provider: selectProvider(detectedCountry),
  billing_provider_customer_id: session.customerId,
  billing_provider_subscription_id: session.subscriptionId,
  billing_country: detectedCountry,
  currency: detectedCurrency,
  trial_ends_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
}).where(eq(subscriptions.company_id, companyId));

await db.update(companies).set({
  billing_state: 'trial',
  execution_state: 'active',
}).where(eq(companies.id, companyId));

// Grant ONLY 10 trial credits (not plan credits)
await creditService.addCredit(companyId, 10, 'trial_grant', '3-day trial credits');
```

### Handler: subscription transitions from trialing → active

```typescript
// webhook handler — invoice.paid event
async function handleInvoicePaid(event: PaymentDomainEvent) {
  if (!event.companyId) return;

  // Only grant plan credits on the FIRST paid invoice (trial conversion)
  const isTrialConversion = event.raw.billing_reason === 'subscription_create';

  await db.transaction(async (tx) => {
    await tx.update(subscriptions).set({
      status: 'active',
      latest_provider_event_id: event.providerEventId,
    }).where(eq(subscriptions.company_id, event.companyId));

    await tx.update(companies).set({
      billing_state: 'active',
      execution_state: 'active',
    }).where(eq(companies.id, event.companyId));

    if (isTrialConversion) {
      // Plan credits (monthly grant on paid subscription)
      await creditService.addCredit(
        event.companyId,
        PLAN_PRO_MONTHLY_CREDITS,  // 50 or whatever pro tier gets
        'monthly_grant',
        'Pro plan activation',
        { tx },
      );
    }
  });
}
```

---

## Testing Strategy

### Sandbox environments per provider

| Provider | Sandbox URL | Test cards | Dev key prefix |
|---|---|---|---|
| Dodo | `https://test.dodopayments.com` | Documented in Dodo docs | `test_*` |
| Razorpay | `https://api.razorpay.com` (toggled test mode) | `4111 1111 1111 1111`, UPI `success@razorpay` | `rzp_test_*` |
| Paddle | `https://sandbox-api.paddle.com` | Paddle test cards | `pdl_sdbx_*` |
| Stripe (legacy) | `https://api.stripe.com` (test mode) | `4242 4242 4242 4242` | `sk_test_*` |

### CI approach — mock provider (no real API calls)

```typescript
// tests/mocks/mock-payment-provider.ts
export class MockPaymentProvider implements PaymentProvider {
  provider = 'mock';
  // ... all methods return stubbed responses

  // Critical: supports time-travel for 3-day trial testing
  advanceClock(days: number) { /* move fake clock */ }
}

// In CI:
// process.env.PAYMENT_PROVIDER_MODE = 'mock' → use MockPaymentProvider for all flows
```

### E2E tests (Playwright)

```typescript
// tests/e2e/payment-trial-lifecycle.spec.ts
test('trial → day-3 charge → renewal', async ({ page }) => {
  // 1. Signup
  await signup(page, 'test@example.com');

  // 2. Click task → redirect to mock checkout
  await page.click('[data-testid="task-card-engineering"]');
  await expect(page).toHaveURL(/mock-checkout/);

  // 3. Complete checkout
  await mockProvider.completeCheckout({ success: true });
  await page.waitForURL(/dashboard.*trial=started/);

  // 4. Verify trial state
  expect(await getBillingState(companyId)).toBe('trial');
  expect(await getCreditBalance(companyId)).toBe(10);

  // 5. Simulate day-3 charge via mock time-travel
  await mockProvider.advanceClock(3);
  await mockProvider.triggerWebhook('invoice.paid', { billing_reason: 'subscription_create' });

  // 6. Verify active state + plan credits
  expect(await getBillingState(companyId)).toBe('active');
  expect(await getCreditBalance(companyId)).toBe(10 + PLAN_PRO_MONTHLY_CREDITS);
});
```

### Smoke test environment

- Sandbox keys in `.env.test.local`
- Production keys only in Render env (`sync:false`)
- `npm run test:smoke` runs against sandbox with real provider API calls (slow, 30+ seconds)
- `npm run test` runs with mock provider (fast, <5 seconds)

---

## Observability Spec

### Sentry tags (every billing call)

Required tags on all captures:
- `payment_provider`: `dodo` / `razorpay` / `paddle` / `stripe_legacy` / `mock`
- `billing_event`: `checkout.create` / `webhook.verify` / `webhook.process` / `subscription.activate` / `refund.issue` / etc.
- `company_id`: UUID string
- `billing_state`: `trial` / `active` / `past_due` / `cancelled` / `unpaid`

### Sentry breadcrumbs

Every payment-related action should drop a breadcrumb:

```typescript
Sentry.addBreadcrumb({
  category: 'payment',
  message: 'createCheckoutSession',
  data: { provider, companyId, country, trialDays },
  level: 'info',
});
```

### Metrics (Grafana or similar, reading from Neon)

- `trial_conversion_rate` = trials converted / trials started (30d)
- `payment_success_rate` = checkouts completed / checkouts created (per provider)
- `webhook_processing_latency_p95` (per provider)
- `chargeback_rate_30d` (per provider) — **alert threshold 0.3%**
- `dunning_recovery_rate` = past_due → active / past_due count
- `mrr_by_provider` (Dodo $ + Razorpay ₹ normalized to USD)

### Alerts (PagerDuty or email)

- `webhook.signature_invalid{provider}` > 0.1% rolling 1h → security alert
- `chargeback_rate_30d{provider=dodo}` > 0.3% → warning (Slack)
- `chargeback_rate_30d{provider=dodo}` > 0.5% → CRITICAL (on-call page)
- `invoice.payment_failed` spike (> 3× 7-day baseline) → investigate card-issuer block
- Reconciliation drift detected → daily Slack digest

---

## Reconciliation Service

File to create: `src/lib/services/reconciliation.service.ts`

**Runs nightly** via cron (`render.yaml` addition):

```yaml
- type: cron
  name: baljia-payment-reconciliation
  runtime: node
  region: oregon
  schedule: "0 2 * * *"   # 2am UTC daily
  startCommand: >
    curl -X POST "$NEXT_PUBLIC_APP_URL/api/cron/payment-reconciliation"
    -H "x-cron-secret: $CRON_SECRET"
```

### Logic

```typescript
export async function reconcilePayments() {
  const providers: PaymentProvider[] = [dodoProvider, razorpayProvider];

  for (const provider of providers) {
    const providerSubs = await provider.listActiveSubscriptions();  // pagination

    const baljiaSubs = await db.select().from(subscriptions)
      .where(and(
        eq(subscriptions.billing_provider, provider.provider),
        inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
      ));

    // Detect ghosts (active at provider, not in Baljia)
    const ghosts = providerSubs.filter(
      ps => !baljiaSubs.some(bs => bs.billing_provider_subscription_id === ps.id)
    );

    // Detect zombies (active in Baljia, not at provider)
    const zombies = baljiaSubs.filter(
      bs => !providerSubs.some(ps => ps.id === bs.billing_provider_subscription_id)
    );

    // Detect drift
    const drift = baljiaSubs
      .map(bs => {
        const ps = providerSubs.find(p => p.id === bs.billing_provider_subscription_id);
        return ps && bs.provider_status !== ps.status ? { bs, ps } : null;
      })
      .filter(Boolean);

    if (ghosts.length || zombies.length || drift.length) {
      Sentry.captureMessage('reconciliation_drift', {
        tags: { provider: provider.provider },
        extra: { ghosts: ghosts.length, zombies: zombies.length, drift: drift.length },
      });
      await slackAlert(provider.provider, { ghosts, zombies, drift });
    }
  }
}
```

---

## Code Drift Audit (must fix before v1 coding)

| File | Line | Issue | Fix |
|---|---|---|---|
| `src/lib/agents/tools/engineering.tools.ts` | 1369–1510 | 4 Stripe tools use Baljia's platform key (`stripe_create_product/price/payment_link/get_products`) — contradicts doc rule #2 | **Delete** these tools. Replace with `codegen_*` tools that write files to founder's GitHub repo using founder's credentials at runtime. |
| `src/lib/services/billing.service.ts` | 39-48 | `createCheckoutSession` doesn't pass `trial_period_days` | Add `subscription_data.trial_period_days: 3` to session create |
| `src/lib/services/billing.service.ts` | 89-127 | `handleSubscriptionCreated` grants plan credits immediately | Grant only trial credits here; plan credits via `invoice.paid` handler with `billing_reason=subscription_create` check |
| `src/app/api/cron/trial-expiry/route.ts` | 25 | Calls `expire_stale_trials()` PG function that doesn't exist | Write SQL function in migration OR replace with Drizzle query |
| `src/app/api/webhooks/stripe/route.ts` | 22-28 | Dedupe via `platform_events.payload->>'stripe_event_id'` LIKE — race, no unique index | Migrate to `webhook_events` table with unique constraint |
| `src/lib/credential-crypto.ts` | 64-68 | AES key derived from `AUTH_SECRET` — existential rotation hazard | Split `CREDENTIAL_KEK` as separate env var, add `key_version` column |
| `src/lib/services/billing.service.ts` | 16-18 | 4 tiers (`trial/starter/growth/scale`) in code, 1 tier ($49) in doc | Resolve decision #1; simplify PLAN_CONFIG if staying flat |
| `src/components/dashboard/PurchaseCreditsDialog.tsx` | 20-45 | Credit packs Stripe-only | Wire through `PaymentProvider` abstraction |
| `src/app/api/webhooks/stripe/route.ts` | 77-95 | Referral bonus logic baked into Stripe handler | Extract to `referral.service.ts`, invoke from Dodo + Razorpay webhooks too |
| `src/lib/db/schema.ts` | 278-292 | `subscriptions.stripe_customer_id`, `stripe_subscription_id` hardcoded | Polymorphic migration per above |
| `src/lib/db/schema.ts` | revenue_ledger, ad_spend_ledger | `stripe_charge_id` hardcoded | Rename to `provider_charge_id` + add `billing_provider` |
| `src/app/(public)/faq/page.tsx` | 36 | "platform errors auto-refunded" — contradicts CLAUDE.md | Resolve decision #4, update faq to match |

### ~21 additional files reference Stripe (text-level, audit needed)

- `router.service.ts`, `governance.service.ts`, `platform-ops.tool-handlers.ts`, `ceo.prompt.ts`, `platform-capabilities.ts`, `engineering.tools.ts`, `night-shift.service.ts`, `event.service.ts`, `roadmap.service.ts`, `test-ceo-full.ts`, `seed-db.ts`, `types/index.ts`, `agent-factory.ts`, `create-starter-tasks.ts`, + onboarding docs

**Audit action:** grep for `stripe` (case-insensitive) across `src/` and `docs/`, categorize each hit as (a) remove, (b) swap for PaymentProvider, (c) leave as legacy comment, (d) keep for Stripe Connect path (post v1.1).

---

## CLAUDE.md Update List

Changes required in `CLAUDE.md` (project root) BEFORE code generation starts:

| Line ref | Current | Update to |
|---|---|---|
| Line 84 | `Payments \| Stripe` | `Payments (Global) \| Dodo Payments (MoR) \| ...` + row `Payments (India) \| Razorpay \| ...` |
| Line 189 | `Ad Spend \| ... \| Founder (daily Stripe charges)` | Resolve per decision #2 |
| Line 384 | `billing.service.ts: Stripe integration` | `billing.service.ts: PaymentProvider abstraction (Dodo + Razorpay)` |
| Line 453 | Phantom mounts include `stripe` | Remove or keep as `stripe_legacy` only |
| Line 467 | "Trial credit budget is ambiguous" | Resolve per decision #3 |

---

## v1 Blockers (before any Flow 1 / Flow 2 code is written)

1. Delete Stripe runtime tools from engineering agent
2. Create `webhook_events` table
3. Schema migration: polymorphic `billing_provider` columns on subscriptions + ledgers
4. Create `founder_payment_connections` table
5. Split `AUTH_SECRET` from `CREDENTIAL_KEK` + add `key_version`
6. Define `PaymentProvider` TypeScript interface
7. Write missing `expire_stale_trials()` function
8. Resolve 12 open strategic questions (see [baljiapayment.md](./baljiapayment.md))
9. Update CLAUDE.md per list above

Only after these 9 items are done → begin implementing DodoProvider + RazorpayProvider.

---

*See also:*
- *[baljiapayment.md](./baljiapayment.md) — decisions and why*
- *[payment-operations-runbook.md](./payment-operations-runbook.md) — ops + incident response*
- *[payment-compliance-india.md](./payment-compliance-india.md) — tax + regulatory*
