# Spec: Billing, Credits, and Subscription State

- `Spec ID`: `SPEC-BILL-001`
- `Status`: rebuilt
- `Subsystem`: billing, credits, and subscription state
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent build spec`: [specs/build/billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/billing-credits-and-subscription-state.md)

## Purpose

Define the canonical billing and company-state authority model that sits behind founder-visible pricing, trial unlock, credit gating, hosting continuity, keep-live, and suspension behavior.

This umbrella spec owns:

- the founder-visible billing story
- the hidden-system economic and entitlement split behind that story
- the company-state authority map for billing-related behavior
- the cross-child invariants that must remain true across trial, charging, continuity, purchase surfaces, and internal ledgers

This umbrella spec does **not** own the deepest flow details of the billing children. Those stay with the children.

## Domain Decomposition Map

This umbrella governs:

- [specs/internal/billing/trial-and-execution-unlock.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/trial-and-execution-unlock.md)
  - owns pre-trial value, trial package, and execution unlock semantics
- [specs/internal/billing/purchase-surfaces-and-expansion.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/purchase-surfaces-and-expansion.md)
  - owns hosted checkout, upgrade/add-company modal family, and purchase-entry surfaces
- [specs/internal/billing/credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)
  - owns visible credits language, charge-on-start behavior, and no-charge-before-start rules
- [specs/internal/billing/subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/subscription-continuity-and-hosting-state.md)
  - owns continuity states, keep-live, grace, suspension, and reactivation posture
- [specs/internal/billing/internal-ledgers-and-unit-economics.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/internal-ledgers-and-unit-economics.md)
  - owns hidden ledgers, actual-cost truth, and economic forecasting inputs

## Founder-Visible Contract

The founder should experience billing like this:

- visible company value exists before trial starts
- the `3-day` trial is the execution unlock, not the moment the company first appears
- founders see one visible `Credits` counter
- founder-visible manual work follows `1 task = 1 credit`
- chat, planning, task shaping, and queue management are free
- execution charging happens when work actually starts, not when a task is drafted or merely visible in queue
- active subscription with `0` manual credits does **not** mean the company is dead
- hosting and planning can stay live while manual and recurring execution remain credit-gated
- night shifts remain part of the subscription operating story, not a second visible founder credit pool
- all companies under one founder share a single manual credit pool — credits are not allocated per company
- all companies under one founder share a single night-shift pool — night shifts are distributed across eligible companies by the scheduler, not pre-allocated
- when a founder has multiple companies, the scheduler cycles night shifts fairly across eligible companies rather than giving all shifts to one company
- the visible credits counter on the dashboard reflects the founder-level pool, not a per-company allocation
- keep-live is a distinct hosting-first posture, not a vague synonym for full operations
- suspended companies remain recoverable rather than silently deleted

The founder should **not** need to understand:

- internal source buckets for credits
- actual-cost accounting components
- ledger internals
- payout or fee accounting internals
- entitlement field names

## Hidden-System Contract

The hidden system must keep these concerns separate even if the founder sees a simpler story:

- `billing_lane`
  - economic lane that funds or accounts for work
  - examples: task-credit work, subscription operating capacity, ads spend
- trial lifecycle
- execution entitlement
- subscription continuity posture
- hosting continuity posture
- manual-credit availability
- ads billing readiness
- internal actual-cost accounting

The hidden system must not flatten those into one blurry “company status” concept.

## In Scope

- founder-visible billing story
- billing-related company-state authority
- cross-child billing invariants
- trial, credits, continuity, and hosting split at umbrella level
- founder-visible versus hidden-system economic split
- shared seam names between billing and control-plane/runtime specs

## Out of Scope

- exact checkout implementation
- child-level charging flow details
- child-level continuity matrices
- child-level ledger schema
- provider-specific API details
- build-spec implementation details

## Canonical Nouns

### `billing_lane`

- **Meaning:** economic lane that funds or accounts for work
- **Canonical owner:** this umbrella spec
- **Examples:** `task_credit` (manual/recurring tasks charged per credit), `subscription_autopilot` (night shifts and platform-initiated work funded by subscription entitlement, not manual credits), `ads_spend` (fully independent ads billing — founder deposits, platform takes 20%, rest goes to ad spend)
- **Not to be confused with:** `worker_lane`, `run_channel`, or entitlement booleans

### `Credits`

- **Meaning:** the single founder-visible manual execution counter
- **Canonical owner:** [credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)
- **Not to be confused with:** internal cost components, night-shift capacity, or runtime AI/search budgets

### `trial_state`

- **Meaning:** trial lifecycle only
- **Canonical owner:** [trial-and-execution-unlock.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/trial-and-execution-unlock.md)
- **Not to be confused with:** subscription continuity or hosting continuity

### `execution_unlocked`

- **Meaning:** whether execution may begin for the current company posture
- **Canonical owner:** [trial-and-execution-unlock.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/trial-and-execution-unlock.md)
- **Not to be confused with:** public runtime being online or manual credits being available

### `subscription_status`

- **Meaning:** paid continuity posture for the company
- **Canonical owner:** [subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/subscription-continuity-and-hosting-state.md)
- **Not to be confused with:** trial lifecycle or manual-credit count

### `hosting_state`

- **Meaning:** public-runtime continuity posture
- **Canonical owner:** [subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/subscription-continuity-and-hosting-state.md)
- **Not to be confused with:** founder-private planning access or execution entitlement

### `manual_credits_remaining`

- **Meaning:** the manual-credit availability that gates manual and recurring charge-governed execution
- **Canonical owner:** [credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)
- **Not to be confused with:** night-shift eligibility or ads billing readiness

### `night_shift_eligible`

- **Meaning:** whether the subscription posture allows night-shift execution
- **Canonical owner:** [subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/subscription-continuity-and-hosting-state.md)
- **Not to be confused with:** a lane field; stale wording like `night_shift_lane_enabled` should be removed over time

## State Authority Map

| State / field | Canonical or derived | Owner | Used by | Must not be used by |
|---|---|---|---|---|
| `trial_state` | Canonical | `trial-and-execution-unlock.md` | onboarding, dashboard, purchase surfaces | runtime task state as a substitute for trial posture |
| `execution_unlocked` | Canonical | `trial-and-execution-unlock.md` | control plane admission, dashboard gating | hosting continuity as a substitute for execution entitlement |
| `subscription_status` | Canonical | `subscription-continuity-and-hosting-state.md` | continuity, night-shift eligibility, recovery posture | manual-credit charging rules as a substitute for subscription posture |
| `hosting_state` | Canonical | `subscription-continuity-and-hosting-state.md` | public runtime continuity, live/public projections | planning access or task runtime status as a substitute |
| `manual_credits_remaining` | Canonical | `credits-and-task-charging.md` | manual and recurring charge gates | night-shift eligibility or ads readiness |
| `night_shift_eligible` | Canonical entitlement | `subscription-continuity-and-hosting-state.md` | scheduler and continuity surfaces | modeled as a lane field |
| `billing_lane` | Canonical | this umbrella | control plane admission, accounting, ads separation | `worker_lane` or `run_channel` substitution |
| visible `Credits` counter | Derived founder projection | `credits-and-task-charging.md` | dashboard and CEO founder-safe explanation | hidden internal source-bucket truth |
| `actual_internal_cost` and cost components | Canonical hidden truth | `internal-ledgers-and-unit-economics.md` | internal economics and forecasting | founder-visible pricing copy |

## Cross-Packet Invariants

These invariants must stay true across all billing children and all consuming control-plane/dashboard specs.

- Trial is card-required and acts as the execution unlock rather than first creating company existence.
- The preserved founder-visible starter package remains:
  - `3-day` free trial
  - `10` welcome bonus task credits
  - `3` night shifts
- If unused welcome credits remain at conversion, they carry forward into paid continuation.
- Paid continuation renews the operating bundle as `30` night shifts per month plus `5` monthly task credits, and the `3` trial night shifts do not stack on top of that monthly paid pool.
- Founder-visible manual work keeps one visible credits counter and the rule `1 task = 1 credit`.
- The CEO may use `up to about 4 hours` only as a scoping heuristic, never as the hidden billing formula.
- Purchase surfaces remain intentionally split:
  - `Start free trial` -> hosted checkout
  - unsubscribed `+ New`, `Menu -> New Company`, and `Upgrade` -> centered in-dashboard modal family
  - modal CTA -> same hosted card-capture checkout
- Queue presence is free. Manual charging happens on execution start.
- Active subscription with `0` manual credits keeps hosting, planning, and night-shift eligibility alive while manual and recurring execution remain credit-gated.
- `keep_live_active` keeps the public hosted surface and limited management/recovery continuity alive, keeps CEO chat and planning available, blocks manual and recurring execution, and keeps night shifts off.
- Ads are a fully independent `billing_lane` — founder deposits money for ads, platform takes `20%` as fee, remaining `80%` goes to actual ad spend. Ads continue operating regardless of subscription state as long as ads balance has funds.
- Public runtime can go offline before the recoverable retained company record disappears.
- Internal unit economics uses post-task actual-cost accounting and forecasting rather than a fixed-hours credit formula.

## Founder-Visible Rule vs Hidden-System Rule

### Founder-visible rule

- one visible credits counter
- `1 task = 1 credit`
- planning is free
- trial unlocks execution
- keep-live keeps the company online
- night shifts are included operating capacity, not a visible second credit bucket

### Hidden-system rule

- multiple `billing_lane` values exist underneath the founder story
- trial, execution entitlement, subscription continuity, hosting continuity, and manual-credit availability are distinct state axes
- actual-cost accounting is hidden and does not redefine founder pricing copy
- ads are a fully independent billing lane — operate regardless of subscription state, funded by founder ad deposits with `20%` platform fee

### Why both layers must exist

If the system collapses these layers into one blurred status model, readers will incorrectly gate:

- manual execution
- recurring execution
- night shifts
- public runtime continuity
- keep-live continuity
- ads readiness

from different fields in different specs.

## Company-State Story

1. A founder can see value before trial starts.
2. Trial flips execution from non-runnable to runnable.
3. Manual credits govern manual and recurring execution starts.
4. Subscription continuity governs whether the company stays in an active operating posture.
5. Hosting continuity governs whether the public runtime stays live.
6. Keep-live preserves hosted continuity without implying full operations.
7. Trial expiry or billing loss can take public runtime offline first while founder-private continuity briefly remains.
8. Suspension is recoverable rather than silent deletion.

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “You have credits.” | visible credits counter reflects founder-manual execution budget | founder sees `Needs Credits` at execution start | Guaranteed as founder billing projection |
| “Start free trial.” | card capture required and company is trial-eligible | founder stays in planning-only posture | Guaranteed purchase entry, not guaranteed payment success |
| “Your company stays live.” | subscription or keep-live continuity and valid hosting posture | public runtime may go offline while internal recovery posture remains | Best-effort continuity bounded by hosting state |
| “Night shift keeps working.” | subscription posture keeps `night_shift_eligible` true | night shift stays off in keep-live, grace, or suspension states | Best-effort execution with real eligibility rule |
| “You can reactivate later.” | company retained in recoverable posture | founder must choose keep-live or full plan to restore activity | Guaranteed recoverability story, not guaranteed free continuity |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| pre-trial company | trial active | successful card-required activation | `trial-and-execution-unlock.md` | company exists and activation succeeds | `execution_unlocked` turns on; welcome credits and trial night shifts granted | same company record continues forward |
| trial active | paid continuation | founder converts | `trial-and-execution-unlock.md` + `purchase-surfaces-and-expansion.md` | successful paid continuation purchase | monthly paid posture begins; unused welcome credits may carry forward | no company recreation |
| full active | active with `0` manual credits | manual credits depleted | `credits-and-task-charging.md` + `subscription-continuity-and-hosting-state.md` | subscription remains active | manual and recurring execution gated; hosting/planning/night-shift eligibility remain | refilling credits restores manual/recurring execution |
| full active or trial grace path | `keep_live_active` | founder chooses keep-live | `subscription-continuity-and-hosting-state.md` | company eligible for keep-live | hosted continuity remains; manual/recurring/night-shift execution off | upgrade back to full plan restores deeper operations |
| trial active or paid posture | trial-expired grace or billing-loss grace | non-continuation / billing failure | `subscription-continuity-and-hosting-state.md` | continuity lost | public runtime may go offline first; founder-private planning may remain briefly | recovery via keep-live or full plan |
| grace | suspended but recoverable | grace window ends | `subscription-continuity-and-hosting-state.md` | no recovery purchase yet | public runtime remains offline; company retained | reactivation through keep-live or full plan |

## Implementation Trap Notes

### Trap 1: using one blurry “company status” for everything

- **Wrong assumption:** one status field can gate trial, execution, hosting, credits, and suspension.
- **Why it is wrong:** different product promises depend on different underlying truths.
- **Correct interpretation:** keep `trial_state`, `execution_unlocked`, `subscription_status`, `hosting_state`, `manual_credits_remaining`, and `night_shift_eligible` distinct.

### Trap 2: treating night shift as a manual-credit concept

- **Wrong assumption:** if credits are `0`, all execution must stop.
- **Why it is wrong:** the preserved contract keeps night shifts in the subscription operating story.
- **Correct interpretation:** manual and recurring work are charge-gated; night shifts are controlled by subscription continuity entitlement.

### Trap 3: using lane wording for entitlement flags

- **Wrong assumption:** names like `night_shift_lane_enabled` are harmless.
- **Why it is wrong:** they confuse economic lanes, runtime channels, and entitlement posture.
- **Correct interpretation:** use entitlement/state language like `night_shift_eligible` instead.

### Trap 4: treating keep-live as full-active with fewer credits

- **Wrong assumption:** keep-live is just a smaller version of the full operating plan.
- **Why it is wrong:** keep-live is a hosting-first continuity posture with execution mostly off.
- **Correct interpretation:** keep-live preserves hosting and strategic continuity, not full operating execution.

## Shared State Seams

- `trial_state`
  - owned by trial and execution unlock
- `execution_unlocked`
  - owned by trial and execution unlock
- `purchase_entry_type` and purchase modal payload
  - owned by purchase surfaces and expansion
- `visible_task_credits_remaining` and execution-start charge gate
  - owned by credits and task charging
- `subscription_status`, `manual_credits_remaining`, `hosting_state`, `night_shift_eligible`, and `reactivatable`
  - owned by subscription continuity and hosting state, except manual credits which are owned by credits and task charging
- `actual_internal_cost`, componentized task-cost fields, and billing ledgers
  - owned by internal ledgers and unit economics

## Ownership Boundaries

- [trial-and-execution-unlock.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/trial-and-execution-unlock.md)
  - owns pre-trial value, trial package, and execution unlock
- [purchase-surfaces-and-expansion.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/purchase-surfaces-and-expansion.md)
  - owns hosted checkout versus in-dashboard modal routing and purchase-entry surfaces
- [credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)
  - owns visible credits semantics, charge-on-start behavior, and manual-credit gating
- [subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/subscription-continuity-and-hosting-state.md)
  - owns continuity, keep-live, grace, suspension, and reactivation posture
- [internal-ledgers-and-unit-economics.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/internal-ledgers-and-unit-economics.md)
  - owns ledgers, actual-cost truth, fee-policy conflict resolution, and forecasting inputs

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- control-plane umbrella consumes `billing_lane` from this umbrella and must not infer billing semantics from `worker_lane` or `run_channel`
- runtime and scheduler depend on billing charge gates and continuity entitlements but do not own those fields
- dashboard and CEO founder-safe explanations project these billing states without redefining them
- live/public projections must respect `hosting_state` rather than recent event history alone

### Reconciliation notes

- this rebuilt umbrella explicitly owns the billing/company-state authority split that was previously blurry
- stale entitlement wording like `night_shift_lane_enabled` has now been replaced across the continuity child with `night_shift_eligible`
- trial unlock, charging, purchase routing, continuity, and unit-economics children now read as one coherent ladder:
  - pre-trial value exists before execution unlock
  - trial flips `execution_unlocked`
  - charge-on-start governs visible credits
  - subscription/hosting continuity governs what stays live after credits reach zero or trial ends
  - hidden ledgers keep economic truth separate from founder-visible pricing

### Final family reconciliation note

At this point the billing family is internally stabilized at the umbrella level:

- `trial_state` = trial lifecycle only
- `execution_unlocked` = whether execution may begin in principle
- `manual_credits_remaining` = manual/recurring charge gate
- `subscription_status` = paid continuity posture
- `hosting_state` = public-runtime continuity posture
- `night_shift_eligible` = continuity entitlement, not a lane field
- `billing_lane` remains separate from both worker identity and execution origin

Any later changes to those shared seams should update this umbrella first and then cascade to the billing children.
## Parent Acceptance Criteria

- the billing umbrella now exposes a clear company-state authority map
- no founder-facing surface implies raw token, infra-minute, or hidden-hours metering
- no child spec needs to invent its own meaning of trial, subscription, hosting, credits, or night-shift continuity
- control-plane, dashboard, live/public, onboarding, and billing specs can point at the same named billing seams
- stale lane wording is not used as canonical billing authority in this umbrella

## Plain-Language New-Reader Tests

- Which field controls whether execution may begin: `trial_state` or `execution_unlocked`?
- Which field controls whether the public company site stays online: `hosting_state` or `manual_credits_remaining`?
- Which field controls whether manual and recurring execution can start: `manual_credits_remaining` or `subscription_status`?
- Is night shift governed by manual credits or subscription continuity entitlement?
- Is keep-live a smaller active plan or a distinct hosting-first posture?

If the answers are not direct from this file, the umbrella is still ambiguous.

## Implementation Freedom

- exact billing provider APIs and checkout session wiring
- exact internal ledger schema
- exact localized currency set
- exact dunning flow
- exact internal entitlement field names beyond the canonical seam meaning

## Traceability

### Source topics

- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [knowledge/topics/payments-revenue-and-company-identity.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/payments-revenue-and-company-identity.md)
- [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)

### Source facts

- `FACT-MON-001`
- `FACT-MON-002`
- `FACT-MON-003`
- `FACT-MON-004`
- `FACT-MON-005`
- `FACT-MON-006`
- `FACT-MON-008`
- `FACT-MON-009`
- `FACT-MON-010`
- `FACT-MON-011`
- `FACT-MON-011A`
- `FACT-MON-012`
- `FACT-MON-013`
- `FACT-MON-014`
- `FACT-MON-015`
- `FACT-MON-016`
- `FACT-EXEC-006`
- `FACT-EXEC-012`
- `FACT-EXEC-026`

### Source decisions

- `DEC-BILL-001`
- `DEC-TRIAL-001`
- `DEC-TRIAL-002`
- `DEC-TRIAL-003`
- `DEC-CRED-001`
- `DEC-CRED-002`
- `DEC-CRED-003`
- `DEC-HOST-001`
- `DEC-HOST-002`
- `DEC-HOST-003`
- `DEC-NIGHT-001`
- `DEC-NIGHT-003`
- `DEC-PAY-001`
- `DEC-PAY-002`
- `DEC-PAY-003`
- `DEC-CEO-003`
- `DEC-EXEC-004`

### Primary evidence

- [Polsia_Exact_Architecture_Details.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/Polsia_Exact_Architecture_Details.md)
- [Polsia_Topic_Book.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/Polsia_Topic_Book.md)

### Claim-to-anchor audit

- trial is the execution unlock rather than company creation:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-001`
    - `FACT-MON-002`
  - decisions:
    - `DEC-TRIAL-001`

