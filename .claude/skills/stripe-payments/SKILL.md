# Skill: Stripe payments

**READ THIS BEFORE adding any payment, subscription, or pricing flow.**

## Two patterns — pick the right one

| Pattern | When | Effort |
|---|---|---|
| **Stripe Payment Links** | Founder needs to "sell something" — single product, fixed price, hosted checkout page | 5 min |
| **Stripe Checkout Sessions (in-app)** | Founder needs custom flow, dynamic pricing, or post-purchase actions in their app | 30 min |
| **Stripe Subscriptions API** | SaaS-style recurring billing | 1-2 hr (more if managing trials/upgrades) |

Default to Payment Links. Most v1 founder apps don't need anything else.

## Use the platform tools first — don't reinvent

You have these tools already wired:

- `stripe_create_product` — creates a product in Stripe
- `stripe_create_price` — attaches a price (one-time or recurring)
- `stripe_create_payment_link` — gives back a URL the founder can share
- `stripe_get_products` — list existing products

These hit Stripe via `STRIPE_SECRET_KEY` (set platform-side). The founder's app doesn't need to import Stripe SDK at all if you only need a Payment Link.

```
1. stripe_create_product({ name: 'Pro Plan' })           → product_id
2. stripe_create_price({ product_id, unit_amount: 4900, currency: 'usd', recurring: 'month' })
                                                          → price_id
3. stripe_create_payment_link({ price_id })              → url
4. Embed the URL in the founder's app: <a href="...">Subscribe</a>
```

## When the app needs Stripe SDK directly

If you need webhooks, dynamic checkout, or programmatic refunds, the Worker calls Stripe directly. Pass the secret key via `additional_secrets` on `cf_deploy_app`:

```
cf_deploy_app({
  slug: 'foundercorp',
  script_content: '...',
  additional_secrets: { STRIPE_KEY: 'sk_test_...' },
})
```

Then in the Worker:

```js
import Stripe from 'stripe';

export default {
  async fetch(request, env, ctx) {
    const stripe = new Stripe(env.STRIPE_KEY, {
      apiVersion: '2024-06-20',
      // CRITICAL on Workers: use fetch HTTP client, NOT the default Node http module
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      mode: 'subscription',
      success_url: `https://${env.COMPANY_SUBDOMAIN}.baljia.app/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${env.COMPANY_SUBDOMAIN}.baljia.app/`,
    });

    return Response.redirect(session.url, 303);
  },
};
```

**Critical:** `Stripe.createFetchHttpClient()` is required on Workers — without it, the Stripe SDK tries to use Node's `http` module which fails. This is the most common Stripe-on-Workers bug.

## Webhook handling

```js
const sig = request.headers.get('stripe-signature');
const body = await request.text(); // RAW body — don't parse as JSON yet
const event = await stripe.webhooks.constructEventAsync(
  body,
  sig,
  env.STRIPE_WEBHOOK_SECRET,
  undefined,
  Stripe.createSubtleCryptoProvider(),  // ← required on Workers
);

switch (event.type) {
  case 'checkout.session.completed': {
    const session = event.data.object;
    // Mark order paid, send confirmation email, etc.
    break;
  }
  case 'customer.subscription.deleted': { /* ... */ break; }
}
return new Response('ok', { status: 200 });
```

**Critical:** `Stripe.createSubtleCryptoProvider()` is required for `constructEventAsync` on Workers. Without it the signature verification throws.

## Test mode vs live mode

- Stripe keys starting with `sk_test_` → test mode. Charges aren't real.
- Stripe keys starting with `sk_live_` → real money.
- The platform's `STRIPE_SECRET_KEY` env var controls which mode `stripe_create_*` tools use.
- For founder apps, NEVER hardcode live keys in `script_content`. Always inject via `additional_secrets`.

## Test cards (test mode only)

| Number | What it does |
|---|---|
| `4242 4242 4242 4242` | Successful charge |
| `4000 0000 0000 9995` | Declined (insufficient funds) |
| `4000 0025 0000 3155` | Requires 3D Secure auth |

Any future expiry + any 3-digit CVC.

## Don't do these

- ❌ **Hardcoding `sk_live_...` in script_content.** Anything in script_content is exposed to anyone who can read CF's deployed Worker source. Use `additional_secrets`.
- ❌ **Skipping webhook signature verification.** Anyone can POST `{type: "checkout.session.completed"}` and trigger your "mark order paid" code. Always verify.
- ❌ **Trusting `success_url` to mean "payment succeeded."** Buyer can navigate there directly without paying. Always confirm via Stripe API or webhook.
- ❌ **Building a refund UI on day 1.** Refunds are 95% of "OMG someone got charged twice" emergencies. Use Stripe Dashboard for refunds until you have real volume.
- ❌ **Storing card numbers anywhere.** Stripe handles tokenization. If you ever see a 16-digit string in your DB, you're doing it wrong.

## Verification

After adding payments:

1. Test mode end-to-end: open the payment link → use `4242 4242 4242 4242` → verify in Stripe Dashboard that charge appears
2. If using webhooks: trigger a `checkout.session.completed` from Stripe CLI (`stripe trigger`) and confirm your handler ran (check logs / DB state)
3. If selling subscriptions: cancel + re-subscribe; ensure your DB state matches Stripe's state

A payments task is NOT done because "the page renders the Stripe button." It's done when a test charge actually completed end-to-end.
