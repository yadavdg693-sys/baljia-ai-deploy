# Payment Operations Runbook

**Audience:** On-call engineer, operations, support
**Companion to:** [baljiapayment.md](./baljiapayment.md) (decisions)
**Scope:** Incident response, chargebacks, provider freezes, reconciliation, dunning, refunds

---

## Trial Conversion Outcomes Matrix

### Day 3 (end of 3-day free trial) outcome tree

| Provider event | Internal status | `billing_state` | `execution_state` | User-facing action |
|---|---|---|---|---|
| `invoice.paid` + `billing_reason=subscription_create` | `active` | `active` | `active` | Welcome email + grant plan credits |
| `invoice.payment_failed` first attempt | `past_due` | `past_due` | `active` (grace) | Email: "Card declined, retrying in 3 days" |
| `invoice.payment_failed` final attempt (provider dunning exhausted) | `unpaid` | `unpaid` | `suspended` | Email: "Payment failed, update card to resume" |
| `customer.subscription.deleted` (customer cancelled during trial) | `cancelled` | `cancelled` | `suspended` | Email: "Trial cancelled" |
| `charge.dispute.created` (chargeback filed) | `active` (unchanged) + `dispute_open` flag | `active` | `active` | Internal alert only → **Anti-Chargeback response SLA** |

### Dunning schedule (Baljia-enforced regardless of provider default)

```
Day 3    → provider attempts charge (driven by trial_period_days)
Day 4    → if failed, provider retry #1
Day 7    → if failed, provider retry #2
Day 8    → Baljia email: "We couldn't bill you. Update payment method."
Day 11   → Baljia email #2 with provider's card-update link
Day 15   → billing_state='cancelled', execution_state='suspended',
           subscription cancelled at provider, founder app suspended
Day 30   → founder data soft-delete initiated unless resubscribed
```

### Trial start invariants

- `subscriptions.status` NEVER advances `trialing → active` except via provider webhook
- Credit grant on activation is idempotent (check `latest_provider_event_id` before grant)
- Card expiry during trial → provider emits `customer.source.expiring` → proactive email to founder with update link
- Customer removes card mid-trial → `payment_method.detached` → mark trial "at risk"

---

## Anti-Chargeback Playbook

**Why this runbook matters:** Dodo's 0.5% monthly chargeback rate = account termination trigger. At $49 SKU with 200 signups = ONE chargeback kills Baljia. If 1-in-50 trial users disputes the day-3 charge, Dodo terminates Baljia in the first 1,000 signups.

### Prevention (in-app UX)

1. **Pre-charge email on Day 2 of trial**
   - Subject: "Your Baljia trial ends tomorrow"
   - Body: "You'll be charged $49 on <date>. Cancel anytime before then: <one-click link>"
   - Sent from verified domain via Postmark
   - Template ID: `trial-ending-reminder`

2. **In-app banner throughout trial**
   - "Your trial ends in X days — [Cancel trial]" (prominent, top of dashboard)
   - Banner persists until charge or cancel

3. **Charge descriptor** on customer's bank statement
   - "BALJIA AI $49 sub" — NOT "DODO PAYMENTS" alone
   - Descriptor configured per provider:
     - Dodo: set at product creation (`statement_descriptor`)
     - Razorpay: set at plan creation (`notes`)

4. **Clear cancellation UX**
   - One-click cancel button in dashboard (NOT hidden in settings)
   - No dark patterns (no "are you sure → here's a discount → are you REALLY sure")
   - Dark patterns DRIVE disputes, don't prevent churn

5. **Day 0 confirmation email** (at trial signup)
   - Subject: "Your Baljia trial has started"
   - Body: "Charge on <date>. Cancel anytime: <link>. Here's what you have access to..."

6. **Customer receipt branding**
   - From founder's Stripe-hosted page: "Baljia (via Dodo)" + plain-English explanation
   - Support page macro: "What is this charge from Dodo/Razorpay?"

### Response (48-hour SLA when dispute arrives)

