# Spec: Credits and Task Charging

- `Spec ID`: `SPEC-BILL-103`
- `Status`: rebuilt
- `Subsystem`: billing credits and task charging
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent spec`: [specs/internal/billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- `Parent build spec`: [specs/build/billing/credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/billing/credits-and-task-charging.md)

## Purpose

Define the founder-visible manual credits model, the exact charging boundary, and the no-rebill rule for same-scope platform-caused repair.

This child spec owns:

- one visible credits counter
- `1 task = 1 credit`
- charge-at-execution-start
- no-charge-before-start behavior
- recurring per-run credit rule
- founder-visible credit-gated projection
- internal source-bucket order beneath the single visible counter

## Founder-Visible Contract

The founder should experience charging like this:

- founder sees one visible credits counter
- `1 task = 1 credit` is the founder-facing rule
- credits are for worker execution, not for:
  - chat
  - planning
  - task proposals
  - queue management
  - document drafting
  - report viewing
- tasks can exist in queue before credits are spent
- founders can inspect and reorder queued tasks before spending credits
- credits are checked and charged at execution start, not when a task is merely drafted, opened, repeated, or queued
- if credits are missing when the founder tries to run work, the founder sees `Needs Credits` or equivalent purchase guidance rather than silent execution
- recurring tasks also consume credits per run when they actually begin execution
- same-scope platform-caused repair does not silently charge a fresh manual credit
- CEO may explain one task as up to about `4` hours of bounded work for scoping, but that is not the pricing formula

## Hidden-System Contract

- visible credits language must stay abstracted from raw token, search, browser, verification, retry, or remediation cost accounting
- the monetized boundary is the execution-start gate:
  - queue presence is non-billable
  - founder task-open is non-billable
  - blocked-before-start is non-billable
  - admitted execution start is billable
- manual tasks and recurring tasks share the founder-visible credit unit rule, but night shifts and ads remain separate billing lanes
- once a run has started and a credit has been consumed, later failure or verification outcome does not move the charge boundary backwards
- internal source buckets may exist beneath the founder-visible total, but founders still see one simple counter
- the manual credit pool is founder-scoped, not company-scoped — all companies under one founder share the same visible credit counter
- when a task starts on any company, one credit is consumed from the shared founder pool
- the dashboard shows the founder-level credit count regardless of which company is being viewed
- internal source buckets beneath the visible counter include:
  - `welcome_credits`: `10` granted at trial activation, non-renewable, consumed first
  - `monthly_credits`: `5` granted each billing cycle, renewable
- at paid conversion, unused welcome credits carry forward and are additive with monthly credits (max `15` at conversion moment)
- welcome credits do not renew; only monthly credits renew each billing cycle

## In Scope

- single visible credits counter
- `1 task = 1 credit`
- charge-at-execution-start
- no-charge-before-start behavior
- founder-visible `Needs Credits` projection
- recurring per-run credit rule
- same-scope repair no-rebill rule
- founder-safe scoping language

## Out of Scope

- trial package composition
- checkout UI and modal mechanics
- hosting and suspension lifecycle
- hidden actual-cost ledgers
- scheduler ownership of recurring materialization or queue order beyond the charge gate boundary

## Canonical Noun Imports

### `Credits`

- **Imported family meaning:** single founder-visible manual execution counter
- **Owned here**

### `billing_lane`

- **Imported meaning:** economic lane funding or accounting for work
- **Owned elsewhere:** billing umbrella
- **Used here for:** separating manual task-credit work from subscription-autopilot and ads work

### `Task`

- **Imported meaning:** durable founder-visible work unit
- **Owned elsewhere:** runtime child
- **Used here for:** charge boundary on execution start

### `Run`

- **Imported meaning:** one concrete execution attempt for a task
- **Owned elsewhere:** runtime child
- **Used here for:** exact execution-start charging boundary

## State Authority Section

| State / field | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| `visible_task_credits_remaining` | Canonical founder-visible counter | this spec | show founder-visible manual credits | confused with internal source buckets |
| charge-at-start boundary | Canonical | this spec | decide when one visible credit is consumed | moved to proposal time or queue time |
| `Needs Credits` founder projection | Derived | this spec with dashboard/runtime | explain charge-gated queued work | treated as raw runtime state |
| `manual_credits_remaining` | Canonical elsewhere | billing umbrella / this child seam | gate manual and recurring starts | used to gate night shifts |
| `billing_lane` | Canonical elsewhere | billing umbrella | distinguish manual task-credit work from ads/subscription lanes | redefined here |
| post-run actual-cost truth | Canonical elsewhere | verification + ledgers children | acknowledged as hidden economics | exposed as founder-visible charging formula |

## Charging Story

1. founder creates, receives, or repeats a task
2. task may wait in queue, approval, dependency, or founder-prioritized order
3. no credit is deducted while task is still non-executing
4. founder clicks `Run Now` or recurring work becomes eligible to start
5. readiness, dependency, execution-entitlement, and credit checks run
6. if prerequisites are missing or the task remains pre-start blocked:
   - execution does not begin
   - no credit is deducted
7. if credits are missing for a manual or recurring run:
   - execution does not begin
   - no credit is deducted
   - founder is routed into credit-gated purchase or upgrade handling owned elsewhere
8. when runtime flips the task into admitted execution, one visible credit is deducted
9. later result, retry, failure, verification, or repair logic does not rewrite that founder-visible charge boundary

## Boundary Cases

### Non-billable founder actions

- opening a task
- reading task detail
- reordering queued work
- editing a task before execution
- repeating a task into queue
- proposing work in CEO chat

### Billable run starts

- founder-triggered manual run that actually begins execution
- recurring run that actually begins execution

### Non-billable blocked states

- prerequisite missing before start
- OAuth or auth required before start
- approval still missing before start
- execution infeasible before worker launch
- rate-limited or blocked before execution really starts

### No-fresh-credit cases

- same-scope platform-caused repair
- blocked-before-start outcome
- queued or frozen task that never crosses into admitted execution

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “This task is queued.” | task exists but execution has not started | n/a | Guaranteed non-billable queue presence |
| “Run this now.” | execution entitlement, readiness, and credits all pass | founder sees blocked or `Needs Credits` instead | Best-effort execution, guaranteed honest gate behavior |
| “You were charged 1 credit.” | one admitted execution start happened | no charge if execution never started | Guaranteed charge-at-start rule |
| “We didn’t charge again for fixing our miss.” | miss stayed same-scope and within founder-free repair boundary | work blocks for founder decision or becomes new task if scope expands or stop-loss is exceeded | Guaranteed same-scope no-rebill rule, not unlimited free work |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| queued task | no charge yet | task exists without admitted execution | this spec | execution not started | founder credits unchanged | remains non-billable until admitted start |
| queued task | credit-gated hold | start attempted but insufficient credits | this spec consuming billing/runtime seams | charge-governed work and no credits available | founder sees `Needs Credits`; no charge | when credits return, task may attempt start again |
| queued task | charged execution | admitted execution starts | this spec + runtime seam | prerequisites and charge gate satisfied | one visible credit consumed | later failure or verification does not undo boundary |
| failed same-scope task | no fresh charge for repair | repair begins inside same-scope no-rebill path | this spec consuming verification result | repair remains on original task and founder-free policy still holds | no extra visible credit consumed | if stop-loss or scope expansion occurs, further work requires new decision/new task |

## Data and Interface Contract

### Founder-visible counters

- `visible_task_credits_remaining`
- `task_credit_charge_policy`: `on_execution_start`
- `founder_credit_unit_label`: `task`
- `credit_gated_state_label`: `Needs Credits`

### Runtime handshake

- task start check must happen before worker launch
- execution-start event must include whether visible credit charge is required
- billing layer must return one of:
  - `charge_allowed`
  - `insufficient_credits`
  - `execution_not_entitled`
  - `blocked_before_start`
  - `repair_no_rebill`
- admitted execution session should only persist if a real run is allowed to start

### Internal credit application order

- `credit_source_order`: `welcome_grant -> monthly_included -> purchased_extra`
- `visible_task_credits_remaining` stays founder-simple even if internal source buckets are distinct

### Shared seam fields

- `task_credits_remaining`
- `credits_required`
- `execution_attempt_id`
- `run_start_allowed`
- `credit_charge_result`

## Implementation Trap Notes

### Trap 1: charging on queue or proposal

- **Wrong assumption:** queue creation is close enough to execution to count as usage.
- **Why it is wrong:** the founder-visible story keeps planning and queue formation free.
- **Correct interpretation:** charge only when admitted execution actually starts.

### Trap 2: treating `Needs Credits` as raw runtime state

- **Wrong assumption:** `Needs Credits` should become a canonical task status enum.
- **Why it is wrong:** runtime child already owns canonical task states; this is a founder projection over a queued gated task.
- **Correct interpretation:** keep `Needs Credits` as a founder-visible billing projection.

### Trap 3: rebilling same-scope repair

- **Wrong assumption:** any second attempt means another founder credit.
- **Why it is wrong:** same-scope platform-caused repair is founder-free by design.
- **Correct interpretation:** no fresh visible credit for same-scope repair on the original task.

### Trap 4: exposing internal cost truth as visible pricing logic

- **Wrong assumption:** real post-run cost should determine founder-visible credits directly.
- **Why it is wrong:** founder-visible pricing remains `1 task = 1 credit`.
- **Correct interpretation:** internal cost truth improves governance and calibration, not the visible unit rule.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- runtime child defines when admitted execution really begins
- scheduler child defines when recurring work becomes due and visible, but this child defines when it becomes billable
- verification/remediation child defines same-scope repair and stop-loss boundaries, but this child defines no-fresh-credit handling inside that founder-visible rule
- billing umbrella owns state authority and hidden billing-lane separation
- dashboard owns display of `Needs Credits` and other founder copy

### Reconciliation notes

- this rebuilt child now aligns with the runtime child’s admitted-execution boundary
- this rebuilt child now keeps `Needs Credits` as projection rather than canonical runtime state
- this rebuilt child now aligns same-scope no-rebill with the rebuilt verification/remediation child
- later continuity and purchase-surface children may still need wording cleanup in their own serial passes

## Acceptance Criteria

- founder UI exposes one visible credits counter
- queued work can be visible before any credit is spent
- founders can reorder queued work without being charged
- opening or editing a task does not spend a credit
- admitted execution start is the only visible charge boundary
- blocked-before-start tasks do not consume credits
- insufficient-credit start attempts do not execute work and surface honest credit gating
- recurring runs consume one credit only when the recurring run really starts
- same-scope repair does not silently charge a fresh manual credit
- night shifts and ads are not described as consuming the visible manual credit counter
- the founder-visible rule remains `1 task = 1 credit` even when internal source buckets differ

## Plain-Language New-Reader Tests

- When exactly does one founder credit disappear?
- If a task is queued for days, was it charged already?
- If a task is blocked before start, was it charged?
- If recurring work becomes due but cannot start, is it charged anyway?
- If the platform fixes its own same-scope miss, does the founder lose another credit?

If a new reader cannot answer these directly from this file, the charging model is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [specs/internal/control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- [specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)

### Source facts

- `FACT-MON-004`
- `FACT-MON-005`
- `FACT-MON-016`
- `FACT-EXEC-001`
- `FACT-EXEC-002`
- `FACT-EXEC-007`
- `FACT-EXEC-013`

### Source decisions

- `DEC-CRED-001`
- `DEC-CRED-002`
- `DEC-CEO-003`
- `DEC-EXEC-004`
- `DEC-NIGHT-002`
- `DEC-EXEC-006`

### Claim-to-anchor audit

- founder-visible manual work stays `1 task = 1 credit`:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-004`
    - `FACT-MON-005`
    - `FACT-MON-016`
  - decisions:
    - `DEC-CRED-001`
    - `DEC-CRED-002`
    - `DEC-CEO-003`

- queue presence is free and charge boundary is execution start:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
    - [specs/internal/control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
  - facts:
    - `FACT-EXEC-001`
  - decisions:
    - `DEC-CRED-001`

- same-scope repair should not silently burn a new founder credit:
  - topics:
    - [specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)
  - facts:
    - `FACT-EXEC-007`
  - decisions:
    - `DEC-NIGHT-002`
    - `DEC-EXEC-006`

## Change Log

- `2026-04-08`: seeded initial credits and charging spec
- `2026-04-12`: rebuilt the charging model to align with the updated billing umbrella, runtime lifecycle, and verification/remediation rules, keeping charge-on-start exact and preserving founder-free same-scope repair
