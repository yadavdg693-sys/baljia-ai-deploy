# Skill: Stripe payments for founder apps

**READ THIS BEFORE adding any payment, subscription, checkout, pricing, or webhook flow.**

Founder engineering apps run on Render. Use the simplest payment path that satisfies the task; do not build a full billing system unless the founder explicitly asked for it.

## Pick the right pattern

| Pattern | Use when | Effort |
|---|---|---|
| Stripe Payment Link | Fixed product or service, fastest way to accept payment | Low |
| Stripe Checkout Session | Dynamic price, custom success flow, or in-app purchase button | Medium |
| Stripe Subscriptions API | SaaS billing with plans, trials, upgrades, and webhooks | Higher |

Default to Payment Links for first-version founder apps.

## Platform tools first

Use these tools before adding Stripe SDK code:

- `stripe_create_product`
- `stripe_create_price`
- `stripe_create_payment_link`
- `stripe_get_products`

Typical flow:

```text
stripe_create_product -> stripe_create_price -> stripe_create_payment_link
```

Then place the returned URL in the founder app as a normal checkout link.

## Direct Stripe SDK on Render

Use the official Stripe Node SDK only when the app needs dynamic Checkout Sessions or webhooks.

```js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post('/checkout', async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.APP_URL}/success`,
    cancel_url: `${process.env.APP_URL}/`,
  });

  res.redirect(303, session.url);
});
```

Render env vars normally needed:

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID` or product/price IDs returned by tools
- `APP_URL`
- `STRIPE_WEBHOOK_SECRET` when using webhooks

## Webhook handling on Express

Use raw body only for the webhook route:

```js
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(
    req.body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  res.json({ received: true });
});
```

Do not run `express.json()` before the Stripe webhook route.

## Verification

A payment task is done when:

1. Checkout URL or button exists in the deployed app.
2. The route redirects to Stripe or the Payment Link opens.
3. Success/cancel routes exist if using Checkout Sessions.
4. Webhook route verifies signatures if webhooks are in scope.
5. The task report names any env vars that still need live production values.