- one visible credits counter and `1 task = 1 credit` remain the founder-facing rule while internal cost truth stays separate:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-004`
    - `FACT-MON-005`
    - `FACT-MON-016`
    - `FACT-EXEC-026`
  - decisions:
    - `DEC-CRED-001`
    - `DEC-CRED-002`
    - `DEC-CEO-003`
    - `DEC-EXEC-004`

- billing and company-state authority must be split cleanly across trial, execution entitlement, subscription continuity, hosting continuity, manual-credit gating, and night-shift eligibility:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-011A`
  - decisions:
    - `DEC-BILL-001`

- active subscription with `0` manual credits keeps night shifts alive while recurring and manual execution remain credit-gated:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-010`
    - `FACT-MON-011`
    - `FACT-EXEC-012`
  - decisions:
    - `DEC-CRED-003`
    - `DEC-NIGHT-001`
    - `DEC-NIGHT-003`

- keep-live and suspension are distinct hosting/continuity postures rather than vague credit states:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-006`
    - `FACT-MON-008`
    - `FACT-MON-009`
  - decisions:
    - `DEC-HOST-001`
    - `DEC-HOST-002`
    - `DEC-HOST-003`

- ads are a separate `billing_lane` rather than part of the manual task-credit pool:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-015`
  - decisions:
    - `DEC-PAY-003`

## Change Log

- `2026-04-08`: expanded the seed billing packet into a full internal umbrella
- `2026-04-12`: rebuilt the billing umbrella to lock billing/company-state authority, separate founder-visible pricing from hidden economic lanes, remove stale entitlement-as-lane wording, and align billing seams with control-plane/runtime umbrellas
