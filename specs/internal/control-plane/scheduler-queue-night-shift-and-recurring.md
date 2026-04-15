# Spec: Scheduler, Queue, Night Shift, and Recurring

- `Spec ID`: `SPEC-CTRL-103`
- `Status`: rebuilt
- `Subsystem`: scheduler, queue, night shift, and recurring execution
- `Classification`: internal system
- `Sensitivity`: internal only
- `Parent spec`: [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
- `Parent build spec`: [specs/build/control-plane/scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/control-plane/scheduler-queue-night-shift-and-recurring.md)

## Purpose

Define how queued work is selected and executed after task creation:

- company-local queue semantics
- fair platform scheduling
- recurring due-work materialization
- night-shift selection
- founder reorder power
- credit and prerequisite gates after queue entry

This child spec owns scheduler behavior and `run_channel` behavior after routing.

## Founder-Visible Contract

The founder should experience the scheduler like this:

- founders can see and reorder queued tasks
- queue order matters
- night shift is a distinct background operating path
- night shift picks one highest-priority appropriate task per night
- night shift is not maintenance-only
- recurring work is real repeated work and consumes credits per run when it actually starts
- with active subscription and `0` manual credits:
  - night shift can still run
  - recurring work can remain visible or queued but does not start
  - manual execution pauses

## Hidden System Contract

The scheduler must distinguish clearly between:

- `worker_lane`
  - who executes the work
- `run_channel`
  - how execution entered the system
- `billing_lane`
  - which economic lane funds or accounts for the work

This child spec owns `run_channel` behavior after routing, not `worker_lane` inventory or billing-state authority.

## In Scope

- queue model
- founder reorder semantics
- recurring due-work materialization
- night-shift selection
- default concurrency posture
- same-scope remediation preemption
- zero-credit execution behavior after queue entry

## Out of Scope

- runtime entity ownership
- lane inventory ownership
- billing-state authority
- UI layout
- actual-cost accounting internals

## Canonical Noun Imports

### `run_channel`

- **Imported family meaning:** how execution entered the system
- **Owned here after routing**
- **Canonical values used here:** `manual`, `recurring`, `night_shift`, `remediation`
- **Must not be confused with:** `worker_lane` or `billing_lane`

### `worker_lane`

- **Imported meaning:** specialist executor family assigned to the task
- **Owned elsewhere:** [lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
- **Used here for:** readiness and capability-sensitive scheduling inputs only

### `billing_lane`

- **Imported meaning:** economic lane that funds or accounts for the work
- **Owned elsewhere:** [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- **Used here for:** charge-gated versus subscription-governed scheduler behavior only

### `Task`

- **Imported meaning:** durable founder-visible work unit
- **Owned elsewhere:** [runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- **Used here for:** queue and due-work materialization behavior

## State Authority Section

| State / field | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| queue position | Canonical within queue projection | this spec | founder reorder, selection order | used as billing or runtime identity |
| `run_channel` | Canonical | this spec after routing | distinguish manual, recurring, night-shift, remediation behavior | confused with `worker_lane` |
| `worker_lane` | Canonical elsewhere | lane child | readiness and working-pattern-sensitive scheduling inputs | redefined here |
| `Task.status` | Canonical elsewhere | runtime child | determine whether work is queued, active, blocked, failed, etc. | redefined here |
| `manual_credits_remaining` / `night_shift_eligible` | Canonical elsewhere | billing umbrella | determine whether charge-gated or subscription-governed work may start | redefined here |
| founder board labels | Derived elsewhere | dashboard child | project scheduler decisions to the founder | treated as canonical scheduler schema |

## Structural Model

### Scheduling layers

The scheduler combines three layers of truth.

#### 1. Founder-visible queue layer

- manual queue order
- reorder operations

#### 2. Company execution layer

- readiness
- dependencies
- approval posture
- credit posture
- remediation urgency
- worker-lane-specific prerequisites

#### 3. Platform fairness layer

- cross-company fairness
- worker capacity
- safe concurrency

Queue order is the primary visible selector, but it is not the only admissibility rule.

### `run_channel` model

Scheduling must preserve four distinct execution origins.

#### `manual`

- founder-triggered
- charge-governed by the visible manual credits model

#### `recurring`

- schedule-defined
- due work is materialized as a durable task
- charge-governed per actual run start

#### `night_shift`

- subscription-governed operating path
- not funded from the manual visible credit pool
- selects one highest-priority appropriate task per night

#### `remediation`

- trust-recovery path for same-scope platform-caused misses
- may preempt ordinary roadmap order when appropriate

### Recurring materialization rule

When a recurring occurrence becomes due:

- it must materialize immediately as a durable `Task`
- that task must carry `run_channel = recurring`
- if credits or prerequisites are missing, it remains visible and gated rather than staying invisible scheduler intent

This keeps board truth, runtime history, and scheduler truth aligned.

### Zero-credit behavior matrix

With active subscription and `0` manual credits:

- manual tasks:
  - can remain visible and queued
  - do not start execution
- recurring tasks:
  - can materialize and remain visible or queued
  - do not start execution
- night shifts:
  - remain eligible to run when continuity entitlement allows
- same-scope remediation:
  - remains eligible when it belongs to trust recovery rather than fresh founder-paid work

### Concurrency model

- default normal company execution is one active slot
- concurrency expansion requires explicit safety and economics policy
- remediation can preempt ordinary queue order more readily than unrelated roadmap work
- future parallelism is allowed only when task conflict risk is demonstrably low

## Scheduling Policy

### Queue priorities

Visible input:

- founder queue order

Hidden inputs:

- dependency readiness
- approval readiness
- credit availability
- lane-specific readiness
- remediation urgency

### Night shift

- runs once per night per eligible company
- selects one highest-priority appropriate task
- may preempt generic queue order when same-scope repair is needed

#### Night shift selection criteria (6-step filter chain)

1. **Eligibility filter:** company must have `night_shift_eligible = true` (subscription or trial entitlement)
2. **Pool filter:** for multi-company founders, scheduler cycles night shifts fairly across eligible companies from the shared founder-level pool
3. **Candidate filter:** task must be in `todo` or `failed` (for repair), not `blocked_pre_start`, not `rejected`
4. **Repair priority:** same-scope repair candidates are evaluated first — trust recovery takes priority over roadmap
5. **Milestone alignment:** among non-repair candidates, prefer tasks aligned with the active milestone
6. **Queue position:** among equally qualified candidates, respect founder queue order

#### Night shift does not:

- consume manual credits
- start if no appropriate task passes all 6 filters
- run multiple tasks per company per night (one task per company per night)

### Recurring

- recurring definition creates due work on schedule
- due recurring work becomes a durable task immediately
- if the charge gate fails, the task remains queued and visible rather than disappearing

#### Recurring task materialization cap

- maximum `10` gated (credit-blocked) recurring tasks may accumulate per company at any time
- once the cap is reached, further due occurrences are logged but not materialized until existing gated tasks are cleared
- this prevents unbounded task accumulation during extended zero-credit periods
- the cap applies only to gated tasks; recurring tasks that successfully start execution do not count against it

### Concurrency and slot interaction

- default: one active execution slot per company
- night shift and manual execution share the same slot — they cannot run concurrently
- if a manual task is in progress when the night shift tick fires, the night shift skips that company for the night
- remediation preemption: a remediation task may claim the active slot ahead of ordinary queue order, but it still respects the one-slot limit
- future multi-slot expansion requires explicit policy and conflict-safety analysis

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| founder reorder | updated queue order | founder changes order | this spec | task remains reorderable | queue position changes | selection uses new order subject to hidden gates |
| recurring definition | due recurring task | recurrence becomes due | this spec | definition active and company valid | durable task created with `run_channel = recurring` | if start gate fails, task stays queued/gated |
| queued task | admitted execution candidate | selector considers task | this spec with control-plane/runtime/billing seams | queue presence plus hidden gates evaluated | candidate may start, remain queued, or stay blocked/gated | reevaluate on gate change |
| eligible company | night-shift-selected task | nightly selection tick | this spec | `night_shift_eligible` true and at least one appropriate task exists | one task chosen with `run_channel = night_shift` | next selection occurs on next cycle |
| failed same-scope work | remediation-preempted position | repair urgency recognized | this spec | remediation still in original scope | remediation candidate rises ahead of unrelated roadmap work | after remediation outcome, return to normal ordering |

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “Queue order matters.” | scheduler respects founder order as primary visible selector | hidden gates may delay the top task | Guaranteed as prioritization input, not guaranteed immediate start |
| “Recurring work will keep showing up.” | recurring definition remains active | task may be blocked/gated rather than executing | Guaranteed durable due-work materialization |
| “Night shift will work tonight.” | `night_shift_eligible` true and an appropriate task exists | no run starts if nothing appropriate or prerequisites fail | Best-effort within real eligibility and readiness rules |
| “This task needs credits.” | task is charge-governed and execution-start gate failed | task stays visible and queued | Guaranteed honest projection of charge-gated queued work |

## Data and Interface Contract

### Queue item

- `task_id`
- `company_id`
- `queue_position`
- `worker_lane_ref`
- `task_status_ref`
- `readiness_state`
- `credit_gate_state`
- `approval_gate_state`
- `run_channel_ref`

### Recurring definition

- `recurring_id`
- `company_id`
- `task_template`
- `schedule`
- `worker_lane_ref`
- `credit_policy_ref`
- `autonomous_policy`
- `status`

### Due recurring task materialization

- `due_occurrence_id`
- `recurring_id`
- `materialized_task_id`
- `company_id`
- `run_channel_ref`
- `due_at`
- `credit_gate_state`
- `last_gate_reason`
- `created_at`

### Night-shift candidate view

- `company_id`
- `eligible_tasks`
- `active_milestone`
- `queue_state`
- `remediation_candidates`
- `subscription_status_ref`
- `night_shift_eligible`

## Edge Cases and Failure Handling

- credit exhaustion must not delete recurring intent; it should hold execution on visible due work
- scheduler must not keep recurring work invisible after it becomes due
- anti-bot or auth-blocked channel work must not be blindly retried forever
- same-scope repair must preempt cleanly without charging a new manual credit
- founder reorder remains meaningful even when hidden gates prevent the top task from starting immediately

## Implementation Trap Notes

### Trap 1: using `lane` for scheduler origin

- **Wrong assumption:** queue items can keep a single `lane` field for everything.
- **Why it is wrong:** scheduler needs both `worker_lane` and `run_channel`, which answer different questions.
- **Correct interpretation:** `worker_lane_ref` says who does the work; `run_channel_ref` says how the work entered execution.

### Trap 2: keeping due recurring work as invisible scheduler intent

- **Wrong assumption:** recurring occurrences can remain hidden until credits exist.
- **Why it is wrong:** it breaks founder queue truth and creates a second hidden model of work.
- **Correct interpretation:** materialize due work immediately as a durable task and gate it visibly if needed.

### Trap 3: treating night shift like manual credit work

- **Wrong assumption:** if manual credits are `0`, scheduler must stop all execution.
- **Why it is wrong:** night shift is subscription-governed, not manual-credit-governed.
- **Correct interpretation:** use billing-state entitlement for night-shift eligibility.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- dashboard exposes queue order, timers, and credit-gated messaging as projections of scheduler policy
- billing defines which work is charge-gated and which remains subscription-governed
- runtime state truth determines whether a task is queued, active, blocked, failed, or repaired
- control plane supplies task routing and remediation intents that scheduler evaluates
- roadmap and active milestone influence what counts as highest-priority appropriate work, especially for night shift

### Owning spec rule

- this spec owns:
  - company-local queue semantics
  - founder reorder meaning
  - default concurrency posture
  - recurring due-work materialization
  - night-shift selection semantics
  - same-scope remediation preemption
  - `run_channel` behavior after routing
- [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md) owns:
  - billing-state authority
  - `billing_lane`
  - zero-credit continuity and night-shift eligibility
- [runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md) owns:
  - task/runtime states and blocked split
- [control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) owns:
  - pre-runtime routing and admission seams
- [lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md) owns:
  - `worker_lane` inventory and boundaries

### Reconciliation notes

- this rebuilt child now uses `run_channel` and `worker_lane` instead of bare `lane`
- this rebuilt child now locks recurring due-work materialization as durable task creation
- this rebuilt child now aligns zero-credit behavior with the updated billing umbrella and runtime child
- sibling cleanup completed: continuity spec now uses `night_shift_eligible` instead of stale lane wording

## Acceptance Criteria

- queue order is visible and meaningful
- default execution remains effectively sequential per company unless safe expansion is explicitly allowed
- recurring due work materializes as durable visible task(s)
- recurring runs consume credits only when actual execution starts
- night shift remains separate from manual credits and executes one task per night
- active subscription plus `0` manual credits behaves exactly as locked
- scheduler no longer relies on ambiguous bare `lane` wording

## Plain-Language New-Reader Tests

- When recurring work becomes due, does it become a real task immediately or stay hidden until credits exist?
- Is `night_shift` a worker family or an execution origin?
- If the top queued task needs credits, does it disappear or stay visible and gated?
- Can night shift still run when manual credits are `0`?
- Does queue order matter even when hidden gates prevent the top task from starting?

If a new reader cannot answer these directly from this file, the scheduler model is still ambiguous.

## Implementation Freedom

- exact queue store
- exact scheduler transport
- exact cron/timer system
- exact fairness scoring

## Traceability

### Source topics

- [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [knowledge/topics/dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/dashboard-and-taskboard.md)

### Source facts

- `FACT-EXEC-002`
- `FACT-EXEC-005`
- `FACT-EXEC-006`
- `FACT-EXEC-007`
- `FACT-EXEC-012`
- `FACT-EXEC-012E`
- `FACT-MON-010`
- `FACT-MON-011`

### Source decisions

- `DEC-SCHED-001`
- `DEC-SCHED-002`
- `DEC-NIGHT-001`
- `DEC-NIGHT-002`
- `DEC-NIGHT-003`
- `DEC-CRED-003`

### Claim-to-anchor audit

- founders can reorder tasks and queue order remains the primary visible selector rather than a fake decorative ranking:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
    - [knowledge/topics/dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/dashboard-and-taskboard.md)
  - facts:
    - `FACT-EXEC-002`
    - `FACT-EXEC-005`
  - decisions:
    - `DEC-SCHED-001`

- one night shift picks one highest-priority appropriate task per night and remains separate from manual task credits:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-EXEC-006`
    - `FACT-MON-010`
  - decisions:
    - `DEC-NIGHT-001`
    - `DEC-NIGHT-003`

- recurring due work materializes as durable task truth rather than staying invisible scheduler intent:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-EXEC-012E`
  - decisions:
    - `DEC-SCHED-002`

- same-scope repair uses remediation capacity rather than silently charging a fresh manual credit:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-EXEC-007`
  - decisions:
    - `DEC-NIGHT-002`
    - `DEC-CRED-003`

## Change Log

- `2026-04-06`: seeded initial scheduler and recurring packet
- `2026-04-12`: rebuilt the scheduler model to replace bare lane wording with run-channel-aware semantics, lock recurring due-work materialization as durable task creation, and align zero-credit/night-shift behavior with the updated billing and runtime umbrellas