```
Hour 0-1   : Provider webhook `charge.dispute.created` fires
           → Sentry alert + entry in /admin/disputes
           → On-call engineer notified via Slack #payment-alerts

Hour 1-6   : Evidence auto-assembly triggered
           → Pull from platform_events + task_executions:
             • Signup IP + user-agent + email
             • Checkout session transcript
             • All tasks executed during trial (prove product was used)
             • Day-2 reminder email delivery proof (Postmark API)
             • Day-0 confirmation email delivery proof
             • ToS version acknowledged at signup

Hour 6-24  : Human review of evidence package
           → On-call engineer verifies completeness
           → Add written response: "Customer signed up on <date>, used product
             for X tasks, received confirmation + reminder emails, charge on day 3
             as disclosed at checkout."

Hour 24-48 : Submit evidence via provider API
           → Stripe: stripe.disputes.update(disputeId, { evidence })
           → Razorpay: dispute evidence endpoint
           → Dodo: submit via dashboard (API pending) or email

Hour 48+   : Wait for resolution
           → Follow-up webhooks: dispute.updated / dispute.resolved
           → Log outcome in dispute_history table
           → If lost: debrief — was this preventable? Update playbook.
```

### Fraud prevention at signup (reduces dispute rate)

| Control | Implementation |
|---|---|
| Email family dedup | Normalize Gmail dots + `+` aliases. Same person with 10 trial addresses = flagged |
| IP velocity cap | Max 3 trials per IP per 30 days |
| Card BIN block list | Table of BINs with prior chargebacks — auto-reject at checkout |
| Free-domain email check | mailinator, 10minutemail, tempr.email — require additional verification (phone OTP) |
| Device fingerprint | FingerprintJS or similar — catches "1 person, many browsers" (post-MVP) |
| Velocity rule | Same IP + rapid signup sequence → rate limit |

### Monitoring

