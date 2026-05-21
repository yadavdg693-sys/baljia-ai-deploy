# webhooks

Secure webhook handling for Stripe and GitHub. Read this skill BEFORE writing
any webhook endpoint. Agents that skip this produce insecure handlers that accept
forged events, double-process retries, and expose raw error stack traces.

---

## The Rule

**Every webhook endpoint MUST verify the signature before doing any work.**
Unverified webhooks are an open RCE/fraud vector.

---

## Stripe Webhooks

### 1. Install

```bash
pnpm add stripe
```

### 2. Raw body required

Next.js (App Router) — disable body parsing on the route:

```ts
// src/app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // Return 400 — Stripe will retry. Never expose the real error message.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Route by event type
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object as Stripe.CheckoutSession);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionCancelled(event.data.object as Stripe.Subscription);
      break;
    // Always have a default — Stripe sends many event types
    default:
      break;
  }

  // Always return 200 fast. Do heavy work async or in background.
  return NextResponse.json({ received: true });
}
```

### 3. Idempotency — never double-process

```ts
// In your db schema (Drizzle)
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),          // Stripe event.id
  type: text('type').notNull(),
  processedAt: timestamp('processed_at').defaultNow(),
});

// In your handler
async function handleCheckoutComplete(session: Stripe.CheckoutSession) {
  // Idempotency check
  const existing = await db.query.webhookEvents.findFirst({
    where: eq(webhookEvents.id, session.id),
  });
  if (existing) return; // Already processed — Stripe retried

  await db.transaction(async (tx) => {
    await tx.insert(webhookEvents).values({ id: session.id, type: 'checkout.session.completed' });
    // ... do the actual work
  });
}
```

### 4. Environment variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...   # Get from Stripe Dashboard > Webhooks
```

### 5. Test locally

```bash
# Install Stripe CLI
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
```

---

## GitHub Webhooks

```ts
// src/app/api/webhooks/github/route.ts
import { createHmac, timingSafeEqual } from 'crypto';

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get('x-hub-signature-256') ?? '';

  // Verify signature
  const expected = 'sha256=' + createHmac('sha256', GITHUB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);

  // timingSafeEqual prevents timing attacks
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = req.headers.get('x-github-event');
  const payload = JSON.parse(rawBody);

  switch (event) {
    case 'push':
      await handlePush(payload);
      break;
    case 'pull_request':
      await handlePR(payload);
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
```

---

## Anti-patterns (agent mistakes)

| ❌ Wrong | ✅ Right |
|---|---|
| `JSON.parse(await req.json())` | `await req.text()` then `JSON.parse` |
| Skip signature check | Always verify first |
| Return 500 on known bad events | Return 400 (Stripe retries on non-200) |
| Throw inside handler | Catch + log + return 200 |
| Expose `err.message` in response | Return generic `{ error: 'Invalid signature' }` |
| No idempotency | DB upsert keyed on `event.id` |
| Do heavy work synchronously | Return 200 fast, enqueue work |

---

## Verification Checklist

- [ ] `stripe.webhooks.constructEvent` called before ANY business logic
- [ ] `STRIPE_WEBHOOK_SECRET` set in Render env vars
- [ ] `webhookEvents` table exists and is checked before processing
- [ ] All handlers return 200 within 30 seconds (Stripe timeout)
- [ ] Local test: `stripe listen` + `stripe trigger` passes
- [ ] GitHub webhooks use `timingSafeEqual` not `===`
