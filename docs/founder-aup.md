# Founder Acceptable Use Policy (AUP)

**Audience:** Founders signing up to use Baljia; legal/compliance
**Companion to:** [baljiapayment.md](./baljiapayment.md) (decisions)
**Publication target:** `baljia.ai/founder-aup` (referenced from ToS)
**Status:** Draft — needs final lawyer review before publishing

---

## Why This AUP Exists

Baljia's engineering agent generates code for whatever product the founder describes. If a founder builds a scam site, a gambling platform, or something that violates our payment providers' AUPs, **Baljia carries downstream liability**:

1. **MoR account termination risk** — Dodo, Paddle, and Razorpay all prohibit certain business categories. If any Baljia founder's product falls into a prohibited category, the payment provider can terminate Baljia's entire account (not just the founder's).
2. **IT Act 2000 Section 79** (intermediary safe harbor) — requires "due diligence." Without a published AUP + content-moderation gate, Baljia loses safe-harbor protection when founder products cause downstream harm.
3. **Consumer protection** — Indian Consumer Protection Act 2019 makes e-commerce platforms responsible for seller conduct.
4. **Reputation** — one founder building a scam on Baljia's infrastructure damages every other founder's trust in the platform.

**This AUP is the narrowest intersection of:**
- Dodo's [Merchant Acceptance Policy](https://docs.dodopayments.com/miscellaneous/merchant-acceptance)
- Paddle's [Acceptable Use Policy](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)
- Razorpay's merchant terms
- Stripe's restricted business list
- Indian and international law

If any upstream provider prohibits a category, Baljia prohibits it.

---

## Prohibited Founder Product Categories

Baljia will NOT build (and the engineering agent will refuse to generate code for) products in these categories:

### Illegal or regulated-without-license

1. **Gambling, betting, fantasy sports** (any form where payment is involved, including games of skill that require license in founder's jurisdiction)
2. **Regulated pharmaceuticals** without documented medical licensing in operating jurisdiction
3. **Firearms, weapons, explosives, ammunition**
4. **Tobacco, e-cigarettes, vaping products, cannabis** (including CBD in jurisdictions where regulated)
5. **Alcoholic beverages** without license verification
6. **Cryptocurrency exchanges, ICOs, token sales, NFT marketplaces** with speculative payment flow
7. **Unlicensed financial services** (money lending, payday loans, unauthorized investment platforms, unregistered securities)
8. **Controlled substances** of any kind
9. **Unauthorized copies** of copyrighted / trademarked content

### High-fraud / chargeback-prone categories

10. **MLM, pyramid schemes, get-rich-quick** offerings
11. **Unregulated health / weight-loss / medical-claim** products (fat burners, "miracle cures", unproven supplements)
12. **Dating / companion / adult entertainment** services (any sexual content or sexual services)
13. **Gambling-adjacent** (crypto casinos, skill-based gambling tournaments, esports betting)
14. **Multi-level reseller programs** (passing off third-party products)

### Ethically / socially harmful

15. **Political campaigns, donations, advocacy funding** (restricted by multiple PAs; Baljia stays neutral)
16. **Impersonation / trademark-infringing landing pages** (fake brands, typosquats)
17. **Phishing / credential-harvesting** sites (even if "for educational purposes")
18. **Hate speech / extremist content** distribution platforms
19. **Discrimination-as-a-service** (tools that discriminate by protected class)
20. **Stalkerware, spyware, surveillance-as-a-service**

### Service-based businesses (Dodo-specific AUP)

21. **"Consultant-as-service" products** where the majority of value is human labor packaged as SaaS
    - Example prohibited: "Done-for-you agency service for $99/mo" (human does work)
    - Example allowed: "AI writes marketing copy for $99/mo" (software does work)
    - This is the key AUP filter that affects Baljia's own positioning with Dodo

### Regulatory / compliance

22. **Unlicensed taxi / ride-share / delivery** operators in jurisdictions with licensing
23. **Short-term rental** platforms in jurisdictions with strict hospitality regulation (require host verification)
24. **Unlicensed event ticketing** / scalping

---

## Content Moderation Gate (onboarding-time enforcement)

The engineering agent will refuse to `refine_idea` / `fetch_business_url` / `invent_idea` when the founder's stated product intent matches a prohibited category.

### How it works

```
Founder enters idea: "I want to build a CBD e-commerce site in Texas"
      ↓
Onboarding intake screen runs AUP classifier:
  - Keywords match: "CBD" → category 4 (regulated)
  - Jurisdiction check: Texas CBD regulations
      ↓
Decision:
  - Category 4 + Texas regulatory ambiguity → route to MANUAL REVIEW
  - Display to founder: "Your product falls under a regulated category.
    Please confirm you have the required licenses by contacting
    compliance@baljia.ai before we proceed."
      ↓
If founder doesn't provide license docs: idea refused.
If founder provides license docs: human review within 48h, approved or denied.
```

### Implementation

File: `src/lib/services/content-moderation.service.ts`

```typescript
export interface AUPCheckResult {
  status: 'allowed' | 'review' | 'refused';
  categoryMatch?: string;
  reason?: string;
}

export function checkFounderIdeaAgainstAUP(
  ideaText: string,
  businessUrl?: string,
  jurisdiction?: string,
): AUPCheckResult {
  // 1. Keyword detection (fast)
  // 2. LLM classification (semantic — uses Haiku)
  // 3. Jurisdictional overlay (some products legal in US, not in India)
  // 4. Return decision
}
```

Called in onboarding pipeline BEFORE `refine_idea`. Blocked ideas surface a clear message to the founder with option to contact compliance.

### Human review path

- Founder sees: "Your product needs manual approval" → fills form → creates ticket in `/admin/aup-reviews`
- On-call reviews within 48h, approved/denied with explanation
- If approved → onboarding proceeds normally
- If denied → founder receives refund of any paid fees + explanation

---

## Sanctions Screening

At signup, Baljia performs basic sanctions screening on founder data against:

- [OFAC Specially Designated Nationals (SDN) list](https://sanctionssearch.ofac.treas.gov/)
- [EU Consolidated Sanctions list](https://www.sanctionsmap.eu/)
- [UN Consolidated Sanctions list](https://www.un.org/securitycouncil/sanctions/)

### What we check

- Founder email domain
- Founder IP country (cannot operate from sanctioned jurisdiction)
- Founder business name (if provided)
- Optional at scale: card BIN country, KYC documents

### Sanctioned jurisdictions (cannot sign up)

Per OFAC embargoed countries + UN comprehensive sanctions:

- North Korea (DPRK)
- Iran
- Syria
- Cuba
- Crimea, Donetsk, Luhansk (Russian-occupied regions)
- Any country added to embargo list over time

### Implementation

Initial approach: **rely on MoR provider's screening** (Dodo, Paddle, Razorpay all screen end customers). For signup-side screening, simple list check against OFAC SDN via [sanctionssearch.ofac.treas.gov](https://sanctionssearch.ofac.treas.gov/) or commercial API ([ComplyCube](https://www.complycube.com/), [Sanctions.io](https://www.sanctions.io/)).

Cost: $0 at launch (MoR coverage) → $100-500/mo at scale (dedicated tool).

---

## Liability Flow-Down (ToS clauses)

### Founder representations (in ToS)

By signing up, founder represents and warrants:

1. **Not sanctioned**: founder is not on any sanctions list, and not located in a sanctioned jurisdiction
2. **Legal compliance**: founder's product complies with all applicable laws in jurisdictions where it's offered
3. **Licenses**: if product is in a regulated category, founder holds all required licenses
4. **No AUP violations**: founder's product does not fall within the prohibited categories above
5. **Payment provider AUPs**: founder agrees to comply with AUPs of all payment providers they connect

### Indemnification

> Founder agrees to indemnify, defend, and hold harmless Baljia AI Private Limited, its officers, directors, employees, and agents from and against any and all claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to:
>
> (a) Founder's product or any content, products, or services sold through it;
> (b) Founder's breach of this AUP or the Terms of Service;
> (c) Any claim that Founder's product infringes intellectual property, privacy, or publicity rights of a third party;
> (d) Any chargeback, dispute, fraud, or regulatory action arising from Founder's product;
> (e) Any breach of payment provider AUPs caused by Founder's activities.

### Right to refuse / terminate

> Baljia reserves the right to refuse service, terminate accounts, and remove or edit content at our sole discretion, with or without cause, including but not limited to:
>
> (a) Products falling within the prohibited categories in this AUP;
> (b) Activities causing or likely to cause payment provider freeze, termination, or restriction of Baljia's account;
> (c) Founders providing false information at signup or in product descriptions;
> (d) Products involved in regulatory investigation or legal action;
> (e) Products exceeding Baljia's internal risk thresholds (chargeback rate, fraud velocity, complaint volume).

---

## Payment Provider AUP Intersection (why this list exists)

For reference — this AUP is derived from the narrowest intersection of upstream provider AUPs:

### Dodo Payments

From [dodopayments.com — Merchant Acceptance Policy](https://docs.dodopayments.com/miscellaneous/merchant-acceptance):

> "Manual Digital Services — Selling non-automated services via digital platforms... custom design, development, coaching, freelancing or consulting services via digital platforms isn't allowed... if the majority of the value sits in the human labour rather than digital systems, it will not be accepted."

Also excludes: AI Content Generation with impersonation/scraping/deepfakes, all the standard restricted categories.

### Paddle

From [paddle.com — What am I not allowed to sell on Paddle?](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle):

Prohibits: payment services (including "as a Payment Facilitator, Payment Services Provider, Money Transmitter, or Merchant of Record"), illegal, regulated without license, adult content, gambling, pyramid schemes, etc.

### Razorpay

Similar scope: illegal products, regulated without license, gambling (unless licensed), adult content (certain categories), financial services without license, etc.

### Stripe

[Stripe Restricted Businesses list](https://stripe.com/restricted-businesses) — comprehensive list.

---

## Enforcement Approach

### Proactive (before problems)

1. **AUP check at onboarding** — `content-moderation.service.ts` runs before first `refine_idea`
2. **Clear founder education** — AUP linked from onboarding, ToS, dashboard
3. **Engineering agent refusal** — system prompt instructs agent to refuse prohibited categories
4. **Payment provider registration** — when founder connects Razorpay/Stripe, their AUP applies downstream

### Reactive (when problems surface)

1. **Chargeback / complaint triggers review** — if a founder's product generates disputes, flag for AUP review
2. **Customer support ticket escalation** — customer complaints about a Baljia-built product route to AUP review
3. **External report response** — DMCA takedowns, regulator inquiries, law enforcement requests
4. **Scheduled audits** — quarterly manual review of random sample of active founder products

### Consequences of violation

| Violation severity | Response |
|---|---|
| Ambiguous / first-time | Warning + 7-day remediation window |
| Clear AUP violation | Immediate product takedown + account freeze + refund of current billing cycle |
| Fraud / illegal activity | Immediate termination + forfeit any credits + legal escalation if needed |
| Repeat offender (same founder, different company) | Perpetual ban; email + IP + KYC info added to blocklist |

---

## Regulated Category Exception Process

Some categories are prohibited DEFAULT but can be approved with proper licensing documentation. Example: regulated fintech / pharma / health-claims.

### Exception workflow

1. Founder contacts `compliance@baljia.ai` with:
   - Category their product falls into
   - License documentation (e.g., RBI PA license, FDA approval, state licensure)
   - Operating jurisdictions
   - Target customer base
2. Baljia legal review within 7 business days
3. If approved:
   - License docs retained for 7 years
   - Founder account tagged `aup_exception_granted`
   - Specific category permitted for that founder only
   - Quarterly review of continuing compliance
4. If denied:
   - Explanation to founder
   - Refund of any paid fees
   - Referral to other platforms if appropriate

---

## Related Documents

- [baljiapayment.md](./baljiapayment.md) — payment architecture decisions
- [payment-compliance-india.md](./payment-compliance-india.md) — Indian regulatory stack
- [payment-operations-runbook.md](./payment-operations-runbook.md) — enforcement ops
- [refund-policy.md](./refund-policy.md) — customer-facing refund policy

---

*Published at: baljia.ai/founder-aup (v1 draft)*
*Referenced from: Terms of Service clause [X]; Onboarding AUP-check modal*
*Owner: Legal / Compliance*
*Review cadence: Quarterly, or when any upstream provider AUP changes*
*Last updated: April 2026*
