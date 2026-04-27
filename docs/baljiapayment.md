# Baljia AI — Payment Architecture Decision Document

**Status:** Working decision log (April 2026) — to be updated as providers confirm or reject Baljia
**Context:** Baljia AI (Indian Pvt Ltd) is a SaaS platform that uses AI agents to build and operate companies for founders. Pre-revenue, launching in 1–2 months. Target customers: both global (US / EU / UK / CA / AU) and India.

---

## TL;DR — Final Decisions

### The three payment flows

| Flow | What | India path | Global path | Status |
|------|------|------------|-------------|--------|
| **1** | Founder pays Baljia subscription | **Dodo Payments** (MoR — one provider for all) | **Dodo Payments** (MoR — same) | Build in v1 |
| **2** | Founder's customer pays founder directly (founder keeps 100%, Baljia is just integrator) | **Dodo Payments** (founder's own Dodo account — Payment Link + webhook secret) | **Stripe** (founder's own Stripe account — Payment Link + webhook secret → Stripe Connect OAuth post-approval) | Build in v1 |
| **3** | Baljia takes a marketplace cut from founder's product revenue | Deferred | Deferred (Stripe Connect `application_fee_amount` if Stripe approves) | Deferred — revisit at 50+ founders |

**Paddle kept as Flow 1 warm fallback** — ready to activate if Dodo freezes Baljia or rejects AUP classification.

### Non-negotiable architectural rules

1. **Baljia never custodies funds** — money flows customer → payment provider → founder's bank. Never through Baljia's account. *User directive, explicit: "i dont want to take the all money in baljia."*
2. **Engineering agent writes code, Baljia infra does NOT initiate runtime payment API calls** on founder's stored credentials. Founder's deployed app makes all payment calls itself.
3. **Use Partner programs, not raw OAuth** where available. Razorpay Partners, Stripe Connect — these put regulatory responsibility on the licensed PA/PSP.
4. **Engineering agent is hardcoded to never emit secret keys to client-side code, never handle raw card data, always use tokenized/hosted flows, always verify webhook signatures, always use idempotency keys.**

---

## Open Strategic Questions (user decisions needed before coding starts)

These surfaced during 5 rounds of research + 2 gap-finding sweeps. Each one blocks a concrete implementation choice:

1. **Pricing model — 1 flat tier ($49/mo) or 3 tiers (Starter $49 / Growth $99 / Scale $299)?** Current code has 3 tiers + credit packs; doc and Polsia reference are $49 flat. Pick one. Affects provider capability requirements (metered billing, tier change flows).
2. **Ad-spend lane (4th lane per CLAUDE.md):** Baljia fronts daily Meta/Google ad charges via our provider, OR founder connects their own Meta/Google billing? 5.9% MoR fee on ad-spend pass-through is margin-negative.
3. **Trial credit count — 10 or 15 (5 base + 10 welcome)?** CLAUDE.md's `decide-later.md` flags ambiguity. Payment webhook grants credits on `subscription.active`, so this needs a number.
4. **Failed-task refund policy** — CLAUDE.md says "no auto-refund", `faq/page.tsx` says "platform errors auto-refunded". Resolve before first paying customer.
5. **Founder AUP categories** — explicit list of prohibited founder product types (gambling / adult / arms / crypto-exchange / pharma-without-license / political / weight-loss claims / scam adjacent). One bad founder triggers Baljia's MoR termination.
6. **Annual billing at launch — Y/N?** Industry standard 15-20% discount. Affects Flow 1 checkout UX.
7. **Grievance Officer — who?** Consumer Protection E-Commerce Rules 2020 requires named person with contact on site before launch. Default = solo founder's name.
8. **Stripe Atlas — start now in parallel, or wait for Stripe sales response?** Parallel = 4-6 week runway if Stripe rejects Baljia as Connect platform; waiting = saves $500 + transfer pricing overhead if approved.
9. **Flow 3 trigger metric** — "50+ founders" is mentioned; what's the revenue-cut %, and why that number?
10. **Indian B2B customer invoices** — issue GST-compliant invoices with Baljia's GSTIN for Indian business customers (requires Razorpay invoicing), or lose them to competitors who do?
11. **Multi-currency presentment** — single-USD / converted-at-spot / local-round-pricing (₹3,999 in India, €49 in EU)? Affects PPP arbitrage risk.
12. **Customer moves countries mid-subscription** — honor existing provider until renewal, or migrate? Subscription IDs don't port between providers.

**Default answers (if user doesn't specify):** 1-tier $49 / founder-connects-own-Meta-ads / 10 credits / platform errors auto-refund / strict Founder AUP / no annual at launch / solo-founder Grievance Officer / Stripe Atlas parallel / 50+ founders = 15% cut on Flow 3 / yes Razorpay GST invoices / single-USD presentment / current-provider-until-renewal.

---

## Context That Shapes Every Decision

### Baljia's constraints

- **Incorporated in India** as Private Limited Company (fixed for now)
- Pre-revenue, solo/small founding team
- Launching in 1–2 months
- Customer mix: expected 70% global / 30% India (not validated — will shift with GTM)
- Future ambition: marketplace where founders' products also accept payments

### The three flows defined

```
┌────────────────────────────────────────────────────────────────────┐
│ FLOW 1: Founder → Baljia (Baljia's own subscription revenue)       │
│   Founder pays Baljia $49/mo for using the platform.               │
│   Baljia is the merchant. Founder is the customer.                 │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ FLOW 2: Founder's customer → Founder (direct, Baljia doesn't touch)│
│   Founder's customer buys the product Baljia built for them.       │
│   Money goes straight to founder. Baljia integrates code only.     │
│   Founder is the merchant. Baljia is the integrator.               │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ FLOW 3: Baljia takes a platform cut from founder's product revenue │
│   Customer pays → split at payment time → founder gets net,        │
│   Baljia gets platform fee as line item.                           │
│   Both parties merchants; Baljia is platform. Shopify-style.       │
└────────────────────────────────────────────────────────────────────┘
```

The three flows are architecturally independent — different providers and different solutions per flow is normal and recommended.

---

## The True Pricing Surface (what payment infra must support)

Baljia's payment infrastructure must support **four distinct SKU types**, not one. This is where the earlier "$49/mo" shorthand over-simplified.

| SKU type | Pricing | Provider flow | CLAUDE.md lane |
|---|---|---|---|
| **A. Subscription tiers (recurring)** | Trial (free 3 days) / Paid $49/mo (or 3 tiers pending decision #1) | Flow 1 recurring | Subscription |
| **B. Credit packs (one-time)** | $49 (30 cr) / $99 (100 cr) / $249 (300 cr) | Flow 1 one-time checkout | Task Credits |
| **C. Ad-spend pass-through (variable, daily)** | Customer-defined daily budgets to Meta/Google; Baljia fronts or founder connects own billing (decision #2) | Flow 1.5 — high-frequency small charges OR external | Ad Spend |
| **D. Founder product payments (Flow 2)** | Founder-set pricing for their end-customers | Payment Links (v1) → Razorpay Partners / Stripe Connect (v1.1) | N/A — founder custody |

**Rationale:** provider selection, webhook handling, and ledger reconciliation must account for all four. 5.9% MoR fees on ad-spend pass-through would be margin-negative, so Lane C likely becomes "founder connects own Meta/Google billing" (cleaner architecture + zero Baljia payment fees on ad spend).

---

## Polsia UX Pattern (reference implementation for Flow 1 trial flow)

Based on frame-by-frame analysis of Polsia's dashboard → trial checkout flow (12.4-second screen recording). Our implementation matches these patterns because Polsia IS the product Baljia is modeled on, and their trial conversion UX is battle-tested.

### Observed flow sequence

```
t=0–4s   Dashboard at polsia.com/dashboard/{slug}
          Top: "Initializing session..." terminal strip
          Left column:
            - Mascot + research summary
            - "Hire Your AI Employee" card
            - [Start free trial] primary button
            - "$1.63/day · Works while you sleep"
            - "3-day trial · $49/mo"
          Middle column: Task list (4+ engineering tasks, top has "Tonight" badge)
          Right column: Twitter feed + Email inbox
          Cursor hovers task cards (entry-point education)

t=4s     User clicks top task ("CoAuthor Clone: Export to DOCX/PDF")
          → "Start free trial" card transitions to "Loading..." state
          → Browser navigates — NO intermediate modal, NO task detail panel

t=6s     checkout.stripe.com/c/pay/cs_live_… loads

t=7–11s  Stripe Checkout page (hosted, not embedded):
          LEFT panel (dark):
            Polsia mascot icon
            "Try Polsia"
            "3 days free"                          ← huge headline
            "Then ₹4,797.27 per month starting April 26, 2026"
            Currency toggle: [INR] [USD]
            "1 USD = 97.9039 INR (includes 4% conversion fee)"
            Line item: Polsia · 3 days free · ₹4,797.27/month after
          RIGHT panel (white):
            [Pay with Link] green top button       ← Stripe Link SSO
            "— OR —"
            Email prefilled: yadavgulab156@gmail.com
            Payment method: Card
              1234 1234 1234 1234 / MM-YY / CVC / name / country=India
            [Start trial] (bottom CTA)
```

### UX patterns Baljia must replicate

| Pattern | Why it matters |
|---|---|
| **Two CTA entry points:** explicit "Start free trial" card button + implicit task-click intercept | Redundant signals — user can choose proactive or reactive trial start |
| **Click task → immediate redirect** (no intermediate modal) | Reduces friction; click IS intent; Polsia-validated conversion pattern |
| **Loading state on CTA during Stripe session creation** | Server creates Checkout Session (200-500ms), button must not look frozen |
| **GeoIP currency presentment + manual toggle** | Indian user sees ₹4,797.27 by default, can flip to USD. Conversion fee disclosed transparently. |
| **"3 days free" headline, THEN "monthly starting X" subline** | Leads with benefit, not price — subscription conversion psychology |
| **Email prefilled from authenticated user** | Reduces form abandonment |
| **Success redirect carries `client_reference_id` + optional `taskId`** | Dashboard on return auto-opens the task user was trying to start; no lost context |
| **Charge descriptor clarity** | Customer receipt shows "Baljia via Dodo" or "Baljia via Razorpay" — prevents "what is this charge" disputes |

### Corresponding API / code requirements

- Checkout session creation endpoint accepts `returnTo` and optional `taskId`
- Success URL: `${APP_URL}/dashboard/{companyId}?trial=started&taskId={optional}`
- Cancel URL: `${APP_URL}/dashboard/{companyId}`
- Dashboard return handler reads `?trial=started`, shows confetti/welcome, auto-opens `taskId` if present
- `[Start free trial]` button component disables + shows spinner between click and `window.location = sessionUrl`

---

## What We Ruled Out and Why

### Stripe (direct) — ruled out for Flow 1 India and Indian-merchant use

Verified from Stripe's own support pages:
- **Stripe accounts are invite-only in India** since May 2024 ([Stripe Support — Stripe accounts are invite-only in India](https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india))
- Indian Stripe accounts have limited functionality and do NOT issue FIRA/eBRC (which Indian exporters legally need)
- Most Indian businesses don't pass the invitation criteria

**Verdict:** Cannot be Baljia's Flow 1 provider without restructuring entity.

### Lemon Squeezy — ruled out

- Stripe acquired Lemon Squeezy July 2024
- In active migration to "Stripe Managed Payments" per [LS 2026 update](https://www.lemonsqueezy.com/blog/2026-update)
- Indian merchants now forced to PayPal-only payouts with 13-day holds
- No FIRC, no 15CA-CB documentation
- Building on LS in April 2026 = building on a deprecating platform

**Verdict:** Skip. Would regret the migration in 12–18 months.

### Chargebee — ruled out at current stage

- Chargebee is a **billing orchestration layer**, NOT a payment gateway (confirmed in their own docs)
- Still requires a gateway underneath (Razorpay, Stripe, etc.)
- Free tier is $0 under $250K cumulative billing, then 0.75% overage or $599/mo Performance tier
- Not MoR — Baljia would still carry global tax burden

**Verdict:** Overkill for pre-revenue $49/mo SaaS. Revisit at $50K+ MRR.

### Paddle + Razorpay split — demoted from primary to fallback

Pass 2 (market validation) research found **zero named Indian SaaS success stories** with Paddle + Razorpay split stack. The modal Indian-global-SaaS pattern is Razorpay + Stripe (often via US LLC workaround), or single-provider Dodo.

Paddle risks:
- AUP prohibits "payment services, whether regulated or not (e.g., as a Payment Facilitator, Payment Services Provider, Money Transmitter, or Merchant of Record)" — Baljia's Flow 2 OAuth custody may trigger
- FTC $5M settlement June 2025 → Paddle risk team more aggressive 2025–2026
- Documented "3 months processing history" onboarding friction (inconsistently enforced)
- Multi-week verification deadlocks reported for Indian merchants

**Verdict:** Paddle is runner-up / fallback, not primary. Only go with Paddle if Dodo rejects or classifies Baljia as service-based.

### Other providers evaluated and rejected

Completeness record so future reviewers don't re-evaluate:

| Provider | Verdict |
|---|---|
| **Cashfree Payments** | **Kept as Razorpay backup** — India-licensed PA with 140-currency international capability; viable if Razorpay rejects/slow-rolls. Not primary because Razorpay has broader product surface and brand trust. |
| **Polar.sh** | Rejected — MoR for devs/SaaS but payout rails inherit Stripe Connect Express → same India-payout block as Atlas-free path |
| **FastSpring** | Rejected — US-merchant focused, Indian Pvt Ltd not cleanly supported |
| **Checkout.com / Adyen** | Rejected — enterprise-grade, minimum $1-5M ARR commitment |
| **Paytm / PayU** | Rejected — no advantage over Razorpay; same RBI posture |
| **Mollie** | Rejected — EU-focused, no India seller support |
| **Orb / Metronome / Lago** | Deferred to v1.2 — usage-based billing specialists; relevant only if we shift to metered credit model |
| **Kill Bill** | Rejected — self-hosted; revisit at $10M+ ARR sovereignty tipping point |
| **GoCardless** | Rejected — ACH covered by Dodo rails |
| **xPay Checkout (YC W24)** | Considered — newer India-alternative, less track record |

---

## Providers That Made the Cut

### Dodo Payments — Flow 1 primary (global)

**Why it wins for Baljia:**
- Indian-founded team (founder Rishabh — ex-Wise / Prodigy Finance, cross-border specialist)
- **Fastest onboarding**: verified in hours–days for most applicants (vs Paddle's 2–20 days)
- Full Merchant of Record in 150+ jurisdictions — handles GST, EU VAT, US sales tax, FIRC implicitly
- Native trial period support (`trial_period_days` 0–10000)
- Hosted checkout sessions (like Stripe Checkout)
- Complete webhook set: `subscription.active`, `subscription.renewed`, `subscription.cancelled`, etc.
- Maintained TypeScript SDK with Next.js/Express/Hono adapters
- 220+ country coverage
- Fees: ~5.9% effective on international subscriptions ($49/mo → ~$3.43 fee)

**Real risks (flag, don't ignore):**
- **Trustpilot 3.4–3.9** with 8+ credible reports of late-stage account closures and fund holds (Oct 2025 – Feb 2026)
- AUP excludes "Manual Digital Services... if the majority of the value sits in the human labour rather than digital systems"
- Baljia's "AI runs your company" pitch could be classified as service-based — requires written pre-approval from `compliance@dodopayments.com`
- 0.5% monthly chargeback rate = termination trigger (tight — see Anti-chargeback Playbook)
- $30 minimum chargeback fee
- No formal appeals process, no SLA on fund release documented

**Required before committing:** Email `compliance@dodopayments.com` with Baljia's product description and get written classification confirmation.

### Paddle — Flow 1 fallback (if Dodo rejects/classifies wrong)

**Why it's the runner-up:**
- Most mature MoR (10+ years, Canva/Sketch used it, post-FTC enhanced vetting means platform stability)
- Full MoR including EU VAT, US sales tax
- Native trial period support
- 5% + $0.50 flat fee (no geography surcharge in public pricing)
- Customer portal included

**Friction:**
- Approval-based, not self-serve
- Reports of "3 months processing history" requirement (inconsistently enforced; clean SaaS with public pricing/ToS typically passes)
- Timeline: 5–14 days to live approval for Indian Pvt Ltd (varies)
- INR is NOT a supported balance currency — Indian seller receives USD/EUR/GBP via SWIFT + $15 fee
- Web checkout is overlay (Paddle.js), not standalone hosted URL — small code adjustment
- No INR balance, no UPI AutoPay

**Sandbox is instant. Live mode requires approval.**

### Razorpay — DEMOTED from primary (April 2026 update)

**Status:** No longer part of v1. Kept as reference only in case of future architecture change.

**What changed:** User directive simplified Flow 1 to Dodo-only (one provider for all geographies). Flow 2 India also uses Dodo (founders connect their own Dodo account), not Razorpay Partners. This eliminates Razorpay from Baljia's v1 integration.

**Why Razorpay dropped out:**
- Dodo handles Indian customers natively (UPI, cards, netbanking via Dodo's Indian rails)
- Single-provider model = dramatic ops simplicity for a small team
- Baljia→Dodo is one export-of-services relationship (LUT, SOFTEX once per month) vs per-customer INR invoicing with Razorpay
- No Razorpay Partners application timeline gate (2-4 weeks approval)
- Fee difference (~₹2.2L/yr at 1,000 customers) outweighed by ops simplicity

**Still applicable if Razorpay re-enters the stack:**
- **Verified corrections from pass 1 research:** Non-INR subscription e-mandate is NOT broken — RBI mandate is for Indian cards only; international cards auto-renew fine.
- **Razorpay Route (for Flow 3):** India-only sub-merchants, confirmed by Route FAQs. Would only apply to Flow 3 India marketplace (v2+).
- **Razorpay Partners:** Real OAuth 2.0, Baljia would apply as "Technology Partner" if we later add raw-OAuth Flow 2 option.

**When to revisit Razorpay:**
- If Dodo UPI AutoPay support proves unreliable → may need Razorpay for Indian customer recurring
- If Flow 3 India marketplace opens and Route becomes needed
- If Dodo freezes Baljia and Paddle also rejects — Razorpay as tertiary fallback

**For v1: do not apply to Razorpay. Skip Razorpay Partners application. No Razorpay Flow 1 integration work.**

### Stripe Connect (for Flow 2 global, maybe Flow 3 global) — verified conditional path

**Verified from Stripe's own docs (April 2026):**

> *"Indian platforms can create Custom connected accounts for any country Stripe supports"* — for onboarding merchants in US, UK, EU, Canada, Australia, etc.
>
> *"Platform users in these countries [India, UAE, Thailand] can't self-serve Custom connected accounts. To begin onboarding for Custom connected accounts in these countries, contact us."*

**Translation:**
- ✅ Indian Pvt Ltd CAN become Stripe Connect platform for foreign merchants
- ❌ NOT self-serve — must apply via Stripe sales
- ⏳ Timeline unclear (historical India invite-approvals: 2–8 weeks)
- ✅ Once approved, can onboard US/UK/EU/CA/AU connected accounts
- ✅ Can take `application_fee_amount` — enables Flow 3 for foreign founders without Atlas

**Action required:** Send Stripe sales inquiry (see "Action Items" below).

### Stripe Atlas — optional, not urgent

- $500 one-time + $100/yr + ₹1-3L/yr transfer pricing CA fees ongoing
- Requires Indian LLP formation first → US C-Corp → optional Indian Pvt Ltd subsidiary
- Timeline: 4–6 weeks total
- **Only needed if** Stripe rejects Baljia as Connect platform AND we decide Flow 3 globally is required at launch

**Current recommendation:** Defer. Send Stripe sales inquiry first; decide based on response.

---

## The Payment Link Simplification (key insight for Flow 2)

For founder's product payments (Flow 2), we don't need OAuth or API keys for v1. Payment Links + webhook secret is enough for 70-80% of SaaS products.

### How it works (Sarah builds "Notely" — walkthrough)

```
Step 1: Sarah's setup (one-time, ~5 minutes)
  → Stripe dashboard → Create Payment Link for "$19/month Notely Pro"
    → Get URL: https://buy.stripe.com/abc123
  → Stripe dashboard → Webhooks → Add endpoint: https://notely.sarah.com/api/stripe-webhook
    → Get signing secret: whsec_xyz789
  → Paste BOTH into Baljia's Integrations panel

Step 2: Engineering agent generates Notely
  Agent writes the full SaaS including:
    - Signup/login, note editor, user subscription status flag
    - Subscribe button that redirects to Sarah's Payment Link
    - /api/stripe-webhook endpoint that verifies signature + activates user

Step 3: Customer "John" pays
  John signs up → User row: { id: 'user_42', subscription_active: false }
  John clicks "Subscribe $19/mo"
    → Redirects to https://buy.stripe.com/abc123?client_reference_id=user_42
    → Stripe handles card entry, creates subscription, charges John
    → Money → Sarah's Stripe → Sarah's bank (5-7 days)
  Stripe webhook → Notely's handler (auto-generated by Baljia):
    → Verifies signature using whsec_xyz789
    → Sets user_42.subscription_active = true
  John redirected back to notely.sarah.com → uses the app

Step 4: Recurring (forever)
  Month 2+: Stripe auto-charges $19 → webhook → user stays active
  Cancel: Stripe portal → webhook customer.subscription.deleted → access removed
```

**What the founder gives Baljia:**
- Payment Link URL (public, not secret)
- Webhook signing secret (limited power — only verifies webhooks, cannot charge cards)

**What the founder does NOT give Baljia:**
- Stripe Secret Key (avoided)
- Restricted Key (not needed)
- Full API access (not needed)

**Security/compliance benefit:** Baljia never has the ability to move the founder's money. Zero PA risk. Zero credential-breach blast radius beyond webhook verification. DPDP/GDPR exposure minimized.

### What Payment Links support (enough for 70-80% of Baljia products)

- Recurring subscriptions (monthly/annual)
- Free trials with card upfront
- Multiple tiers (one link per tier)
- Promo codes, tax, receipts
- Stripe Customer Portal (cancel, update card) — Stripe provides free

### What Payment Links don't support (deferred to v1.1 if needed)

- Per-seat dynamic pricing (e.g., "$5/user/month")
- Metered/usage-based billing
- In-app upgrade flow (redirect works but slight UX compromise)
- Fully branded checkout

**For the ~20-30% of founders who need complex billing, v1.1 adds manual Stripe Secret Key entry.**

---

## Compliance Positioning (India-specific)

### RBI Payment Aggregator (PA) classification question

**The risk:** If RBI classifies Baljia as a PA, Baljia needs ₹15 Cr minimum net worth, escrow accounts, PCI-DSS audit, 2-hour incident reporting. Existential for pre-revenue startup.

**RBI jurisdictional map:**

| Flow scenario | RBI jurisdiction strength |
|---|---|
| Foreign founder + foreign customers (Stripe US → foreign bank) | **Weak** — pure software export, Baljia is software vendor like Shopify/Vercel |
| Indian founder + foreign customers | **Medium** — founder's SOFTEX is founder's burden, Baljia still software |
| Indian founder + Indian customers (INR via Razorpay) | **Strong** — this is where PA matters |

**Mitigation for strong-jurisdiction scenario:** In simplified architecture, Indian founders connect their OWN Dodo account in Flow 2 (Payment Link URL + webhook secret). Baljia never holds Dodo API keys for the founder, never proxies payment calls — so Baljia is a software vendor, not aggregating. Dodo is the licensed entity (MoR) on every founder transaction.

### What keeps Baljia on the "software" side (not aggregation)

Verified via primary sources (RBI 2020 Guidelines, Para 3(ii)):
> *"Payment Aggregators... receive payments from customers, pool [them], and transfer them on to the merchants."*

**Baljia's Flow 2 is clearly software if:**
1. Baljia never receives customer payments
2. Baljia never pools funds
3. Baljia never transfers funds to merchants
4. Baljia never makes runtime payment API calls on stored credentials
5. Baljia's role ends at code generation + credential storage

**What nudges toward PA exposure (avoid):**
- Holding a merchant sub-account under Baljia's name → definitely PA
- Receiving customer payments and forwarding → definitely PA
- Proxying payment API calls at runtime through Baljia servers → high risk
- Agent autonomously creates charges via OAuth at runtime → ambiguous
- Generating code that founder deploys; runtime is founder's infra → **low risk** ✅

### Legal opinion: when needed, when skippable

**Skippable for v1 if all these are true (simplified Dodo-only architecture makes this cleaner):**
- Use Dodo for Indian founder Flow 2 (founder's own Dodo account, Payment Link + webhook secret)
- Use Stripe for foreign founder Flow 2 (founder's own Stripe account, Payment Link + webhook secret)
- Agent writes code only; Baljia infra never initiates payment calls
- Baljia never custodies funds or founder API keys

**Required before launch if:**
- Adding Flow 3 globally via Baljia-routed payments
- Agent runtime actions on stored credentials (refunds, subscription modifications)
- Complex OAuth flows outside of licensed-PA partner programs

**Cost:** ₹3-5L for full opinion from Nishith Desai / AZB / Ikigai Law. ₹50K-1L for a lighter "comfort letter" from Ikigai / TRA Law / Spice Route Legal once v1 architecture is locked.

**Current approach:** Lock architecture to "software-only" discipline → get a ₹50K-1L comfort letter before launch → defer full opinion until Flow 3 or runtime actions are added.

### Indian tax/compliance checklist (pre-launch, non-negotiable)

| Item | Cost | Timeline |
|---|---|---|
| **IEC (Import Export Code)** via DGFT portal | Free | **Week 0 — required for LUT filing + FEMA export-of-services compliance** |
| **MSME / Udyam registration** | Free | **Week 0 — unlocks MSMED 45-day payment enforcement + Sec 43B(h) TDS benefit** |
| GST registration (voluntary from day 1) | Free | Week 1 |
| LUT (Letter of Undertaking) filing | Free via portal, CA helps | Before first export |
| STPI non-STP exporter registration (for SOFTEX) | Free | Week 2 |
| Shop & Establishment Act registration (state) | ₹500–5K | Week 1 |
| Professional Tax (state, if applicable) | ₹500–2.5K/yr | Week 1 |
| Monthly GSTR-1 + GSTR-3B filings | ₹5K–15K/mo (CA) | Ongoing |
| SOFTEX form filings (monthly per Dodo payout — simpler than per-customer) | Included in CA fees | Within 30 days of each Dodo payout |
| **GST: Baljia → Dodo export relationship** (zero-rated; Dodo handles customer-facing GST as MoR) | CA scope | Week 1 |
| **Grievance Officer designation** (name + email on site) | ₹0 | Week 2 (before launch) |
| ToS + Privacy + DPA + Refund + Grievance pages | ₹50K–1L | Week 2–3 |
| Cyber liability insurance ($1–5M coverage) | $3–10K/yr | Pre-launch |
| Sub-processor DPAs (Neon, Render, Anthropic, Upstash, Dodo, Paddle fallback) | Free | **Week 0 — 1-2 week counter-sign lead time from Anthropic/OpenAI** |
| **DPDP Act compliance posture** (appointed DPO if >10K users) | ₹0–50K | Week 2 |
| Indian fintech "comfort letter" on PA classification | ₹50K–1L | Week 3–4 |

**Total pre-launch legal/compliance: ~₹1.5-2L + CA retainer ongoing.**

### Paddle MoR tax positioning (if using Paddle)

- Baljia → Paddle is **export of services** (zero-rated under IGST Section 16)
- LUT required before first Paddle export
- Paddle invoices end customer (as MoR); Baljia invoices Paddle (net payout amount)
- No double-taxation concern
- No US sales tax nexus created (Paddle is seller-of-record)
- No EU VAT burden (Paddle handles OSS)

### Section 194-O TDS

Only triggers when Flow 3 (Route/Connect platform cut) turns on — Baljia becomes "e-commerce operator" and owes 1% TDS on founder product sales. **Deferred liability; tracks with Flow 3 activation.**

---

## Founder AUP & Content Moderation (Flow 2 protection)

Since the engineering agent generates code for whatever the founder describes, Baljia carries downstream liability if a founder builds:

- Payment-taking scam / phishing-adjacent site
- Gambling / adult / arms / crypto-exchange / unlicensed pharma / political-campaign / weight-loss-health-claims product
- Trademark-infringing content (fake brands)
- Content violating Paddle/Dodo/Razorpay AUPs (narrowest intersection wins)

**If it happens and a downstream fraud issue hits, Baljia's MoR provider (Dodo/Paddle) can freeze Baljia's own account.** This is the 0.5% chargeback ceiling scenario — one problem founder tanks the whole platform.

### Founder AUP (published at baljia.ai/founder-aup, referenced in ToS)

Baljia refuses to build for (intersection of Dodo + Paddle + Stripe AUPs — the narrowest wins):

- Gambling, betting, fantasy sports (where payment is involved)
- Adult / sexual content
- Regulated pharmaceuticals without license
- Firearms, weapons, explosives
- Tobacco, e-cigarettes, vaping
- Cryptocurrency exchanges / ICOs / token sales
- Political campaigns / donations / advocacy
- MLM / pyramid / get-rich-quick schemes
- "Consultant-as-service" products where value is human labor packaged as SaaS (Dodo-specific AUP)
- Unregulated health / weight-loss / medical-claim products
- Impersonation / trademark-infringing landing pages

### Content moderation gate (in onboarding flow)

- Intake-time classification (before `refine_idea` runs, not after)
- Known-issue registry includes "banned pattern" list
- If agent detects AUP overlap → route to human review (founder sees "this idea needs manual approval")
- IT Act 2000 Sec 79 safe-harbor requires "due diligence" — this gate IS the due diligence

### Sanctions screening (OFAC / EU / UN)

- Rely on MoR provider (Dodo/Paddle) built-in screening for end-customer payments
- Signup-side: simple list check on founder email + IP + (optional) card BIN
- Commercial tool (ComplyCube / Sumsub) only needed post-revenue if patterns emerge; MoR coverage sufficient at launch

---

## Engineering Agent — Hardcoded Rules (compliance + security)

These must be encoded in `engineering.tools.ts` system prompt AND post-generation code scanners:

1. **Never emit secret keys to client-side code.** Only publishable keys in frontend. Secret keys only in server-side env vars.
2. **Never handle raw card data in generated code.** Always use hosted/tokenized flows: Stripe Elements, Razorpay Checkout, PayPal SDK, Paddle.js.
3. **Always include idempotency keys** on charge/subscription creation API calls.
4. **Always verify webhook signatures** in generated webhook handlers.
5. **Always log transactions** to founder's DB (audit trail, disputes, regulator requests).
6. **Never auto-deploy payment code to production.** Human-in-the-loop gate before founder's generated payment code goes live.
7. **Baljia infra never initiates payment API calls independently.** Generated code runs on founder's infrastructure with founder's credentials; Baljia is never the runtime caller.
8. **Never cache card tokens locally** — RBI Tokenization rule compliance for Indian flows
9. **Generated ToS for founder's product** must include a Grievance Officer contact (India CPA E-Commerce Rules)

---

## Implementation Contracts (for engineers)

### `PaymentProvider` TypeScript interface

```typescript
// src/lib/services/payment-provider.service.ts
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
    | 'dispute.resolved';
  providerEventId: string;
  providerEventTs: number;
  companyId: string | null;
  subscriptionId: string | null;
  customerId: string;
  currency: string;
  amountCents: number | null;
  raw: unknown;
}

export interface PaymentProvider {
  readonly provider: BillingProvider;
  readonly supportedCountries: readonly string[];
  readonly supportedCurrencies: readonly string[];

  createCheckout(opts: ProviderCheckoutOptions): Promise<ProviderCheckoutResult>;
  createCreditPurchase(opts: CreditPurchaseOptions): Promise<ProviderCheckoutResult>;
  getBillingPortalUrl(customerId: string, returnUrl: string): Promise<string>;

  cancelSubscription(id: string, when: 'now' | 'period_end', idempotencyKey: string): Promise<void>;
  refund(chargeId: string, amountCents: number | 'full', idempotencyKey: string): Promise<string>;

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    secret: string,
  ): { valid: true; providerEvent: unknown } | { valid: false; reason: string };

  normalizeEvent(providerEvent: unknown): PaymentDomainEvent | null;
}

// Routing
export function selectProvider(country: string, currency?: string): BillingProvider {
  if (country === 'IN') return 'razorpay';
  if (DODO_COUNTRIES.has(country)) return 'dodo';
  return 'dodo';  // default
}

// Error hierarchy
export class ProviderError extends Error {
  constructor(
    public provider: BillingProvider,
    public code: 'transient' | 'permanent' | 'rate_limited' | 'fraud_declined' | 'unknown',
    public retryable: boolean,
    message: string,
    public providerDetail?: unknown,
  ) { super(message); }
}
```

### Schema migration (Drizzle)

```typescript
// subscriptions additions (polymorphic)
billing_provider: varchar('billing_provider', { length: 20 }).default('stripe_legacy'),
billing_provider_customer_id: varchar('billing_provider_customer_id', { length: 255 }),
billing_provider_subscription_id: varchar('billing_provider_subscription_id', { length: 255 }),
billing_country: varchar('billing_country', { length: 5 }),
currency: varchar('currency', { length: 5 }).default('USD'),
provider_status: varchar('provider_status', { length: 50 }),
latest_provider_event_id: varchar('latest_provider_event_id', { length: 255 }),
latest_provider_event_ts: timestamp('latest_provider_event_ts', { withTimezone: true }),

// unique composite
uniqueIndex('idx_subscriptions_company_provider').on(t.company_id, t.billing_provider),

// NEW: webhook_events — replaces platform_events.payload dedupe (race-free)
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
  uniqueIndex('idx_webhook_events_provider_id').on(t.provider, t.provider_event_id),
  index('idx_webhook_events_unprocessed').on(t.provider, t.received_at),
]);

// NEW: founder_payment_connections (Flow 2)
export const founderPaymentConnections = pgTable('founder_payment_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  company_id: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 20 }).notNull(),
  connection_type: varchar('connection_type', { length: 30 }).notNull(),
  payment_link_url: text('payment_link_url'),
  webhook_secret_encrypted: text('webhook_secret_encrypted'),
  oauth_access_token_encrypted: text('oauth_access_token_encrypted'),
  oauth_refresh_token_encrypted: text('oauth_refresh_token_encrypted'),
  oauth_token_expires_at: timestamp('oauth_token_expires_at', { withTimezone: true }),
  scopes: jsonb('scopes').$type<string[]>(),
  key_version: integer('key_version').default(1),
  status: varchar('status', { length: 30 }).default('pending'),
  last_verified_at: timestamp('last_verified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  uniqueIndex('idx_fpc_company_provider_type').on(t.company_id, t.provider, t.connection_type),
]);

// ALSO RENAME:
//   revenue_ledger.stripe_charge_id  → provider_charge_id + billing_provider
//   ad_spend_ledger.stripe_charge_id → provider_charge_id + billing_provider
```

**Migration path:** (1) Additive columns nullable — deploy. (2) Dual-write 48h. (3) Flip readers. (4) Drop old columns after 30 days. Existing Stripe customers stay on `billing_provider='stripe_legacy'` indefinitely.

### Webhook architecture

**Endpoint layout — one per provider, all use Node.js runtime for raw-body access:**

- `POST /api/webhooks/stripe` (existing; handles `stripe_legacy` only)
- `POST /api/webhooks/dodo`
- `POST /api/webhooks/razorpay`
- `POST /api/webhooks/paddle` (when/if Paddle enabled)

**Processing pipeline (shared wrapper enforces):**

```
1. Read raw body (request.text()).
2. Verify signature: provider.verifyWebhookSignature(rawBody, headers, env.SECRET)
   → Fail: 400 + Sentry counter `webhook.signature_invalid{provider}`.
3. INSERT INTO webhook_events (provider, provider_event_id, ...) ON CONFLICT DO NOTHING RETURNING id
   → If empty: return 200 "deduplicated".
4. Normalize: provider.normalizeEvent(raw) → PaymentDomainEvent or null.
5. BEGIN transaction:
   a. Check latest_provider_event_ts on subscription; reject if event older.
   b. Apply business effect (grant credits / update status / referral bonus).
   c. Update webhook_events.processed_at + subscriptions.latest_provider_event_id.
6. COMMIT.
7. Exception: rollback, leave processed_at NULL, increment processing_attempts. Return 500. Provider retries.
```

**Dev tunneling:** Cloudflare Tunnel (primary — Windows-compatible, stable URL): `cloudflared tunnel --url http://localhost:3000`. Each dev registers their own tunnel URL with each provider's dashboard using a non-prod webhook secret.

### Idempotency key conventions

All outbound Flow 1 provider calls MUST pass an idempotency key.

| Operation | Key format | Valid retry window |
|---|---|---|
| Create customer | `baljia:{companyId}:customer:{country}` | forever |
| Create checkout session | `baljia:{companyId}:checkout:{yyyy-mm-ddThh}` | 1 hour (rotate hourly) |
| Create credit purchase | `baljia:{companyId}:creditpack:{packSize}:{nonce}` | one-shot |
| Cancel subscription | `baljia:{companyId}:cancel:{subscriptionId}` | forever |
| Refund | `baljia:{taskId}:refund:{amountCents}` | forever |

**Per-provider wiring:**
- Stripe: `stripe.checkout.sessions.create(params, { idempotencyKey })`
- Razorpay: `X-Razorpay-Idempotency` header
- Dodo: `Idempotency-Key` header
- Paddle: `custom_data.request_id` field

**Frontend double-submit guard:** `UpgradeDialog.tsx handleStartTrial` disables button between click and redirect, includes `idempotencyKey: crypto.randomUUID()` in POST body.

### Secrets & key management

Split three concerns into three env vars:

| Env var | Purpose | Rotation | Location |
|---|---|---|---|
| `AUTH_SECRET` | Session JWT signing | quarterly | Render `sync:false` |
| **`CREDENTIAL_KEK`** (NEW) | AES-256-GCM KEK for `founder_payment_connections.*_encrypted` | yearly | Render + `key_version` column for rollover |
| `DODO_API_KEY` / `DODO_WEBHOOK_SIGNING_SECRET` | **Dodo Flow 1 (all founders)** | on compromise | Render |
| `PADDLE_API_KEY` / `PADDLE_NOTIFICATION_SECRET` | Paddle warm fallback (ready to activate if Dodo freezes) | on compromise | Render |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe legacy only (existing pre-migration customers) | on compromise | Render |
| ~~`RAZORPAY_*`~~ | **REMOVED** in simplified architecture | — | — |

**Critical fix:** Current `src/lib/credential-crypto.ts` derives AES key from `AUTH_SECRET` via SHA-256. That means rotating `AUTH_SECRET` bricks every stored credential AND every session simultaneously. **Split before v1 ships** — separate `CREDENTIAL_KEK` env var.

**Rotation SOP for webhook secrets (dual-signing window):**
1. Generate new secret at provider.
2. Store as `{PROVIDER}_WEBHOOK_SECRET_NEXT` alongside current.
3. Deploy handler that tries NEXT first, falls back to current.
4. Register new secret at provider.
5. Wait 48h.
6. Remove old secret env var, simplify handler.

**Rotation SOP for CREDENTIAL_KEK:** Background job reads `key_version != current_version` rows, decrypts with old KEK, re-encrypts with new KEK, bumps `key_version`. Keep `CREDENTIAL_KEK` and `CREDENTIAL_KEK_PREVIOUS` both available during re-encryption window.

---

## Trial Conversion Outcomes Matrix

On signup: `trial_period_days: 3` is passed to provider. `subscriptions.status = 'trialing'`, `companies.billing_state = 'trial'`, `execution_state = 'active'`. **10 trial credits granted. No plan credits yet.**

### Day 3 outcome tree

| Provider event | Internal status | companies.billing_state | execution_state | User notification |
|---|---|---|---|---|
| `invoice.paid` + `billing_reason=subscription_create` | `active` | `active` | `active` | "Welcome to Baljia Pro" + grant plan credits |
| `invoice.payment_failed` first attempt | `past_due` | `past_due` | `active` (grace) | "Card declined, retrying in 3 days" |
| `invoice.payment_failed` final attempt (dunning exhausted) | `unpaid` | `unpaid` | `suspended` | "Payment failed, update card to resume" |
| `customer.subscription.deleted` (customer cancelled during trial) | `cancelled` | `cancelled` | `suspended` | "Trial cancelled" |
| `charge.dispute.created` (chargeback) | `active` (unchanged) + `dispute_open` flag | `active` | `active` | **Internal alert only — see Anti-chargeback Playbook** |

### Dunning schedule (Baljia enforces regardless of provider default)

- Day 3, 4, 7 → retry charge (provider-driven)
- Day 8 → first email: "we couldn't bill you"
- Day 11 → second email with provider's update-payment-method link
- Day 15 → `billing_state='cancelled'`, `execution_state='suspended'`, subscription cancelled at provider, founder app suspended
- Day 30 → founder data soft-delete initiated unless resubscribed

### Trial-start invariants

- `subscriptions.status` never advances from `trialing` → `active` except via provider webhook
- Credit grant on activation is idempotent (check `subscriptions.latest_provider_event_id`)
- Card expiry during trial → provider emits `customer.source.expiring` (Stripe) / equivalent → proactive email to founder
- Customer removes card via portal during trial → `payment_method.detached` → mark trial "at risk", email warning

---

## Anti-Chargeback Playbook

**Why this matters:** Dodo's 0.5% monthly chargeback rate = termination trigger. At $49 SKU with 200 signups = one chargeback kills Baljia. At 1-in-50 trial users disputing the day-3 charge, Dodo terminates Baljia in the first 1,000 signups.

### Prevention (in-app UX)

1. **Pre-charge email (Day 2 of trial)**: "Your trial ends tomorrow. You'll be charged $49 on <date>."
   - Sent from verified domain via Postmark
   - One-click cancel button prominent
2. **In-app banner during trial**: countdown timer + "Cancel trial" link
3. **Charge descriptor**: "BALJIA AI $49 sub" — NEVER just "DODO PAYMENTS" (customer doesn't recognize → dispute)
4. **Clear cancellation UX**: one-click, no dark patterns (dark-pattern cancellations DRIVE disputes)
5. **Day 0 confirmation email**: "Your Baljia trial started. Charge on <date>. Cancel anytime before then."
6. **Customer receipt**: from founder's Stripe-hosted page shows "Baljia (via Dodo)" with plain-English description of what Baljia is.

### Response (48h SLA when dispute arrives)

1. Provider webhook `charge.dispute.created` fires
2. Sentry alert + internal dashboard entry (`/admin/disputes`)
3. **Evidence package auto-generated**:
   - Signup IP + email + user-agent
   - Checkout session transcript
   - Trial-period task executions (prove product was used)
   - Day-2 reminder email delivery proof
   - ToS version acknowledged at signup
4. Submit evidence via provider API within 48h
5. Follow-up on `dispute.updated` / `dispute.resolved` webhooks
6. Log outcome in `dispute_history` table

### Fraud prevention at signup

- Email dedup: normalize Gmail dots + `+` aliases (same user with 10 trial addresses = flagged)
- IP velocity cap: max 3 trials per IP per month
- Card BIN block list (populated from prior chargebacks)
- Free-domain email (mailinator, 10minutemail) → require additional verification
- Device fingerprint (FingerprintJS or similar) if volume warrants at scale

### Monitoring

- Daily cron: calculate 30-day rolling chargeback rate per provider
- Alert thresholds (Sentry): 0.2% warning, 0.3% warning-critical, 0.5% emergency (trigger freeze-response runbook)
- Weekly manual review of disputes landed — patterns emerging?

---

## Observability & Operations

### Sentry tagging (every billing path)

All payment-related errors include tags:
- `payment_provider`: `dodo` (primary) / `paddle` (fallback) / `stripe_legacy`
- `billing_event`: `checkout.create` / `webhook.verify` / `subscription.activate` / etc
- `company_id`: UUID
- `billing_state`: `trial` / `active` / `past_due` / `cancelled`

### Metrics (tracked daily, weekly trend)

- Trial conversion rate (% trials that convert on day 3)
- Payment success rate per provider (checkout.complete / checkout.create)
- Webhook processing latency (p50 / p95)
- Chargeback rate per provider (30-day rolling)
- Dunning recovery rate (% `past_due` that return to `active`)
- MRR (single provider — Dodo — simplifies this)
- Refund rate (refunds / charges, 30-day)

### Alerts

- `webhook.signature_invalid` rate > 0.1% → security alert
- Dodo chargeback rate > 0.3% → warning (Slack)
- Dodo chargeback rate > 0.5% → CRITICAL (page on-call)
- `invoice.payment_failed` spike (> 3× 7-day baseline) → investigate card-issuer block
- Reconciliation drift detected → daily Slack digest

### Reconciliation job (nightly)

`src/lib/services/reconciliation.service.ts` (to be built):
- Pull all `active` subscriptions from each provider
- Diff against Baljia's `subscriptions` table
- Detect:
  - **Ghost subscriptions** (active in provider, `cancelled` in Baljia) — missing webhook
  - **Zombie subscriptions** (active in Baljia, not in provider) — stale data
  - **Status drift** (different `status` between Baljia and provider)
- Alert via Sentry tag `reconciliation_drift` + Slack digest

### Testing strategy

- **Sandbox per provider**: Dodo sandbox, Razorpay `rzp_test_*`, Paddle `sandbox-api.paddle.com`
- **Mock-provider E2E**: Playwright tests against a mock `PaymentProvider` implementation in CI. No real API calls in CI.
- **Test clocks for time-travel**: Stripe has `test_clocks` to simulate day-3 renewal; Dodo/Razorpay do not — use mock provider for lifecycle tests
- **Test cards per provider**: documented in `docs/testing-payments.md` (to be created)
- **Dev tunneling**: Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) for webhook tests against sandbox

### Dev environment

- `.env.local` has sandbox keys for all providers
- `npm run dev:webhook-tunnel` script launches Cloudflare Tunnel + prints webhook URL to register at each provider
- Never point dev tunnels at production webhook secrets — separate env: `DODO_SANDBOX_*` vs `DODO_*`

---

## Provider Freeze Runbook (business continuity)

**Scenario:** Dodo freezes Baljia's account. Trustpilot pattern: 8+ reports of 120-day fund holds in Dec 2025 – Feb 2026.

### Detection

- Dodo emails operations@baljia.ai
- Webhook: `merchant.suspended` (if Dodo sends it)
- Sentry alert: all `checkout.create` calls to Dodo return 4xx consistently
- Manual: Trustpilot-style reports from customers that their checkout is failing

### Response (within 24h of detection)

1. Acknowledge internally; assign on-call
2. **Switch routing config** to secondary: Paddle (if approved) or Razorpay-international for affected global customers
3. Email affected active subscriptions: "We're updating your payment method. Please re-enter card within 7 days." with one-click re-auth link
4. Cancel Dodo subscriptions gracefully (don't double-bill)
5. Dispute Dodo fund-hold via email + legal notice if necessary
6. Postmortem: what triggered freeze? (Chargeback spike? AUP complaint? Sudden volume?)

### Migration-readiness prereqs (must be true BEFORE freeze)

- Paddle live-approved (not just sandbox) — enables instant failover
- All customer card-on-file metadata stored in Baljia's `subscriptions` table (not just provider) — required for re-auth email template to work
- Re-auth email template pre-written in Postmark
- `PaymentProvider` abstraction makes provider switch a config change (`PRIMARY_GLOBAL_PROVIDER=paddle`), not a code rewrite

### Expected outcome

- Re-auth rate: 50-70% of active customers re-enter card within 7 days (industry data)
- 30-50% drop-off — acceptable loss vs Baljia continuing to operate
- Dodo funds release: 90-120 days typical

---

## Refund Policy (draft — published at baljia.ai/refund-policy)

Resolving the CLAUDE.md ↔ faq/page.tsx contradiction (decision #4 in Open Strategic Questions):

| Scenario | Policy | Mechanism |
|---|---|---|
| Trial → forgot to cancel → charged on day 3 | Full refund within 7 days of first charge, no questions asked | Provider API refund |
| Task failed due to platform error (attributable to Baljia infra) | Automatic credit refund (CLAUDE.md rule) | Credit ledger only — no payment refund |
| Task failed due to ambiguous request | Credit consumed; founder can re-brief for same credit | Manual review |
| Customer wants to cancel subscription | Cancel anytime, access until period end, no proration refund | Provider-native cancel |
| Customer wants full refund mid-period (beyond 7 days) | Case-by-case, default NO | Manual API refund |
| Annual plan cancel request | Prorated refund for unused months, minus 15% handling | Manual API refund |

**Published at launch. Contradiction with faq/page.tsx must be resolved before first customer charge.**

### Customer lifecycle edge cases

- **Customer moves countries mid-subscription**: current cycle stays on existing provider; next renewal uses new-country provider. Subscription IDs do not port.
- **Upgrade Starter → Growth mid-cycle** (if multi-tier kept): immediate upgrade, prorated. Credits: add difference.
- **Downgrade Growth → Starter mid-cycle**: effective next cycle; no mid-cycle refund. Credits: keep current balance.
- **Chargeback dispute received**: respond within 48h with evidence package. 0.5% rate = termination risk on Dodo — every dispute is defended, not dropped.

### Founder account lifecycle (Flow 2)

- Founder cancels Baljia subscription → Flow 2 `founder_payment_connections` rows marked `status='revoked'`. No credential revocation needed at provider (Baljia only stored URL + webhook secret, not API keys) — founder simply removes webhook at provider side.
- Founder deletes account (DPDP delete request) → credentials purged + audit metadata retained 2 years + provider sub-account dissolved
- 30-day window after cancellation to resubscribe without losing connection config

### Invoice branding

- Founder receipt from Baljia's Dodo checkout: "Baljia AI" with Dodo as payment processor — Dodo's MoR model means customer sees both
- Indian B2B customers needing GST-compliant invoice with Baljia's GSTIN: NOT issued directly (Dodo is MoR; Dodo handles customer-facing invoicing). For the small % who need Baljia's GSTIN specifically, manual invoice generation on request.
- Support macro pre-written: "What is this charge from Dodo Payments?" — explains Dodo is our payment processor, not a separate company

---

## Cost Projections

### Flow 1 — Baljia's subscription revenue (at $49/mo per founder, Dodo-only)

| Scale | Customer mix | Dodo fees (effective) | Annual cost |
|---|---|---|---|
| 100 customers | 70 global + 30 India | ~5.4% blended (5.9% intl, 4% India) | **~$3,175/yr (~₹3.1L)** |
| 1,000 customers | 70% global + 30% India | ~5.4% blended | **~$31,750/yr (~₹30.8L)** |

**Note on simplification tradeoff:** Dodo-only architecture costs ~₹2-3L/yr more than a Razorpay+Dodo split at 1,000 customers (Razorpay domestic INR is ~2.7%, Dodo is ~4%). Accepted tradeoff because:
- One integration, one webhook endpoint, one reconciliation flow
- No Razorpay International approval delay (5-day)
- No per-Indian-customer GST invoicing complexity
- Single LUT/SOFTEX export-of-services relationship (Baljia → Dodo monthly)
- ~1-2 weeks faster to ship v1

**If MoR swapped for Paddle (fallback):** ~7% blended → adds ~$9K/yr at 1,000 customers vs Dodo baseline.

### Pre-launch legal/compliance one-time

~₹1.5-2L one-time + ₹60K-1.8L/yr ongoing CA retainer.

### Flow 3 at future scale

Deferred until 50+ founders. At that stage, Razorpay Route fees ~2% on INR + Stripe Connect ~3% on USD. Baljia's cut (e.g., 15% of founder revenue) is the primary revenue — payment fees are secondary cost. Section 194-O TDS (1% on e-commerce sales) triggers at Flow 3 activation.

### Provider switching cost (business continuity)

If Dodo freezes Baljia and we flip to Paddle:
- Direct cost: $0 (Paddle approval pre-done)
- Re-auth drop-off: 30-50% revenue loss (customers don't all re-enter card)
- Recovery timeline: 7-14 days to reach 70% re-activation

---

## Build Plan

### v1 blockers (before coding starts — from gap analysis)

| # | Item | Why it blocks |
|---|---|---|
| v1-B1 | **Delete Stripe runtime tools from engineering agent.** `src/lib/agents/tools/engineering.tools.ts` lines 1369–1510 has `stripe_create_product/price/payment_link/get_products` using **Baljia's platform Stripe key** — directly violates doc rule #2 | Contradicts Flow 2 architecture; RBI PA exposure; Stripe Restricted Status risk |
| v1-B2 | **Create `webhook_events` table** + migrate dedupe off `platform_events.payload` race | Current dedupe is racy; double-charge risk |
| v1-B3 | **Schema migration: polymorphic `billing_provider` on subscriptions + ledgers** | Can't wire multiple providers without this |
| v1-B4 | **Create `founder_payment_connections` table** per DDL above | Flow 2 blocker |
| v1-B5 | **Split `AUTH_SECRET` from `CREDENTIAL_KEK`** in `src/lib/credential-crypto.ts` + add `key_version` | Rotation hazard fix |
| v1-B6 | **Define `PaymentProvider` interface** per spec above | Keep polymorphic to support Dodo primary + Paddle fallback + stripe_legacy migration |
| v1-B7 | **Write missing `expire_stale_trials()` PG function** called by `trial-expiry/route.ts:25` | Breaks silently in prod |
| v1-B8 | **Plan simplification**: drop `starter/growth/scale` from `PLAN_CONFIG` if staying with $49 flat (decision #1) | Reconcile doc with code |

### v1 essentials (ship in 2-3 weeks)

**Flow 1:**
1. Implement `DodoProvider` (Flow 1 global)
2. Implement `RazorpayProvider` (Flow 1 India)
3. GeoIP / billing-country routing logic (prefer billing-country from card BIN over IP)
4. Wire `trial_period_days: 3` into `createCheckoutSession` for all providers
5. Update `handleSubscriptionCreated` to grant plan credits only on `status === 'active'` (not `trialing`)
6. Add idempotency keys to every outbound provider call
7. Add `pg_advisory_xact_lock` to `getOrCreateCustomer` + `createCheckoutSession`
8. Add `latest_provider_event_id` + out-of-order event protection to all webhook routes
9. Provider-aware `UpgradeDialog` + `PurchaseCreditsDialog` (GeoIP hint + provider selection)
10. Cloudflare Tunnel-based dev webhook setup + script `npm run dev:webhook-tunnel`

**Flow 2:**
11. Build "Integrations" panel UI (Payment Link + webhook secret fields)
12. Engineering agent prompt update: generate subscribe button + webhook handler using founder's connection
13. Post-generation code scanner: reject diffs containing `process.env.STRIPE_SECRET_KEY` in founder code
14. Encrypt/decrypt helpers using new `CREDENTIAL_KEK`
15. Founder account revoke flow (credentials purge on Baljia cancel)

**Observability + Ops:**
16. Sentry tagging on all billing paths (`payment_provider`, `billing_event`, `company_id`)
17. Implement `reconciliation.service.ts` (nightly diff)
18. Chargeback webhook handlers per provider + dispute evidence auto-assembly
19. Signup fraud controls (email dedup, IP velocity, BIN block list)
20. Dodo chargeback-rate cron (daily, 0.3% warn / 0.5% emergency)

**Policies + Legal:**
21. Draft + publish Refund Policy (resolve CLAUDE.md ↔ faq contradiction)
22. Draft + publish Founder AUP (prohibited categories)
23. Content-moderation gate in onboarding (pre-`refine_idea`)
24. Grievance Officer designation + contact page

**Playwright smoke:**
25. Trial-start → 3-day simulate (mock clock) → renewal → cancel → resubscribe

### v1.1 (weeks 4-6 post-launch, if demand)

- Stripe Connect OAuth wiring for Flow 2 foreign founders (pending Stripe sales approval — upgrade from Payment Link UX to clean "Connect Stripe" button)
- Dodo OAuth equivalent for Flow 2 Indian founders (if Dodo releases a partner OAuth program)
- Manual API key entry fallback (for founders who need complex billing beyond Payment Links)
- Provider freeze runbook automation (detect `merchant.suspended` → auto-flip `PRIMARY_PROVIDER` env → notify on-call)
- PayPal as additional Flow 2 option

### v2 (month 3-6, if marketplace model validates)

- Stripe Connect `application_fee_amount` for foreign founder marketplace (requires Stripe Connect platform approval)
- For Indian founder marketplace: evaluate re-introducing Razorpay Route OR wait for Dodo's split-payout feature to mature
- Hosting-lifecycle cron: delete Render services on churned subs (SPEC-BILL-104)
- Section 194-O TDS handling (when Flow 3 activates)

---

## Code Drift Audit (what's broken in current code vs this doc)

From sweep analysis — code realities that must be reconciled:

| File | Issue | Severity |
|---|---|---|
| `src/lib/agents/tools/engineering.tools.ts:1369-1510` | 4 Stripe tools use Baljia's platform key — custody violation | **Critical** |
| `src/lib/services/billing.service.ts:39-48` | `createCheckoutSession` doesn't pass `trial_period_days` — 3-day trial aspirational only | **Critical** |
| `src/lib/services/billing.service.ts:89-127` | `handleSubscriptionCreated` grants plan credits immediately regardless of `trialing` state | **Critical** |
| `src/app/api/cron/trial-expiry/route.ts:25` | Calls `expire_stale_trials()` PG function that doesn't exist in migrations | **Critical** |
| `src/app/api/webhooks/stripe/route.ts:22-28` | Dedupe via `platform_events.payload` LIKE — race condition, no unique index | **Critical** |
| `src/lib/credential-crypto.ts:64-68` | AES key derived from `AUTH_SECRET` — rotation bricks everything | **Critical** |
| `src/lib/services/billing.service.ts:16-18` | 4 tiers (`trial/starter/growth/scale`) vs doc's 1 tier $49 | **Important (decision #1)** |
| `src/components/dashboard/PurchaseCreditsDialog.tsx:20-45` | Credit packs Stripe-only | **Important** |
| `src/app/api/webhooks/stripe/route.ts:77-95` | Referral bonus logic baked into Stripe handler — needs to fire from Dodo webhook too (and Paddle if activated as fallback) | **Important** |
| `src/lib/db/schema.ts:278-292` | `subscriptions.stripe_customer_id`, `stripe_subscription_id` hardcoded | **Important (schema migration)** |
| `src/lib/db/schema.ts` (revenue_ledger, ad_spend_ledger) | `stripe_charge_id` hardcoded | **Important** |
| `src/app/(public)/faq/page.tsx:36` | Says "platform errors auto-refunded" — contradicts CLAUDE.md | **Important (decision #4)** |
| ~21 files total | Stripe references scattered | **Audit needed** |

---

## CLAUDE.md Update List

These lines in `CLAUDE.md` (project root) must change to reflect payment decisions:

| Line ref | Current | Update to |
|---|---|---|
| Line 84 (Payments row) | `Payments \| Stripe` | `Payments \| Dodo Payments (MoR — primary for all founders) \| Paddle (warm fallback)` |
| Line 189 (Ad Spend row) | `Founder (daily Stripe charges)` | Resolve per decision #2 (Baljia-fronts vs founder-connects-own Meta/Google billing) |
| Line 384 | `billing.service.ts: Stripe integration` | `billing.service.ts: PaymentProvider abstraction (Dodo primary + Paddle fallback)` |
| Line 453 (Phantom mounts) | "memory, skills, stripe, gmail" | Remove `stripe` if migrated; keep if `stripe_legacy` retained for existing customers |
| Line 467 | "Trial credit budget is ambiguous" | Resolve per decision #3 (10 vs 15 credits) |
| Various onboarding docs | References to Stripe as example | Update per new patterns |

**Critical:** CLAUDE.md must update BEFORE engineering agent starts generating code. Otherwise the agent will keep outputting Stripe flows.

---

## Action Items

### For user (this week, parallel)

1. **Email Stripe sales** — request Connect platform approval for Baljia as Indian Pvt Ltd onboarding foreign merchants
   - Endpoint: [stripe.com/contact/sales](https://stripe.com/contact/sales) or `partners@stripe.com`
   - Template pitch:
     > Baljia AI is an Indian-incorporated SaaS platform that uses AI agents to build and operate companies for founders. We have founders in multiple countries including US, UK, EU, Canada, and India. We'd like to use Stripe Connect to let our non-Indian founders accept payments in their generated SaaS products, with Baljia as the platform. India-based founders will use Razorpay. Can you confirm Baljia's Indian Pvt Ltd can be approved as a Stripe Connect platform for foreign connected accounts, and what's the process/timeline?
   - Ask: (1) eligibility, (2) timeline, (3) required docs, (4) Custom vs Express vs Standard, (5) `application_fee_amount` permitted?

2. ~~Apply to Razorpay Partners~~ — **NOT NEEDED** in simplified architecture. Indian founders use Dodo for Flow 2 (their own Dodo accounts), not Razorpay Partners. Skip this application.

3. **Sign up Dodo Payments** — [dodopayments.com](https://dodopayments.com/) with Indian Pvt Ltd docs
   - Expect hours-to-days verification
   - Email `compliance@dodopayments.com` asking for written confirmation that AI SaaS (agents executing tasks on behalf of founders) is classified as digital product, not service-based
   - Do NOT route real money until classification written confirmation received

4. **Apply to Paddle** (as fallback) — [paddle.com](https://paddle.com/)
   - Position Baljia as "pure SaaS / AI software product" in all descriptions, NOT "AI service that runs your company"
   - Have clean ToS + Privacy + Refund + Pricing pages ready before applying
   - Expect 5-14 days live-mode approval

5. **Activate Razorpay International Payments** — Razorpay dashboard → Account & Settings → International Payments
   - Required docs: GSTIN, Udyam MSME cert, business address proof, Aadhaar + PAN, video KYC, **IEC certificate**
   - Expected activation: ~5 days (blocked without IEC)

6. **Register IEC** at [DGFT portal](https://www.dgft.gov.in/) — Week 0, free, 3-5 days

7. **Register MSME / Udyam** at [udyamregistration.gov.in](https://udyamregistration.gov.in/) — Week 0, free, 10 minutes

8. **Shop & Establishment Act registration** (state-specific)

9. **Engage Indian CA familiar with software exports**
   - Scope: GST registration + LUT + STPI + monthly filings + SOFTEX discipline
   - Budget: ₹60K-1.5L/yr
   - Interview 2-3; pick one with SaaS client portfolio

10. **Sign sub-processor DPAs** (Anthropic / OpenAI / Neon / Render / Upstash / Stripe / Razorpay)
    - **Week 0** — 1-2 week counter-sign lead time
    - Anthropic: Trust Center portal
    - OpenAI: DPA form
    - Others: standard templates on each provider's trust page

11. **Engage Indian fintech lawyer for comfort letter** (after architecture is locked, Week 3-4)
    - Suggested firms: Ikigai Law, TRA Law, Spice Route Legal
    - Scope: 5-10 page comfort letter on Baljia's Flow 2 PA classification
    - Budget: ₹50K-1L

12. **Appoint Grievance Officer** (name + email on site before launch)

13. **Decide 12 open strategic questions** (top of this doc) — especially #1 (pricing model), #2 (ad-spend lane), #4 (refund policy), #5 (founder AUP)

### For Claude (code work, can start now on v1-B items)

See "v1 blockers" + "v1 essentials" sections above — 25 concrete tasks.

---

## Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-04-22 | Reject Stripe as Flow 1 primary for Indian Pvt Ltd | Invite-only, doesn't issue FIRA, Connect limited — all verified in Stripe docs |
| 2026-04-22 | Reject Lemon Squeezy | Stripe-acquired, in active migration to Stripe Managed Payments, India payout broken |
| 2026-04-22 | Reject Chargebee for v1 | Overkill pre-revenue, still requires gateway underneath, not MoR |
| 2026-04-22 | Defer Paddle from primary → fallback | Zero named Indian SaaS success stories found in 2-pass research; FTC enhanced vetting risk; AUP ambiguity on Flow 2 OAuth custody |
| 2026-04-22 | Adopt Dodo Payments as Flow 1 global primary | Indian-founded team, fastest onboarding, full MoR, native trial support, maintained TS SDK |
| 2026-04-22 | Adopt Razorpay as Flow 1 India primary | Native UPI + cards, auto-eFIRC, RBI-compliant for INR, T+2 settlement |
| 2026-04-22 | Verified Razorpay non-INR subscription e-mandate is NOT broken | Correction to first-pass research — RBI mandate is for Indian cards only; international cards auto-renew fine |
| 2026-04-22 | Shrink Flow 2 v1 scope to Payment Link pattern | Avoids raw OAuth complexity, reduces PA classification risk to near-zero, covers 70-80% of SaaS use cases |
| 2026-04-22 | Verified Stripe Connect platform IS available to Indian Pvt Ltd (with friction) | Stripe's own docs confirm Indian platforms can onboard foreign merchants via Connect — requires contacting sales |
| 2026-04-22 | Defer Stripe Atlas | Only needed if Stripe rejects Baljia as Connect platform AND Flow 3 globally required at launch |
| 2026-04-22 | Defer Flow 3 (marketplace cut) to v2 | Model not validated; Razorpay Route is India-only; Stripe Connect path still pending sales approval |
| 2026-04-22 | Adopt "Partner program over raw OAuth" rule | Razorpay Partners + Stripe Connect inherit licensed-PA regulatory coverage |
| 2026-04-22 | Adopt "software-only agent" rule | Engineering agent writes code, Baljia infra never initiates payment API calls at runtime |
| 2026-04-22 | Defer full PA legal opinion (₹3-5L) | Replace with comfort letter (₹50K-1L) once architecture is locked |
| 2026-04-22 | **User directive: no Baljia in money flow** | Rules out MoR-aggregator pattern for Flow 2/3; locks in split-at-payment (Route/Connect) pattern |
| 2026-04-22 | Match Polsia's exact trial-start UX pattern | Click task → immediate Stripe redirect, no modal; two CTA entry points |
| 2026-04-22 | Keep Cashfree as Razorpay backup | Named in rejected-providers list; activate only if Razorpay rejects Baljia |
| 2026-04-22 | Doc ↔ code drift reconciliation required pre-launch | Stripe runtime tools in engineering agent must be deleted; trial mechanics must be wired |

---

## Research Sources

### Provider docs and primary sources

- [Dodo Payments pricing](https://dodopayments.com/pricing) · [Dodo MoR page](https://dodopayments.com/payments/merchant-of-record) · [Dodo Subscription docs](https://docs.dodopayments.com/features/subscription) · [Dodo TS SDK](https://github.com/dodopayments/dodopayments-node) · [Dodo Merchant Acceptance Policy](https://docs.dodopayments.com/miscellaneous/merchant-acceptance) · [Dodo MSA](https://dodopayments.com/terms-of-use)
- [Paddle pricing](https://www.paddle.com/pricing) · [Paddle AUP](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle) · [Paddle supported countries](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle) · [Paddle trials](https://developer.paddle.com/concepts/subscriptions/trials) · [Paddle customer portal](https://developer.paddle.com/concepts/customer-portal) · [Paddle supported currencies](https://developer.paddle.com/concepts/sell/supported-currencies)
- [Razorpay Subscriptions FAQs](https://razorpay.com/docs/payments/subscriptions/faqs/) · [Razorpay RBI card mandate](https://razorpay.com/docs/announcements/rbi-card-mandate-guidelines/subscriptions/) · [Razorpay International Payments](https://razorpay.com/docs/payments/international-payments/) · [Razorpay Route FAQs](https://razorpay.com/docs/payments/route/faqs/) · [Razorpay eFIRC](https://razorpay.com/docs/payments/dashboard/account-settings/firs/) · [Razorpay Partners](https://razorpay.com/partners/) · [Razorpay OAuth docs](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/)
- [Stripe accounts invite-only India](https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india) · [Stripe Connect India onboarding](https://support.stripe.com/questions/onboarding-requirements-for-stripe-connect-in-india) · [Stripe Connect Custom accounts](https://docs.stripe.com/connect/custom-accounts) · [Stripe Atlas](https://stripe.com/atlas) · [Stripe Atlas Indian founder guide](https://docs.stripe.com/atlas/indian-founder-guide)
- [Lemon Squeezy 2026 update](https://www.lemonsqueezy.com/blog/2026-update) · [LS supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)
- [Chargebee pricing](https://www.chargebee.com/pricing/) · [Chargebee supported gateways](https://www.chargebee.com/docs/payments/2.0/kb/billing/what-gateways-does-chargebee-support) · [Chargebee is not a gateway](https://www.chargebee.com/docs/payments/2.0/kb/billing/is-chargebee-a-gateway)
- [Cashfree International Payments](https://www.cashfree.com/accept-international-payments-from-india/) · [Polar.sh supported countries](https://polar.sh/docs/merchant-of-record/supported-countries)

### Regulatory (India)

- [RBI PA/PG Guidelines 2020](https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11822)
- [RBI PA Directions Sept 2025](https://www.fidcindia.org.in/wp-content/uploads/2025/09/RBI-PAYMENT-AGGREGATORS-DIRECTIONS-15-09-25.pdf)
- [RBI Cross-Border PA Draft 2024](https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12643)
- [CGST Act 2017](https://cbic-gst.gov.in/CGST-bill-e.html) · [IGST Act 2017](https://cbic-gst.gov.in/igst-act.html)
- [DPDP Act 2023](https://www.meity.gov.in/writereaddata/files/Digital%20Personal%20Data%20Protection%20Act%202023.pdf)
- [Consumer Protection E-Commerce Rules 2020](https://consumeraffairs.nic.in/sites/default/files/E-commerce%20%28Amendment%29%20Rules%2C%202021.pdf)
- [AZB Partners — RBI PA framework analysis](https://www.azbpartners.com/bank/payment-aggregators-and-gateways-indias-regulatory-framework/)
- [IEC registration — DGFT](https://www.dgft.gov.in/)
- [Udyam registration](https://udyamregistration.gov.in/)

### Founder-experience sources

- [Trustpilot: Paddle](https://www.trustpilot.com/review/paddle.com) · [Trustpilot: Dodo](https://www.trustpilot.com/review/dodopayments.com) · [Trustpilot: Razorpay](https://www.trustpilot.com/review/razorpay.com) · [Trustpilot: Lemon Squeezy](https://www.trustpilot.com/review/lemonsqueezy.com)
- [HN: Paddle processing history rejection (Aug 2024)](https://news.ycombinator.com/item?id=41179262)
- [Matías Salinas — How I Got My SaaS Platform Approved on Paddle (May 2025)](https://msalinas92.medium.com/how-i-got-my-saas-platform-approved-on-paddle-without-losing-my-mind-738e7f70cc45)
- [Tibo Devmystify — MoR comparison Oct 2025](https://devmystify.com/blog/choosing-a-merchant-of-record-in-2025-lemon-squeezy-vs-paddle-vs-dodo-payments-my-experience)
- [FTC — Paddle $5M settlement June 2025](https://www.ftc.gov/news-events/news/press-releases/2025/06/paddle-will-pay-5-million-settle-ftc-allegations-unfair-payment-processing-practices-facilitation)
- [LowEndTalk — Razorpay 3-month payout hold](https://lowendtalk.com/discussion/163398/razorpay-not-giving-my-payout-from-3-months-fraud-gateway)
- [Business Today — Forming US LLC for Stripe (March 2026)](https://www.businesstoday.in/impact-feature/story/forming-a-us-llc-to-access-stripe-is-a-legitimate-move-the-tax-compliance-it-creates-is-not-small-519932-2026-03-10)

### AI-builder cohort payment patterns (Flow 2 benchmarking)

- [Lovable payments docs](https://docs.lovable.dev/features/payments) (Paddle + Stripe)
- [Bolt.new Stripe blog](https://bolt.new/blog/huge-update-alert-bolt-stripe-payments-made-easy) (Stripe only)
- [v0 + Stripe (Vercel)](https://vercel.com/blog/from-idea-to-secure-checkout-in-minutes-with-stripe) (Stripe only)
- [Replit + Stripe (LowCode Agency)](https://www.lowcode.agency/blog/replit-stripe-integration) (Stripe primary)

---

## Open Questions Requiring Verification

| Question | Why it matters | How to resolve |
|---|---|---|
| Will Stripe approve Baljia as Connect platform? | Unlocks clean Flow 2 foreign-founder OAuth + Flow 3 via `application_fee_amount` | Email Stripe sales, wait for response |
| Will Dodo classify Baljia's AI SaaS as digital product or service-based? | If service-based, Dodo rejects → fallback to Paddle | Email `compliance@dodopayments.com` for written request |
| Will Paddle approve Baljia as Indian Pvt Ltd? | Primary fallback if Dodo rejects | Apply with clean SaaS positioning |
| ~~Will Razorpay approve Baljia as Technology Partner?~~ | N/A — Razorpay dropped from v1 in simplified architecture | Skip |
| **Will Dodo support reliable UPI AutoPay for Indian recurring?** | If not, Indian customer card renewals may fail 30-40% | Email `support@dodopayments.com` + test in sandbox |
| Does our CA know software-exports well (LUT/SOFTEX/FIRC)? | Required for compliant Indian SaaS export | Interview 2-3 CAs, pick one with SaaS client base |

---

## Reference: Modal Indian-Global-SaaS Payment Patterns (2025-2026)

From market validation research (Pass 2), these are the real patterns used by Indian founders:

1. **Razorpay + Stripe via US LLC** — most common. Indian founder forms US LLC via Stripe Atlas or similar to bypass India-specific Stripe restrictions.
2. **Dodo Payments only (MoR)** — rapidly growing among AI-first Indian indie hackers.
3. **Razorpay + Chargebee** — used by Freshworks-era Indian SaaS, overkill for pre-revenue.
4. **Paddle-only** — slower approval but predictable once approved (e.g., Chargebee's own history).
5. **xPay Checkout (YC W24)** — newer Indian-specific alternative, less track record.

**Baljia's chosen pattern:** hybrid #2 (Dodo MoR for global) + #1 (Razorpay for India), with Stripe Connect added post-approval for clean foreign-founder Flow 2. Bespoke but defensible.

---

*Last updated: April 2026. This document is a living decision log. Update as provider responses land and reality replaces predictions.*
