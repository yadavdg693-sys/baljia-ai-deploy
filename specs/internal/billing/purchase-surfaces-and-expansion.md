# Spec: Purchase Surfaces and Expansion

- `Spec ID`: `SPEC-BILL-102`
- `Status`: rebuilt
- `Subsystem`: billing purchase surfaces and expansion
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent spec`: [specs/internal/billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- `Parent build spec`: [specs/build/billing/purchase-surfaces-and-expansion.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/billing/purchase-surfaces-and-expansion.md)

## Purpose

Define which purchase actions use hosted checkout versus in-dashboard modal surfaces so expansion behavior stays consistent across founder entry points.

This child spec owns:

- purchase-entry posture resolution
- hosted checkout versus in-dashboard modal split
- visible purchase-family contents
- shell continuity during purchase inspection and checkout handoff

## Founder-Visible Contract

The founder should experience purchase surfaces like this:

- dashboard `Start free trial` opens hosted Stripe checkout rather than a tiny inline card form
- `+ New` and `Menu -> New Company` open the same in-dashboard modal family rather than routing away from the founder shell
- unsubscribed `Upgrade` opens that same in-dashboard modal family
- inline subscribe or upgrade gating from founder task surfaces enters the same purchase family rather than inventing a separate pricing page
- the centered dashboard modal is the founder’s plan/pricing reading surface
- the primary CTA from that modal launches the same hosted card-capture checkout used by dashboard `Start free trial`
- successful checkout returns the founder to the same founder shell and company context
- `Task Credits` stays lightweight and informational rather than becoming a separate rich purchase funnel

## Hidden-System Contract

Purchase entry points are intentionally split by founder intent:

- first execution unlock uses hosted checkout directly from the main trial CTA
- dashboard-owned expansion and upgrade entries use a centered modal inside the founder shell before any checkout handoff
- the modal family can render different postures while remaining one purchase family:
  - trial / upgrade posture for unsubscribed founders
  - add-company expansion posture for subscribed founders
  - inline gated-upgrade posture for task-detail or zero-credit entry points
- surface selection must resolve from founder posture and origin surface, not from whichever component happened to render the CTA

## In Scope

- hosted `Start free trial` entry
- `+ New`
- `Menu -> New Company`
- `Upgrade`
- inline subscribe/upgrade gating from founder task-detail surfaces
- `Task Credits` informational contract
- purchase-entry posture resolution
- visible purchase-surface contents and CTA copy family

## Out of Scope

- trial lifecycle after checkout success
- credit decrement timing
- keep-live and suspension lifecycle
- hidden payment ledgers

## Canonical Noun Imports

### `purchase_entry_type`

- **Meaning:** the founder’s entry into the purchase family
- **Owned here**

### `purchase_surface_variant`

- **Meaning:** which founder-visible purchase surface opens for this posture
- **Owned here**

### `trial_state`, `execution_unlocked`

- **Imported meanings only**
- **Owned elsewhere:** trial unlock child
- **Used here for:** routing to the correct purchase posture, not lifecycle truth

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| `purchase_entry_type` | Canonical | this spec | route founder into correct purchase family | confused with lifecycle state |
| `purchase_surface_variant` | Canonical | this spec | decide hosted checkout vs modal | used as payment-success truth |
| founder subscription posture | Canonical elsewhere | billing umbrella / continuity child | determine unsubscribed vs subscribed purchase posture | redefined here |
| `trial_state` / `execution_unlocked` | Canonical elsewhere | trial unlock child | decide whether trial activation is the goal | redefined here |
| founder shell continuity | Canonical UX contract | this spec + dashboard | preserve same route/context around purchase surfaces | replaced with detached pricing route |

## Surface Routing Rules

### Main trial CTA path

1. founder clicks dashboard `Start free trial`
2. system launches hosted checkout directly
3. hosted checkout shows trial framing, localized currency, founder email prefill, card-entry form, and `Start trial`
4. successful checkout returns the founder to the same founder shell and hands activation back to the trial-boundary flow owned elsewhere

### Dashboard expansion path

1. founder clicks `+ New` or `Menu -> New Company`
2. dashboard remains mounted
3. system resolves founder posture:
   - unsubscribed -> trial/upgrade posture
   - subscribed -> add-company expansion posture
4. system opens centered in-dashboard pricing/expansion modal
5. founder reads plan/pricing details there
6. founder clicks the modal CTA such as `Start 3-Day Free Trial`
7. system launches the same hosted card-capture checkout used by dashboard `Start free trial`
8. successful checkout returns the founder to the same founder shell without replacing the dashboard with a detached pricing route

### Upgrade and inline gating path

1. founder clicks `Upgrade` or hits inline upgrade/subscribe gating inside founder task surfaces
2. system resolves the correct centered purchase-family posture
3. founder stays in the same founder shell while inspecting upgrade options
4. founder uses the modal CTA to launch the same hosted card-capture checkout used by dashboard `Start free trial`
5. successful checkout returns the founder to the same founder shell instead of a disconnected pricing route

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “Start free trial.” | founder is trial-eligible and checkout can launch | founder stays in current shell with failure or retry path | Guaranteed routed purchase entry, not guaranteed payment success |
| “New Company / Upgrade opens here.” | founder is inside dashboard shell | modal opens instead of route replacement | Guaranteed shell continuity for modal inspection |
| “This purchase flow keeps my context.” | company and founder shell context preserved across checkout handoff | founder returns to same shell after success/failure | Guaranteed shell continuity contract |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| founder in dashboard shell | hosted checkout | main trial CTA clicked | this spec | founder is on direct trial-start path | hosted checkout launched | returns to same shell after outcome |
| founder in dashboard shell | centered purchase modal | `+ New`, `Menu -> New Company`, `Upgrade`, or inline gated upgrade clicked | this spec | founder posture resolved | modal family opens inside shell | founder may dismiss or proceed to hosted checkout |
| centered purchase modal | hosted checkout | modal CTA clicked | this spec | founder chooses to proceed | same hosted card-capture checkout launched | returns to same shell after outcome |

## Visible Purchase Family Contents

### Hosted checkout must visibly include

- `3 days free`
- post-trial monthly price
- localized currency toggle such as `INR` / `USD`
- prefilled founder email
- card-entry form
- `Start trial`

### In-dashboard modal family must visibly include

- `3-Day Free Trial`
- paid continuation framing such as `then $49/month`
- included company / night-shift / task-credit counts
- extra-company controls when relevant
- extra-task-credit controls when relevant
- primary CTA such as `Start 3-Day Free Trial`
- cancellation reassurance such as `Cancel anytime. No commitments.`

## Ownership and Handoffs

- founder dashboard owns header buttons, menu state, and overlay mount points
- this spec owns which purchase surface opens for each founder entry and what the purchase family must contain
- trial unlock child owns what becomes true after successful trial activation
- credits child owns the charging rule itself; this child only owns where gating sends the founder for purchase handling

## Data and Interface Contract

### Surface selector

- `purchase_entry_type`: `trial_checkout | add_company_modal | upgrade_modal | inline_info`
- `purchase_surface_variant`: `trial_checkout | trial_or_upgrade_modal | add_company_expansion_modal | inline_gated_upgrade_modal`
- `origin_surface`
- `origin_action`
- `company_context`
- `company_slug`
- `founder_email_prefill`
- `founder_subscription_posture`
- `stay_in_shell`: boolean

### Modal payload

- `title_copy`
- `subtitle_copy`
- `primary_cta_copy`
- `plan_summary_items`
- `included_company_count`
- `included_night_shift_count`
- `included_task_credit_count`
- `included_first_month_bonus_task_credit_count`
- `post_trial_price_copy`
- `extra_company_stepper`
- `extra_task_credit_stepper`
- `currency_display`
- `cancellation_reassurance_copy`

### Handoff contract

- hosted checkout launch must receive localized currency and founder email prefill
- dashboard modal launch must preserve current founder route and company context
- inline gated upgrade entry may include task context, but it must still resolve into the shared purchase family
- centered modal CTA for unsubscribed founders must hand off into the same hosted checkout implementation used by dashboard `Start free trial`
- success or dismissal must return the founder to the same dashboard shell continuity unless a later owning spec explicitly changes route

## Implementation Trap Notes

### Trap 1: inventing separate pricing flows by component

- **Wrong assumption:** each CTA can choose its own purchase UX.
- **Why it is wrong:** that creates drift between dashboard, inline upgrade, and expansion behavior.
- **Correct interpretation:** one purchase family with posture-based routing.

### Trap 2: sending dashboard expansion to a detached pricing route

- **Wrong assumption:** a full route change is fine because it still reaches checkout.
- **Why it is wrong:** the preserved founder experience keeps the shell mounted while reading plan details.
- **Correct interpretation:** dashboard entries use centered modal first, then hosted checkout.

### Trap 3: turning `Task Credits` into a full purchase funnel

- **Wrong assumption:** if credits matter, the `Task Credits` menu item should become its own rich checkout path.
- **Why it is wrong:** observed product keeps it lightweight and informational.
- **Correct interpretation:** keep `Task Credits` lightweight unless a later decision changes that.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- trial unlock child owns what activation changes in lifecycle terms
- dashboard owns where buttons and modals appear
- billing umbrella owns state authority and overall purchase-lane context
- credits child owns charge timing, not purchase-surface routing

### Reconciliation notes

- this rebuilt child preserves the hosted-checkout versus in-dashboard-modal split
- this rebuilt child keeps founder shell continuity explicit
- purchase routing now aligns with the billing umbrella and trial child; sibling cleanup completed

## Acceptance Criteria

- `Start free trial` always goes to hosted checkout
- hosted checkout always includes card capture for trial start
- hosted checkout visibly includes trial framing, currency toggle, founder email prefill, and `Start trial`
- `+ New` and `Menu -> New Company` always open the same centered modal family
- unsubscribed `Upgrade` reuses the same modal family instead of inventing a separate purchase flow
- inline gated upgrade handling from task surfaces reuses the same purchase family
- the primary CTA from the centered modal always launches the same hosted card-capture checkout used by dashboard `Start free trial`
- successful checkout always returns the founder to the same founder shell continuity
- dashboard-owned purchase entries do not route away to a separate founder pricing page before purchase handoff
- `Task Credits` never becomes a conflicting heavyweight checkout surface

## Plain-Language New-Reader Tests

- Which founder action opens hosted checkout directly?
- Which founder actions open the in-dashboard modal first?
- Does a founder lose dashboard context when inspecting plan details?
- Is `Task Credits` a full purchase flow or just lightweight info?
- Does inline task gating invent a separate pricing flow or reuse the same purchase family?

If a new reader cannot answer these directly from this file, the purchase model is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [specs/internal/founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md)
- [specs/internal/billing/trial-and-execution-unlock.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/trial-and-execution-unlock.md)

### Source facts

- `FACT-MON-012`
- `FACT-MON-013`
- `FACT-MON-014`

### Source decisions

- `DEC-TRIAL-002`
- `DEC-TRIAL-003`
- `DEC-CRED-002`

### Claim-to-anchor audit

- dashboard `Start free trial` uses hosted checkout while dashboard expansion and upgrade entries use the centered modal family first:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-012`
    - `FACT-MON-013`
    - `FACT-MON-014`
  - decisions:
    - `DEC-TRIAL-002`

- founders see one simple credit story rather than a heavyweight task-credit purchase funnel:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - decisions:
    - `DEC-CRED-002`

## Change Log

- `2026-04-08`: seeded initial purchase surfaces and expansion spec
- `2026-04-12`: rebuilt the purchase family to align hosted checkout versus in-dashboard modal routing, keep founder shell continuity explicit, and prevent route-level pricing drift across founder entry points
