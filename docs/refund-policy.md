# Refund Policy (Draft)

**Publication target:** `baljia.ai/refund-policy` (customer-facing)
**Referenced from:** Terms of Service, checkout page, support macros
**Companion to:** [baljiapayment.md](./baljiapayment.md), [payment-operations-runbook.md](./payment-operations-runbook.md)
**Status:** Draft — needs final lawyer review + user decision on platform-error refund auto-policy (decision #4 in baljiapayment.md)

---

## Purpose

This document resolves the contradiction between:
- **`CLAUDE.md` line 194:** "Failed tasks consume credit (no auto-refund)"
- **`src/app/(public)/faq/page.tsx` line 36:** "platform errors are auto-refunded; ambiguous requests are reviewed manually"

**Decision needed:** Which policy is Baljia's truth? This draft proposes a reconciled policy that honors both intents.

---

## Customer-Facing Refund Policy (publishable version)

### TL;DR

| Situation | Refund? |
|---|---|
| Trial → forgot to cancel → charged | ✅ Full refund within 7 days |
| Task failed due to our infrastructure error | ✅ Credit automatically refunded |
| Task failed because of ambiguous request | ❌ Credit used; you can re-brief at no extra cost |
| Subscription cancellation | ❌ No prorated refund; access until period end |
| Annual plan cancellation | ⚠️ Prorated refund for unused months, minus 15% handling |
| Credit pack purchase | ❌ Non-refundable once credits consumed |
| Disputed unauthorized charge | ✅ Refund + investigation |

Full policy below.

---

## Full Policy Text

### 1. Trial Period (3-Day Free Trial)

Baljia offers a 3-day free trial for new customers. A valid payment method is required at signup to activate the trial.

**Day 1-3 (trial period):**
- No charge
- Full product access
- Cancel anytime — no charge ever

**Day 3 (end of trial):**
- Your payment method is charged for the first month's subscription ($49)
- You'll receive a confirmation email

**After first charge — 7-day satisfaction guarantee:**
- If you're not satisfied, email `support@baljia.ai` within 7 days of the first charge
- Full refund, no questions asked
- Your account will be cancelled and access removed

**After 7 days:**
- Standard subscription refund policy applies (see Section 4)

### 2. Task Credit Refunds

Baljia charges 1 credit per task execution. Credits are allocated as part of your subscription (monthly grant) or via credit pack purchases.

**Platform error refunds (automatic):**

If a task fails due to an error attributable to Baljia's infrastructure, we automatically refund the credit to your account balance within 24 hours. Platform errors include:

- Agent execution timeout due to our infrastructure issues
- Connector failure (our third-party integration failed)
- Verification system error on our side
- LLM provider outage we relied on
- Deployment failure (our hosting provider issue)

You'll see a note in the task history: "Credit refunded due to platform error."

**Manual review cases (no auto-refund):**

If a task fails because the request was ambiguous, incomplete, or outside the agent's stated capabilities, the credit is consumed but you can:

- Re-brief the task with more detail (at no extra credit cost within 7 days)
- Contact support to request review if you believe the agent misunderstood

**Note:** Credits are tracked per-subscription period. Unused monthly credits do not roll over to the next billing cycle.

### 3. Credit Pack Purchases

Credit packs are one-time purchases sold at $49 (30 credits), $99 (100 credits), and $249 (300 credits).

- **Unused credit packs** (no credits consumed): full refund within 7 days of purchase
- **Partially used credit packs**: pro-rated refund at list price based on unused credits, within 30 days of purchase
- **Fully consumed credit packs**: non-refundable

### 4. Subscription Cancellation

You can cancel your Baljia subscription at any time through:
- Your dashboard → Settings → Billing → Cancel Subscription
- Your payment provider's customer portal (linked from your account)
- Email to `support@baljia.ai`

**Effect of cancellation:**
- You retain access until the end of your current billing period
- No pro-rated refund for the remainder of the current month
- You can resubscribe anytime to restore access

### 5. Annual Plan Cancellation

If annual billing is enabled for your account (future feature):

- **Within 30 days of purchase:** full refund (minus prorated value of usage to date)
- **After 30 days:** prorated refund for remaining full months, minus 15% handling fee
- **Example:** 4 months into a $490/yr annual plan, 8 months remaining → refund = ($490 × 8/12) × 85% = ~$278

### 6. Disputed Charges / Unauthorized Payments

If you believe a charge on your account was unauthorized:

1. **Contact us first** at `support@baljia.ai` — we'll resolve quickly (usually same business day)
2. If unresolved within 48 hours, you may file a chargeback with your bank
3. Unauthorized charges will be refunded in full after investigation

**Please contact us before filing a chargeback** — direct contact is faster, and chargebacks take 30-90 days to process through the card network while also harming our ability to serve other customers.

### 7. Refund Method and Timing

- Refunds are processed back to the original payment method
- Processing time varies by payment provider:
  - **Stripe / Dodo / Paddle:** 5-10 business days to appear on statement
  - **Razorpay (Indian customers):** 5-7 business days to bank / card / UPI
- We'll send a confirmation email when the refund is initiated
- International currency conversion may result in slight amount variation (outside our control)

### 8. How to Request a Refund

Email `support@baljia.ai` with:

- Your account email
- Company name (if applicable)
- Reason for refund request
- Date of charge and amount

We respond within 24 hours during business days (IST).

### 9. Edge Cases

**Customer moves countries mid-subscription:**
- Current billing cycle stays on existing payment provider
- Next renewal uses new-country payment provider (you may need to update payment method)
- No action required on your part unless payment fails

**Multiple chargebacks on one account:**
- More than 2 chargebacks in 12 months → account review
- Fraud indicators → account suspended pending investigation

**Refund during dispute:**
- If you initiate a chargeback after we've already refunded, the chargeback is automatically withdrawn (we mark as duplicate dispute)
- Please don't file a chargeback if we've already refunded — it complicates resolution

---

## Policy Enforcement / Internal Mechanics

### Platform error classification (internal)

A task failure qualifies as "platform error" (auto-refund) if the failure class is one of:

| Failure class | Auto-refund? |
|---|---|
| `infra_error` (our infrastructure failed) | ✅ Yes |
| `capability_miss` (agent didn't have the tool to do it) | ✅ Yes |
| `external_block` (third-party API was down) | ✅ Yes — if their downtime, not user's wrong config |
| `verification_reject` (our verifier rejected agent output) | ✅ Yes — agent did work, our check failed |
| `timeout` (agent ran out of turns / watchdog killed) | ✅ Yes — if tool-loop issue; ❌ if user gave impossible task |
| `scope_overflow` (task was bigger than scoped) | ❌ No — agent correctly identified scope issue |
| `policy_violation` (user tried prohibited action) | ❌ No |
| `connector_failure` (third-party credential invalid) | ❌ No — user's own creds issue |

Classification happens in `failure.service.ts` via 8-class taxonomy (CLAUDE.md). `platform_error` = classes 1-5; `user_error` = classes 6-8.

### Refund workflow (internal)

```
Customer requests refund → /admin/refunds ticket
      ↓
On-call reviews against policy table
      ↓
If eligible:
  → Provider.refund(chargeId, amountCents, idempotencyKey)
  → Entry in refund_history table
  → Email customer confirmation
  → Update credit balance if applicable (credit refund)

If not eligible:
  → Explanation to customer citing specific policy section
  → Offer alternative (re-brief task, extended trial, etc.)
  → If customer escalates → founder makes judgment call
```

### Refund database record

Every refund logged to `refund_history` table with:
- Customer details, amount, reason, approved_by, status, timestamps
- Used for audit, tax reporting, chargeback defense evidence

### Platform error refund automation

```typescript
// src/lib/services/failure.service.ts — hookup
export async function onTaskFailure(task: Task, failureClass: FailureClass) {
  const isPlatformError = PLATFORM_ERROR_CLASSES.includes(failureClass);

  if (isPlatformError) {
    await creditService.refundCredit(
      task.company_id,
      1,  // always 1 credit per task
      'platform_error_refund',
      `Auto-refund: ${task.id} failed with ${failureClass}`,
    );
    await notificationService.send(task.company_id, 'credit_refunded', {
      taskId: task.id,
      reason: failureClass,
    });
  }
}
```

---

## Language Compliance

### Consumer Protection Act 2019 (India)

Required disclosures on refund page:

- **Clear, plain English** — met by structure above
- **Refund timelines** specified per provider (Section 7)
- **How to request** (Section 8)
- **Grievance Officer contact** — added separately via grievance page

### Payment provider requirements

- **Paddle:** requires published refund policy; supports 14+ day refund windows
- **Dodo:** requires published refund policy; flag-for-review on chargeback ratio
- **Razorpay:** requires published refund policy per [Razorpay merchant requirements](https://razorpay.com/docs/)

### Stripe-compatible language

Uses Stripe's recommended pattern (Section 1 trial language is directly inspired by Stripe's card-required-trial conversion best practices).

---

## Checklist Before Publishing

- [ ] User decision on platform-error auto-refund (confirm Section 2 matches intent)
- [ ] Lawyer review (Indian fintech — Ikigai Law / TRA Law recommended)
- [ ] Cross-reference with ToS (Section X refund clause)
- [ ] Test flow: customer emails support → /admin/refunds → resolution within SLA
- [ ] Ensure `support@baljia.ai` is set up and monitored
- [ ] Publish at `baljia.ai/refund-policy`
- [ ] Link from:
  - Checkout page (every provider)
  - Terms of Service
  - FAQ page (reconcile with existing language)
  - Dashboard → Settings → Billing
  - Support email auto-reply footer

---

## Integration with Other Docs

| Doc | Reference from refund policy |
|---|---|
| [baljiapayment.md](./baljiapayment.md) | Open strategic question #4 (platform error refund policy) — resolve before publishing |
| [payment-operations-runbook.md](./payment-operations-runbook.md) | Refund workflow + support macros |
| [founder-aup.md](./founder-aup.md) | Refund-during-AUP-violation scenarios |

---

*Customer-facing URL: baljia.ai/refund-policy*
*Owner: Support / Ops*
*Review cadence: Annually, or when any payment provider policy changes*
*Last updated: April 2026*
