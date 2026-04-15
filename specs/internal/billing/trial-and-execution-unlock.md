# Spec: Trial and Execution Unlock

- `Spec ID`: `SPEC-BILL-101`
- `Status`: rebuilt
- `Subsystem`: billing trial and execution unlock
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent spec`: [specs/internal/billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- `Parent build spec`: [specs/build/billing/trial-and-execution-unlock.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/billing/trial-and-execution-unlock.md)

## Purpose

Define the founder journey from pre-trial proof into trial activation, with the exact rule that trial unlocks execution rather than first creating company existence.

This child spec owns:

- pre-trial visible value contract
- trial package contents
- `trial_state`
- `execution_unlocked`
- continuity of the same company before and after activation
- trial unlock matrix across founder surfaces

## Founder-Visible Contract

The founder should experience the trial boundary like this:

- visible company value exists before trial starts
- trial is the execution unlock, not the moment the company first appears
- trial is card-required
- the preserved founder-visible trial package is:
  - `3-day` free trial
  - `10` welcome bonus task credits
  - `3` night shifts
- before trial:
  - bootstrap proof is visible
  - starter tasks can be inspected and reordered
  - queued work does not auto-run
  - CEO can keep planning and explaining what comes next
- after trial activation:
  - the same company and same queued tasks continue forward
  - manual execution becomes available
  - trial night shifts become available
  - the founder remains in the same operating product rather than entering a second product shell

## Hidden-System Contract

- pre-trial companies already exist in system state and can accumulate planning context, documents, queue order, and public proof artifacts
- trial activation flips `execution_unlocked` from false to true without regenerating company identity, slug, site, inbox, or starter tasks
- starter tasks can sit in `todo` before trial starts
- trial activation must not blindly auto-burn the queue
- paid continuation renews the same execution model with normal paid posture instead of welcome-credit posture
- founder-owned execution connections may still be absent after trial starts; trial unlocks execution entitlement, not universal connector readiness
- ads remain governed by their own `billing_lane` and must not be implied to become available merely because trial started

## In Scope

- pre-trial visible value bundle
- exact trial package contents
- `trial_state`
- `execution_unlocked`
- continuity across pre-trial, trial, and paid continuation
- trial unlock matrix by surface and action class

## Out of Scope

- checkout UI design details
- per-task charging rules
- welcome-credit depletion order
- keep-live and suspension lifecycle after trial end
- child-level connector policy after execution unlock

## Canonical Noun Imports

### `trial_state`

- **Imported family meaning:** trial lifecycle only
- **Owned here**
- **Must not be confused with:** subscription continuity or hosting continuity

### `execution_unlocked`

- **Imported family meaning:** whether execution may begin for the company posture
- **Owned here**
- **Must not be confused with:** public runtime being online or manual credits being available

### `manual_credits_remaining`

- **Imported meaning only:** manual-credit availability for charge-governed execution
- **Owned elsewhere:** [credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)
- **Used here for:** unlock-matrix consequences only

### `billing_lane`

- **Imported meaning only:** economic lane funding or accounting for work
- **Owned elsewhere:** billing umbrella
- **Used here for:** explaining why ads do not unlock the same way as manual task execution

## State Authority Section

| State / field | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| `trial_state` | Canonical | this spec | define pre-trial, active trial, expired trial posture | used as substitute for hosting continuity |
| `execution_unlocked` | Canonical | this spec | decide whether execution may begin at all | used as substitute for connector readiness |
| pre-trial proof readiness | Derived/owned here as trial-boundary projection | this spec with onboarding | describe whether visible proof bundle exists before trial | treated as full execution readiness |
| `manual_credits_remaining` | Canonical elsewhere | credits-and-task-charging child | explain what happens after unlock if credits exist or not | redefined here |
| connector readiness | Canonical elsewhere | control-plane/memory-connectors specs | explain per-surface blockers after unlock | implied to be fully true at trial start |
| `night_shift_eligible` | Canonical elsewhere | continuity child | explain trial and paid night-shift posture | redefined here as manual-credit concept |

## Lifecycle Story

1. founder enters onboarding or dashboard without execution unlocked
2. system creates or shows the bootstrap proof bundle
3. founder can inspect artifacts, read CEO guidance, and shape queued work before spending credits
4. starter tasks remain visible but non-executing
5. founder starts trial through card-required activation
6. `trial_state` becomes active
7. system grants:
   - `10` welcome bonus task credits
   - `3` trial night shifts
8. `execution_unlocked` becomes true
9. the same company, queue, and public proof continue forward into active execution posture
10. if the founder converts into paid continuation:
   - unused welcome credits remain available and are additive with paid credits
   - paid monthly `5` task credits are added to any remaining welcome credits
   - example: if `4` welcome credits remain at conversion, founder has `4 + 5 = 9` total credits
   - maximum possible credits at conversion moment: `10 + 5 = 15` (if no welcome credits were used)
   - welcome credits do not renew; only the monthly `5` credits renew each billing cycle
   - paid monthly `30` night shifts replace the temporary trial night-shift pool rather than stacking on top of it

## Trial Unlock Matrix

| Surface / action | Pre-trial | At trial start | Extra prerequisites after trial start | If prerequisites fail |
|---|---|---|---|---|
| CEO chat / planning | available | remains available | none beyond normal product access | n/a |
| task inspection and reorder | available | remains available | none | n/a |
| manual task execution | locked | unlocked in principle | visible credits, prerequisite readiness, connector/auth readiness, approvals when required | founder sees `Needs Credits` or `Blocked`, not fake execution |
| recurring execution | definitions/visibility may exist | unlocked in principle | due occurrence, visible credits, prerequisite readiness | due work remains visible and gated if blocked |
| night shift | off before trial | unlocked in principle through trial allowance | appropriate queued task and continuity entitlement | no run starts if nothing appropriate or task is blocked |
| Email / outreach actions | partially visible | execution path unlocked in principle | inbox/connectors/auth readiness | founder sees connect/auth/blocker state |
| Twitter action | partially visible | execution path unlocked in principle | allowed account/path readiness | founder sees blocker if unavailable |
| Ads / `Run Ads` | may be visible as module | operates independently of trial/subscription | ads have fully independent billing (founder deposits, platform takes 20%, rest goes to ad spend) | founder sees ads-specific balance/deposit gating, never task-credit gating |

## Boundary Behavior

### Before trial

- company shell already exists
- public company surface can already be live
- startup proof bundle is visible
- CEO chat and planning are live
- queued starter tasks are visible
- founder can reorder or choose what should run first
- execution remains blocked
- night shifts do not run yet

### On activation

- activation is card-required
- existing company record is preserved
- `execution_unlocked` flips on
- welcome credits and trial night shifts are granted
- queued work becomes runnable in principle but not auto-consumed blindly

### After activation

- founder remains in the same dashboard shell
- the same queued tasks can now run if other gates pass
- manual execution and night shifts can operate
- connector-dependent surfaces may still block honestly if auth or ownership is missing
- ads still need their separate billing readiness

### On paid continuation

- unused welcome task credits carry forward if any remain
- paid continuation adds the monthly `5` credit pool
- paid continuation uses normal `30` night shifts per month rather than stacking with the `3` trial night shifts
- founder stays in the same company shell and CEO thread continuity

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “Trial starts execution.” | card capture succeeds and company is eligible | founder stays in planning-only posture | Guaranteed as boundary rule, not payment success |
| “Your company already exists before trial.” | bootstrap proof bundle created | founder may still see partial or pending proof surfaces | Guaranteed company continuity, best-effort proof completeness |
| “These queued tasks can run now.” | `execution_unlocked` plus credits, prerequisites, approvals, and connector readiness where needed | founder sees gated or blocked state rather than auto-run | Best-effort execution after unlock |
| “Night shift is included in trial.” | trial night-shift allowance exists and an appropriate task is available | no run starts if nothing appropriate or task remains blocked | Guaranteed allowance, best-effort execution |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| pre-trial company | active trial | successful card-required activation | this spec + purchase surfaces | company exists and activation succeeds | `trial_state` active, `execution_unlocked` true, trial package granted | same company record continues forward |
| active trial | paid continuation | founder converts | this spec + purchase surfaces | paid continuation succeeds | monthly paid posture begins, unused welcome credits may carry forward | no company recreation |
| active trial | expired trial | trial window ends without continuation | this spec handing off to continuity child | no continuation purchase | execution-unlock consequences now flow into continuity lifecycle | continuity child owns grace/suspension behavior |

## Data and Interface Contract

### Founder-visible trial state

- `trial_state`: `not_started | active | expired`
- `execution_unlocked`: boolean
- `pre_trial_proof_ready`: boolean
- `trial_days_remaining`
- `welcome_task_credits`
- `trial_night_shifts_remaining`
- `welcome_task_credits_carry_forward`: boolean
- `paid_monthly_task_credits`
- `paid_monthly_night_shifts`
- `queued_tasks_visible`: boolean
- `queued_tasks_runnable`: boolean

### Activation handoff

- onboarding and dashboard must receive the same `execution_unlocked` truth
- purchase success must hand off a card-captured activation result rather than a generic route change
- pre-trial proof artifacts must remain attached to the same company identity after activation
- runtime must receive a runnable-state change for the existing queue, not a regenerated queue
- runtime must not infer execution unlock from company age or artifact presence alone

### Continuity invariants

- same `company_id` before and after activation
- same slug and public company surface before and after activation
- same starter-task records before and after activation
- same CEO thread continuity before and after activation
- trial is the unlock of execution posture, not recreation of company posture

## Execution Unlock Mechanism

When trial activation succeeds (card capture completes via Stripe):

1. Stripe webhook `checkout.session.completed` fires
2. Platform webhook handler validates the session and maps it to the company
3. Database transaction:
   - `trial_state` → `active`
   - `execution_unlocked` → `true`
   - `welcome_task_credits` → `10` credited to founder-level pool
   - `trial_night_shifts_remaining` → `3`
   - `trial_started_at` → current timestamp
   - `trial_expires_at` → current timestamp + 3 days
4. Event emitted: `execution_unlocked` for the company
5. Scheduler evaluates: checks if any queued `todo` tasks can now be admitted
   - tasks are NOT auto-started blindly
   - scheduler applies normal admission checks (dependencies, approval, credits)
   - founder can still reorder before anything runs
6. CEO chat receives the unlock event and can explain what is now available

This is a one-time irreversible flip per company. A company cannot return to pre-trial state.

## Implementation Trap Notes

### Trap 1: treating trial as company creation

- **Wrong assumption:** company identity, site, inbox, and starter tasks appear only after payment.
- **Why it is wrong:** pre-trial visible value is already part of the product contract.
- **Correct interpretation:** trial unlocks execution on top of an already-created company shell.

### Trap 2: treating unlock as universal readiness

- **Wrong assumption:** once trial starts, every action can run immediately.
- **Why it is wrong:** execution entitlement is separate from connector/auth/approval readiness.
- **Correct interpretation:** trial unlocks execution in principle; actual start still depends on the relevant downstream gates.

### Trap 3: treating ads as part of the same unlock path

- **Wrong assumption:** if trial unlocks task execution, ads must also unlock automatically.
- **Why it is wrong:** ads live in a separate `billing_lane` with separate readiness.
- **Correct interpretation:** keep ads gating separate in the unlock matrix.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- onboarding owns bootstrap creation of the proof bundle that exists before trial
- dashboard owns projection of queue, trial card, and CEO continuity surface
- purchase surfaces own how card-required activation is presented
- billing umbrella owns broader state authority around trial, hosting, credits, and continuity
- control-plane/runtime consume `execution_unlocked` but still apply charge/prerequisite/connector gates afterward

### Reconciliation notes

- this rebuilt child now clearly separates execution unlock from connector readiness and ads readiness
- this rebuilt child now provides an explicit trial unlock matrix instead of a slogan only
- sibling cleanup completed: all billing and control-plane children are now rebuilt and aligned

## Acceptance Criteria

- pre-trial founder can see value without execution being available
- trial is card-required
- trial activation grants `10` welcome credits and `3` trial night shifts
- trial activation turns `execution_unlocked` on without recreating company identity
- activation does not blindly auto-run the queue
- paid continuation carries unused welcome credits forward if any remain
- paid continuation does not stack `3` trial night shifts on top of the normal paid `30`-night-shift monthly pool
- onboarding, dashboard, billing umbrella, and runtime all agree on the same trial boundary story
- the unlock matrix clearly distinguishes execution entitlement from connector/ads prerequisites

## Plain-Language New-Reader Tests

- What exists before trial starts?
- What exactly becomes true when trial starts?
- Does trial unlock mean every module can act immediately?
- Do ads unlock with trial the same way manual task execution does?
- Does activation recreate the company or continue the same company?

If a new reader cannot answer these directly from this file, the trial boundary is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [specs/internal/onboarding-bootstrap.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/onboarding-bootstrap.md)
- [specs/internal/founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md)

### Source facts

- `FACT-MON-001`
- `FACT-MON-002`
- `FACT-MON-003`
- `FACT-MON-012`

### Source decisions

- `DEC-TRIAL-001`
- `DEC-TRIAL-002`
- `DEC-TRIAL-003`
- `DEC-BOOT-001`
- `DEC-TASK-001`
- `DEC-PAY-003`

### Claim-to-anchor audit

- trial is the execution unlock rather than company creation:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-001`
    - `FACT-MON-002`
  - decisions:
    - `DEC-TRIAL-001`

- trial package remains `3-day`, `10` welcome credits, and `3` night shifts:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-003`
    - `FACT-MON-012`
  - decisions:
    - `DEC-TRIAL-003`
    - `DEC-TRIAL-002`

- bootstrap proof exists before trial and starter tasks remain continuous across activation:
  - topics:
    - [specs/internal/onboarding-bootstrap.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/onboarding-bootstrap.md)
  - decisions:
    - `DEC-BOOT-001`
    - `DEC-TASK-001`

- ads are not unlocked on the same basis as manual task execution because they have a separate billing lane:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - decisions:
    - `DEC-PAY-003`

## Change Log

- `2026-04-08`: seeded initial trial and execution unlock spec
- `2026-04-12`: rebuilt the trial boundary to align with the billing umbrella, separate execution entitlement from connector and ads readiness, and add an explicit unlock matrix for pre-trial versus post-trial behavior