- **Daily cron**: Calculate 30-day rolling chargeback rate per provider
- **Alerts**:
  - 0.2% warning → Slack channel
  - 0.3% warning-critical → Slack + email on-call
  - 0.5% EMERGENCY → page on-call + trigger [Provider Freeze Runbook](#provider-freeze-runbook)
- **Weekly**: Manual review of disputes — patterns emerging?

### Dispute outcome tracking

Create `dispute_history` table:

```sql
CREATE TABLE dispute_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  provider varchar(20) NOT NULL,
  provider_dispute_id varchar(255) NOT NULL,
  amount_cents integer NOT NULL,
  reason varchar(100),                    -- 'fraudulent', 'product_not_received', etc.
  status varchar(30) NOT NULL,            -- 'open', 'under_review', 'won', 'lost'
  evidence_submitted_at timestamptz,
  resolved_at timestamptz,
  outcome varchar(30),                    -- 'won', 'lost', 'refunded'
  notes text,
  created_at timestamptz DEFAULT now()
);
```

---

## Provider Freeze Runbook

**Scenario:** Dodo (or Paddle, Razorpay) freezes Baljia's account. Dodo Trustpilot pattern: 8+ reports of 120-day fund holds between Oct 2025 – Feb 2026.

### Detection signals

1. **Email from provider** to operations@baljia.ai (often first warning)
2. **Webhook `merchant.suspended`** (if provider sends it)
3. **Sentry alert**: `checkout.create` calls to provider return 4xx consistently
4. **Customer reports**: "My checkout is failing" emails pile up
5. **Dashboard** shows "Account under review" or similar

### Response (execute within 24 hours of detection)

```
Hour 0-2   : Acknowledge internally
           → Assign on-call point person
           → Create incident in /admin/incidents with severity=critical
           → Slack #founders-only channel: "Possible provider freeze; investigating"
           → Do NOT notify customers yet (avoid panic if it's a false alarm)

Hour 2-6   : Verify freeze
           → Attempt test charge via provider API — does it return error?
           → Check provider dashboard for status
           → Email provider support for confirmation
           → If confirmed: escalate

Hour 6-12  : Activate failover
           → Update PRIMARY_GLOBAL_PROVIDER env var from 'dodo' to 'paddle'
             (requires Paddle live-approved prerequisite)
           → Redeploy platform
           → Verify new signups route to Paddle
           → Existing subscriptions: stay on Dodo (their renewal dates unchanged)

Hour 12-24 : Customer communication
           → Email all active subscriptions: "We're migrating your payment method.
             Please re-enter card at <one-click link> within 7 days."
           → Social: brief, honest status update
           → FAQ page update: "We're experiencing payment issues with one provider
             and have activated our backup. Your access continues uninterrupted."

Day 2-7    : Re-authorization drive
           → Expected 50-70% re-auth rate (industry data)
           → 30-50% drop-off — acceptable loss to continue operating
           → Send reminder on day 3 and day 6

Day 2-120  : Funds recovery
           → Dispute Dodo fund hold via email + legal notice if needed
           → Typical release: 90-120 days from freeze
           → Track in incident report

Post-mortem : After stability restored
           → What triggered freeze? (Chargeback spike? AUP complaint? Volume anomaly?)
           → Update Anti-Chargeback Playbook based on learnings
           → Update fraud prevention controls
           → Update product to prevent recurrence
```

### Migration-readiness prereqs (must be in place BEFORE freeze happens)

- [ ] Paddle live-approved (not just sandbox) — enables instant failover
- [ ] All customer card-on-file metadata stored in Baljia's `subscriptions` table (not just provider)
- [ ] Re-auth email template pre-written in Postmark (`emergency-payment-migration`)
- [ ] `PaymentProvider` abstraction makes provider switch a config change, not a code rewrite
- [ ] On-call rotation established (who answers the Slack alert at 2am?)
- [ ] Runbook tested via tabletop exercise quarterly

### Expected financial impact

| Metric | Without prereqs | With prereqs |
|---|---|---|
| Revenue disruption | Multi-week outage | 24-hour disruption |
| Re-auth rate | 20-40% (panicked customers churn) | 50-70% (smooth migration) |
| Fund recovery | Uncertain; may require legal | 90-120 days typical |
| Brand damage | High | Low (handled professionally) |

---

## Refund Handling

### Per-scenario policy (published at baljia.ai/refund-policy)

| Scenario | Policy | Mechanism | SLA |
|---|---|---|---|
| Trial → forgot to cancel → charged on day 3 | Full refund within 7 days of first charge, no questions asked | Provider API refund | Respond within 24h |
| Task failed due to platform error (attributable to Baljia infra) | Automatic credit refund | Credit ledger only — no payment refund | Automatic on failure classification |
| Task failed due to ambiguous request | Credit consumed; founder can re-brief for same credit | Manual review | Case-by-case |
| Customer wants to cancel subscription | Cancel anytime, access until period end, no proration refund | Provider-native cancel | Immediate |
| Customer wants full refund mid-period (beyond 7 days) | Case-by-case, default NO | Manual API refund if approved | Respond within 48h |
| Annual plan cancel request | Prorated refund for unused months, minus 15% handling | Manual API refund | Respond within 48h |

### Refund workflow

```
Customer emails support → assigned to /admin/refunds queue
      ↓
On-call reviews against policy table
      ↓
If approved:
  → Provider.refund(chargeId, amountCents, idempotencyKey)
  → Entry in refund_history table
  → Customer notified via email
      ↓
If denied:
  → Explanation to customer citing policy
  → If customer still unhappy → escalate to founder
```

### Refund database schema

Create `refund_history` table:

```sql
CREATE TABLE refund_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  provider varchar(20) NOT NULL,
  provider_charge_id varchar(255) NOT NULL,
  provider_refund_id varchar(255),
  amount_cents integer NOT NULL,
  reason varchar(100),                    -- 'trial_forgot', 'platform_error', 'annual_cancel'
  requested_by uuid REFERENCES users(id), -- support agent or automated
  approved_by uuid REFERENCES users(id),
  status varchar(30) DEFAULT 'pending',   -- 'pending', 'processed', 'denied'
  notes text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);
```

---

## Reconciliation (nightly job)

**Purpose:** Detect drift between Baljia's internal subscription state and provider state. Catch missing webhooks, provider-side changes we didn't observe, cancelled subscriptions that didn't emit events.

### Implementation

File: `src/lib/services/reconciliation.service.ts` (to be built)
Cron: Daily at 2am UTC via `render.yaml`

### Checks per provider (simplified: Dodo primary + legacy Stripe + Paddle if activated)

```typescript
async function reconcile(provider: PaymentProvider) {
  // In simplified architecture: iterate over [dodoProvider, stripeLegacyProvider]
  // Add paddleProvider to the array only if Paddle fallback is active
  const providerSubs = await provider.listActiveSubscriptions();

  const baljiaSubs = await db.select().from(subscriptions)
    .where(and(
      eq(subscriptions.billing_provider, provider.provider),
      inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
    ));

  // Ghost: active at provider, not in Baljia (missing webhook)
  const ghosts = providerSubs.filter(ps =>
    !baljiaSubs.some(bs => bs.billing_provider_subscription_id === ps.id)
  );

  // Zombie: active in Baljia, not at provider (stale data)
  const zombies = baljiaSubs.filter(bs =>
    !providerSubs.some(ps => ps.id === bs.billing_provider_subscription_id)
  );

  // Drift: status mismatch
  const drift = baljiaSubs.map(bs => {
    const ps = providerSubs.find(p => p.id === bs.billing_provider_subscription_id);
    return ps && bs.provider_status !== ps.status ? { bs, ps } : null;
  }).filter(Boolean);

  if (ghosts.length || zombies.length || drift.length) {
    await sentryAlert('reconciliation_drift', { provider, counts: {ghosts, zombies, drift} });
    await slackDigest(provider, { ghosts, zombies, drift });
  }
}
```

### Response to drift

- **Ghost** → likely missed webhook. Fetch details from provider, insert into Baljia.
- **Zombie** → subscription was deleted at provider. Cancel in Baljia.
- **Drift** → status mismatch. Fetch full subscription from provider, update Baljia.
- Log all auto-remediation in `reconciliation_audit` table.

---

## Fraud / Abuse Signals

### At signup (entry gate)

- Email dedup: normalize before storing (`john.doe@gmail.com` = `johndoe@gmail.com` = `john.doe+baljia@gmail.com`)
- IP rate limit: max 3 trial signups per IP per 30 days
- Sanctions check: email + IP country against OFAC/EU/UN lists (rely on provider MoR screening + basic list check)
- CAPTCHA on signup (hCaptcha or similar)

### At checkout

- Card BIN country vs IP country mismatch → flag for review (not block)
- BIN against block list (populated from prior chargebacks)
- Device fingerprint entropy too low → block (bot traffic)

### Post-signup (ongoing)

- Unusual task-creation velocity → rate limit
- Rapid cancellation + re-signup with same card → flag
- Multiple Baljia companies under one Stripe/Razorpay customer ID → review for trial abuse

### Block list database

Create `card_bin_blocklist` table:

```sql
CREATE TABLE card_bin_blocklist (
  bin varchar(8) PRIMARY KEY,
  reason varchar(100) NOT NULL,
  chargeback_count integer DEFAULT 1,
  added_at timestamptz DEFAULT now(),
  added_by uuid REFERENCES users(id)
);
```

Auto-populated from chargebacks + manual additions.

---

## Data Retention

| Data type | Retention | Rationale |
|---|---|---|
| Transaction records | 7 years | Indian GST Act requirement |
| Webhook payloads | 3 years | Dispute evidence window + audit trail |
| Founder's encrypted credentials (after cancel) | Revoke immediately, purge ciphertext within 48h | DPDP Act right-to-erasure |
| Subscription state | 7 years (soft-delete after cancel; cryptographic erasure after 7y) | Indian tax + audit |
| Chargeback / dispute evidence | 5 years | Card network rules require retention |
| Customer support logs | 3 years | Consumer Protection Act |
| PII in `users` / `companies` | Until DPDP delete request, then 30-day grace + purge | DPDP Section 8(7) |
| Sentry / observability logs | 90 days | Operational |

### Deletion workflow (DPDP right-to-erasure)

```
User/founder emails delete request to privacy@baljia.ai
      ↓
Verify identity via email token
      ↓
Within 30 days (DPDP) OR 30 days (GDPR):
  → Revoke all founder_payment_connections at provider
  → Purge encrypted credentials (overwrite with random bytes + drop row)
  → Soft-delete user/company records (retention metadata only)
  → Hard-delete PII fields
  → Audit log entry
  → Confirmation email to requester
```

---

## On-Call Responsibilities

### Alert response SLA

| Alert severity | Response time | Action |
|---|---|---|
| CRITICAL (chargeback rate ≥0.5%, provider freeze, security incident) | 15 minutes | Page on-call; escalate if needed |
| HIGH (chargeback 0.3-0.5%, webhook sig failures >0.1%, reconciliation drift) | 1 hour | Slack alert; investigate |
| WARNING (chargeback 0.2-0.3%, invoice failure spike) | 4 hours | Monitor; investigate during business hours |
| INFO (reconciliation drift resolved, dunning recovery) | Next business day | Log; review trends |

### On-call rotation (staffing)

- **Pre-revenue / solo founder:** you ARE on-call 24/7 (acknowledge reality)
- **Post-first-hire:** rotation weekly
- **At scale:** dedicated payment ops person ($100K+ MRR trigger)

### Incident postmortem template

For every CRITICAL or HIGH incident, write up within 7 days:

1. **Summary**: what happened in 2 sentences
2. **Timeline**: timestamped events from detection to resolution
3. **Impact**: revenue, customers, hours of disruption
4. **Root cause**: 5-whys analysis
5. **What went well**: detection speed, response, communication
6. **What went wrong**: delays, gaps, confusion
7. **Action items**: specific changes to prevent recurrence, with owners + dates
8. **Lessons learned**: general principles

Store in `docs/incidents/YYYY-MM-DD-short-description.md`.

---

## Support Macros (pre-written responses)

### "What is this charge on my statement?"

> Hi [Name], thanks for reaching out! The charge you're seeing is for your Baljia AI subscription ($49/month), processed through our payment partner [Dodo / Razorpay]. If you'd like to view or manage your subscription, you can access your billing portal here: [link]. Let me know if you have any other questions!

### "I want a refund"

> Hi [Name], I'm sorry to hear you're not satisfied with Baljia. Let me understand the situation — [ask clarifying question based on policy table]. Based on our [Refund Policy](https://baljia.ai/refund-policy), [explain applicable policy]. [Process refund OR explain why not eligible].

### "My payment failed"

> Hi [Name], I see your most recent charge didn't go through. This usually happens when your card has expired, reached its limit, or the bank blocked the transaction. You can update your payment method here: [billing portal link]. Once updated, we'll retry the charge within 24 hours. Your access is paused until payment is successful — please reach out if you need help!

### "I didn't sign up for this / chargeback dispute"

> Hi [Name], I want to make sure we resolve this quickly. I can see your account was created on [date] using the email [masked]. You used [X tasks] during the trial period before the $49 charge on [date]. If this wasn't you, please reply with any details (IP, device) and we'll investigate fraud. If you'd like to cancel and request a refund, I can help with that now — just confirm.

---

## Playbook Owner and Review

- **Owner:** CTO / founding engineer
- **Review cadence:** Monthly (or after any CRITICAL incident)
- **Tabletop exercise:** Quarterly — simulate provider freeze, chargeback spike, security incident

*See also:*
- *[baljiapayment.md](./baljiapayment.md) — architecture decisions*
- *[payment-implementation-spec.md](./payment-implementation-spec.md) — engineering contracts*
- *[founder-aup.md](./founder-aup.md) — founder product policy*
