# Spec: Subscription Continuity and Hosting State

- `Spec ID`: `SPEC-BILL-104`
- `Status`: rebuilt
- `Subsystem`: billing subscription continuity and hosting state
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent spec`: [specs/internal/billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- `Parent build spec`: [specs/build/billing/subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/billing/subscription-continuity-and-hosting-state.md)

## Purpose

Define what stays live, what pauses, and what suspends across zero-credit, keep-live, trial-end, and recoverable hosting states.

This child spec owns:

- `subscription_status`
- `hosting_state`
- `night_shift_eligible`
- continuity matrix across public runtime, founder-private planning, queue visibility, manual execution, recurring execution, and reactivation

## Founder-Visible Contract

The founder should experience continuity like this:

- active subscription with `0` manual credits does not mean the company is dead
- hosting and dashboard continuity can remain live while manual task execution is paused
- with active subscription but `0` manual credits:
  - public site or app runtime stays live
  - founder dashboard stays live
  - CEO chat and planning stay live
  - documents and reports stay visible
  - queued tasks remain visible and manageable
  - night shifts continue as their own operating capacity
  - recurring tasks can queue but do not execute until credits return
  - manual tasks do not execute until credits return
- keep-live is a lighter hosting-first posture:
  - public hosted surface stays alive
  - the company remains recoverable and manageable through a limited management or recovery surface
  - CEO chat and planning remain available as a strategic surface
  - full operating behavior is off
  - manual execution is blocked
  - recurring execution is blocked
  - night shifts are off
  - ads operate independently — continue running as long as ads balance has funds, regardless of subscription state
- after trial ends without purchase:
  - public runtime can go offline first
  - founder chat, planning, and related internal surfaces can remain briefly accessible during grace
  - queued tasks remain visible but frozen
  - night shifts stop
- suspended companies remain recoverable rather than deleted
- public suspension messaging must be honest

## Hidden-System Contract

- hosting continuity, planning access, execution entitlement, and recoverability are separate state axes
- trial end is not the same thing as credits reaching zero
- public runtime state must be tracked separately from founder-private planning access
- keep-live is distinct from full active operations
- `night_shift_eligible` is an entitlement/state flag, not a lane field
- ads are a fully independent billing lane — they operate regardless of subscription state as long as the founder's ads balance has funds (founder deposits, platform takes 20%, rest goes to ad spend)
- projection layers must not present offline or suspended public runtime as if it were still normally active

## In Scope

- active subscription plus zero-credit behavior
- night-shift continuity
- recurring-task queue-hold behavior
- keep-live
- trial-end grace
- suspended but recoverable lifecycle
- honest public suspension messaging
- explicit surface matrix for public runtime versus founder-private continuity

## Out of Scope

- first trial activation
- purchase-surface design
- exact manual task charging implementation
- internal fee ledger accounting
- exact keep-live pricing copy or included allowances

## Canonical Noun Imports

### `subscription_status`

- **Imported family meaning:** paid continuity posture for the company
- **Owned here**

### `hosting_state`

- **Imported family meaning:** public-runtime continuity posture
- **Owned here**

### `night_shift_eligible`

- **Imported family meaning:** whether subscription posture allows night-shift execution
- **Owned here**
- **Must not be confused with:** stale wording like `night_shift_lane_enabled`

### `manual_credits_remaining`

- **Imported meaning only:** manual-credit availability for manual and recurring charge-gated execution
- **Owned elsewhere:** [credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)
- **Used here for:** continuity consequences only

## State Authority Section

| State / field | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| `subscription_status` | Canonical | this spec | continuity and recovery posture | confused with manual-credit count |
| `hosting_state` | Canonical | this spec | public-runtime continuity | confused with planning access or execution entitlement |
| `night_shift_eligible` | Canonical entitlement | this spec | scheduler and continuity behavior | modeled as lane field |
| `manual_credits_remaining` | Canonical elsewhere | credits child | decide whether manual/recurring charge-gated execution can start | used to gate keep-live or hosting continuity |
| `execution_unlocked` | Canonical elsewhere | trial unlock child | explain whether execution is allowed in principle | used as substitute for continuity state |
| public suspension copy | Derived | this spec + public surfaces | explain offline/suspended truth honestly | treated as hidden state authority |

## State Story

1. founder reaches active trial or full subscription operating state
2. public runtime, founder dashboard, planning, documents, queue, and execution are normally live
3. manual credits may later fall to zero while subscription remains active
4. public runtime and founder planning stay live
5. manual and recurring execution become charge-gated, but night shifts continue through subscription entitlement
6. founder may choose or be moved into keep-live, where hosted continuity is preserved without implying full active operations
7. if trial ends without purchase, public runtime can go offline first
8. founder planning remains briefly available during grace
9. queued tasks remain visible but frozen during grace
10. after grace, the company reaches a suspended but recoverable state
11. founder can reactivate through keep-live or full plan rather than being forced into a hard-delete story

## State Matrix

### `full_active`

- public site or app runtime: live
- founder dashboard: live
- CEO chat and planning: live
- documents and reports: live
- queued tasks: visible and executable
- recurring tasks: active and consume credits per run
- manual tasks: executable
- night shifts: active when entitlement allows
- reactivation posture: not needed

### `active_subscription_zero_credits`

- public site or app runtime: live
- founder dashboard: live
- CEO chat and planning: live
- documents and reports: live
- queued tasks: visible and manageable
- recurring tasks: can queue but do not execute
- manual tasks: do not execute
- night shifts: still active when entitlement allows
- reactivation posture: buy or refill credits without implying hosting loss

### `keep_live_active`

- public site or app runtime: live
- founder dashboard or management surface: available enough to manage continuity and reactivation
- CEO chat and planning: live as a strategic surface
- documents and reports: retained
- queued tasks: retained
- recurring tasks: blocked
- manual tasks: blocked
- night shifts: off
- ads: fully independent billing lane — ads continue operating regardless of subscription state as long as the ads balance has funds
- ads billing model: founder deposits money for ads, platform takes `20%` as platform fee, remaining `80%` goes to actual ad spend
- ads execution is NOT gated by subscription status, credits, or keep-live restrictions
- reactivation posture: move back to full plan later if deeper operations are needed

### `trial_expired_grace`

- **Grace window:** `3 days` before everything paused
- public site or app runtime: offline immediately at trial expiry
- founder dashboard: accessible during grace (up to 3 days)
- CEO chat and planning: accessible during grace (up to 3 days)
- documents and reports: accessible during grace
- queued tasks: visible but frozen
- recurring tasks: stopped
- manual tasks: stopped
- night shifts: stopped
- reactivation posture: founder can recover through keep-live or full plan
- paused messaging after day 3: "Your company is paused. Upgrade to $49/month to see your company running again."

### `suspended_billing`

- public runtime: offline
- rich per-company operating surface: no longer the normal active experience
- company record: retained by platform
- founder-facing status: suspended but recoverable
- reactivation posture:
  - keep-live
  - full plan
- delete posture: do not imply hard deletion happened automatically

## Grace Period Timing

### Trial-expired grace

- **Day 0 (trial expires):**
  - public site or app runtime goes offline immediately
  - founder dashboard remains accessible
  - CEO chat and planning remain accessible
  - queued tasks remain visible but frozen
  - night shifts stop
- **Day 3 (grace ends):**
  - everything pauses
  - founder sees: "Your company is paused. Upgrade to $49/month to see your company running again."
  - company record retained for reactivation

### Billing-loss grace (paid subscriber)

- **Day 0 (billing fails):**
  - public site or app runtime goes offline immediately
  - founder dashboard remains accessible
  - CEO chat and planning remain accessible
  - execution stops
- **Day 3 (grace ends):**
  - everything pauses
  - same upgrade messaging as trial-expired grace
  - company record retained for reactivation

### Suspension messaging

When a company reaches paused state, the founder sees:

- Dashboard banner: "Your company is paused. Upgrade to $49/month to see your company running again."
- Public site: honest offline message, not misleading blame language
- CEO chat: available with explanation of paused state and reactivation options

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “Your company stays live.” | subscription or keep-live continuity and valid hosting posture | public runtime may go offline while internal recovery posture remains | Best-effort continuity bounded by hosting state |
| “Night shift keeps working.” | subscription posture keeps `night_shift_eligible` true | night shift stays off in keep-live, grace, or suspension states | Best-effort execution with real eligibility rule |
| “You can reactivate later.” | company retained in recoverable posture | founder must choose keep-live or full plan to restore activity | Guaranteed recoverability story |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| `full_active` | `active_subscription_zero_credits` | manual credits depleted | this spec consuming credits child | subscription remains active | manual and recurring execution gated; hosting/planning/night-shift eligibility remain | refilling credits restores manual/recurring execution |
| `full_active` or grace path | `keep_live_active` | founder chooses keep-live | this spec | company eligible for keep-live | hosted continuity remains; manual/recurring/night-shift execution off | upgrade back to full plan restores deeper operations |
| trial or paid posture | `trial_expired_grace` | trial or billing continuity ends | this spec | continuity lost | public runtime may go offline first; founder-private planning may remain briefly | recovery via keep-live or full plan |
| `trial_expired_grace` | `suspended_billing` | grace window ends without recovery | this spec | no recovery purchase yet | public runtime remains offline; company retained | reactivation through keep-live or full plan |

## Night Shift Eligibility Toggle Rules

`night_shift_eligible` is derived from `continuity_state`:

| `continuity_state` | `night_shift_eligible` | Reason |
|---|---|---|
| `full_active` | `true` | subscription entitlement active |
| `active_subscription_zero_credits` | `true` | night shifts are subscription-governed, not credit-governed |
| `keep_live_active` | `false` | keep-live is hosting-only, no execution |
| `trial_expired_grace` | `false` | execution stopped at trial expiry |
| `suspended_billing` | `false` | everything paused |

During trial: `night_shift_eligible = true` while `trial_state = active` and `trial_night_shifts_remaining > 0`.

This is a derived field, not independently toggled. Any continuity state change automatically determines night-shift eligibility.

## Ownership and Handoffs

- trial unlock child owns what becomes true when execution is first unlocked
- credits child owns when a manual credit is consumed and what execution becomes charge-gated
- this child owns the continuity matrix that determines which surfaces stay live, freeze, or go offline
- purchase surfaces own reactivation or keep-live entry surfaces
- founder dashboard owns the visible founder projection of these states, banners, and recovery actions
- live wall and public projections must respect hosting state so public proof does not show an offline or suspended company as active
- control plane and scheduler must respect continuity state when deciding whether manual, recurring, or night-shift work is eligible to execute

## Data and Interface Contract

### Continuity state object

- `continuity_state`
- `subscription_status`
- `manual_credits_remaining`
- `night_shift_eligible`
- `recurring_execution_blocked`
- `planning_access_state`
- `public_runtime_state`
- `queued_task_state`
- `manual_execution_state`
- `recurring_execution_state`
- `night_shift_state`
- `hosting_state`: `live | keep_live | offline | suspended`
- `reactivatable`: boolean
- `reactivation_options`
- `public_suspension_message_variant`
- `ads_billing_ready`

### Gating rules

- manual task start requires visible credits
- night shift eligibility depends on subscription continuity entitlement, not manual credit availability
- public runtime visibility depends on hosting state, not solely on planning access
- recurring eligibility depends on both schedule and available manual credits
- ads operate independently — they run as long as ads balance has funds, regardless of subscription or credit state
- grace and suspension must preserve company identity and reactivation context even when public runtime is offline

### Messaging contract

- public suspension copy must explain paused hosting or ended trial/subscription truthfully
- public suspension copy must not use misleading blame language such as `suspended by its owner` when billing or trial expiry is the actual cause
- founder-facing recovery UI must offer keep-live or full-plan reactivation options while preserving the recoverable state story

## Implementation Trap Notes

### Trap 1: using lane wording for continuity entitlement

- **Wrong assumption:** names like `night_shift_lane_enabled` are harmless continuity fields.
- **Why it is wrong:** they confuse execution origin, billing lane, and entitlement posture.
- **Correct interpretation:** use entitlement/state language like `night_shift_eligible`.

### Trap 2: treating keep-live as full-active with fewer credits

- **Wrong assumption:** keep-live is just a smaller version of the full operating plan.
- **Why it is wrong:** keep-live is a hosting-first continuity posture with execution mostly off.
- **Correct interpretation:** keep-live preserves hosting and strategic continuity, not full operating execution.

## Acceptance Criteria

- active subscription plus `0` manual credits still keeps hosting and planning visible
- active subscription plus `0` manual credits keeps night shifts active while recurring and manual execution remain blocked
- queue management can remain available even when manual credits are empty
- keep-live is represented as a distinct hosting-first posture rather than a vague synonym for full active service
- keep-live keeps CEO chat and planning available while still blocking manual, recurring, and night-shift execution
- recurring tasks can queue without executing when credits are empty
- ads are never implied to use the visible task-credit pool — they operate independently as long as ads balance has funds
- expired unpaid trial can take public runtime offline before wiping founder context
- grace state keeps founder-private planning surfaces up while public runtime is already offline
- suspended state remains recoverable
- public suspension messaging is honest and does not falsely blame the founder
- live/public projection surfaces do not present suspended or offline company runtime as if it were still fully active

## Plain-Language New-Reader Tests

- Does `0` manual credits mean the company is dead?
- What still works in keep-live?
- What goes offline first after trial ends without continuation?
- Is night shift controlled by credits or by continuity entitlement?
- Can ads continue in keep-live even when manual task execution is blocked?

If a new reader cannot answer these directly from this file, the continuity model is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)

### Source facts

- `FACT-MON-006`
- `FACT-MON-008`
- `FACT-MON-009`
- `FACT-MON-010`
- `FACT-MON-011`
- `FACT-EXEC-006`
- `FACT-EXEC-012`

### Source decisions

- `DEC-BILL-001`
- `DEC-CRED-003`
- `DEC-HOST-001`
- `DEC-HOST-002`
- `DEC-HOST-003`
- `DEC-NIGHT-001`
- `DEC-NIGHT-003`
- `DEC-PAY-003`

### Claim-to-anchor audit

- active subscription with `0` manual credits keeps night shifts alive while recurring and manual execution remain gated:
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

- continuity entitlement fields must stay separate from charge gates and use state language rather than stale lane wording:
  - topics:
    - [specs/internal/billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
  - decisions:
    - `DEC-BILL-001`

## Change Log

- `2026-04-08`: seeded initial subscription continuity and hosting spec
- `2026-04-12`: rebuilt the continuity model to align with the billing umbrella, replace stale entitlement-as-lane wording, and lock the continuity matrix across zero-credit, keep-live, grace, and suspension states
