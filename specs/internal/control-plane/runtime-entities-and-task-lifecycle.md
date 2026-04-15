# Spec: Runtime Entities and Task Lifecycle

- `Spec ID`: `SPEC-CTRL-102`
- `Status`: rebuilt
- `Subsystem`: runtime entities and task lifecycle
- `Classification`: internal system
- `Sensitivity`: internal only
- `Parent spec`: [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
- `Parent build spec`: [specs/build/control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/control-plane/runtime-entities-and-task-lifecycle.md)

## Purpose

Define the canonical runtime entities and lifecycle rules beneath founder-visible task cards and queue surfaces.

This child spec owns:

- `Task`, `Run`, `Session`, `Artifact`, and `ApprovalRecord`
- runtime lifecycle states and transition meaning
- retry history shape
- raw runtime truth beneath founder projections
- the hidden split between pre-start blocked and in-run blocked
- the layered meaning of run completion, verification result, and task completion

This child spec does **not** own:

- `worker_lane` inventory
- `run_channel` meaning
- scheduler selection policy
- billing-state authority
- founder UI copy placement

## Founder-Visible Contract

The founder should experience runtime truth like this:

- a task can exist in queue before execution starts
- queued work does not consume a manual credit by itself
- founder-visible blocked, failed, and fixed states are not decorative guesses
- a repaired task is the original task recovering after an earlier miss, not a second purchased task
- a founder timer begins when actual execution begins, not when a task is proposed
- `Needs Credits` is a founder projection of a queued task held at the execution-start gate, not a separate raw runtime status

## Hidden-System Contract

The canonical hidden model is:

- `Task`
  - durable founder-visible unit of work
- `Session`
  - runtime container for one execution context only
- `Run`
  - one concrete execution attempt for a task
- `Artifact`
  - durable output or evidence linked to the run that produced it
- `ApprovalRecord`
  - stored approval lineage for risky work
- `Repair`
  - additional run(s) on the original task after a same-scope miss

The runtime lifecycle must also preserve two hidden blocked cases:

- `blocked_pre_start`
  - no admitted run exists yet
- `blocked_in_run`
  - an admitted run was interrupted

Founder surfaces may flatten both to `Blocked`, but runtime must not.

## In Scope

- runtime entity definitions
- runtime lifecycle transitions
- retry and repair history shape
- artifact linkage
- approval linkage
- layered completion semantics
- founder projection rules derived from runtime truth

## Out of Scope

- lane-specific capability rules
- queue fairness policy
- connector schema details
- pricing copy
- UI layout details

## Canonical Noun Imports

### `Task`

- **Imported family meaning:** durable founder-visible work unit
- **Owned here**

### `Run`

- **Imported family meaning:** one concrete execution attempt for a task
- **Owned here**

### `Session`

- **Imported family meaning:** runtime container for one execution context only
- **Owned here**

### `Repair`

- **Imported family meaning:** same-scope remediation through additional run(s) on the original task
- **Owned with verification/remediation child**
- **Used here to define history and state shape**

### `worker_lane`, `run_channel`, `billing_lane`

- **Imported meanings only**
- `worker_lane` may attach to a `Task` as routing identity
- `run_channel` may attach to a `Run` or execution attempt
- `billing_lane` stays outside runtime-state ownership and must not replace task or run meaning

## State Authority Section

| State / field | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| `Task.status` | Canonical | this spec | define task runtime truth | flattened into founder-only copy |
| `Run.status` | Canonical | this spec | define attempt truth | treated as final founder-visible completion |
| `Session.status` | Canonical | this spec | define execution-context truth | used as substitute for task state |
| `worker_lane` on `Task` | Canonical elsewhere | lane child | attached as routing identity | used as billing or run-channel substitute |
| `run_channel` on `Run` or execution record | Canonical elsewhere | control-plane/scheduler specs | referenced as execution-origin metadata | redefined here |
| `billing_lane` | Canonical elsewhere | billing umbrella | acknowledged only as charge-gate context | used as task identity |
| founder board bucket / labels | Derived | dashboard child | projected from runtime truth | treated as canonical runtime schema |
| `Needs Credits` | Derived | dashboard + billing | projected when queued work is held at charge gate | turned into raw runtime status |

## Structural Model

### Canonical entity chain

The runtime preserves this durable chain:

1. `Task`
   - the durable orchestration unit beneath the founder task card
2. `Session`
   - the execution context for one operating purpose only
3. `Run`
   - one concrete attempt within that session
4. `Artifact`
   - durable output, evidence, or proof produced by the run
5. `ApprovalRecord`
   - explicit approval lineage linked to the same task history

This means:

- task identity is stable across retries and repairs
- session identity is stable only for one execution context and must not become a catch-all for unrelated surfaces
- run history is append-only
- artifacts stay linked to the run that produced them
- approval lineage remains queryable after task completion or failure

### Projection hierarchy

Founder-visible state must descend from these layers:

1. `Run` attempt truth
2. verification result where required
3. `Task` final runtime truth
4. founder projection into:
   - board bucket
   - detail label
   - timer state
   - reason copy

The founder shell may soften wording, but it must not invent task-state truth that runtime does not support.

### Layered completion language

Use these terms distinctly:

- `run_completed`
  - the worker stopped and the run ended
- `verification_passed` / `verification_failed`
  - evidence review result
- `task_completed`
  - founder-visible task is truly done after verification authority accepts it when verification is required

Bare `completed` is forbidden in canonical lifecycle language unless the layer is named.

## Session-to-Run Cardinality Rules

- one `Task` may have multiple `Sessions` over its lifetime (e.g. initial execution session, then a verification session, then a remediation session)
- one `Session` may have multiple `Runs` (retries within the same session context)
- one `Run` produces zero or more `Artifacts`
- `Session` is the execution-context boundary — a new session means a new context (fresh prompt assembly, fresh tool mount, fresh permission snapshot)
- `Run` is the attempt boundary within a session — retries reuse the same context but create a new run record
- a repair creates a new `Session` on the same `Task`, not a new `Task`

## Task Dependency Model

Tasks may declare dependencies that must be satisfied before execution admission:

### Dependency types

- `task_dependency`: another task must reach `completed` or `repaired` status first
- `external_condition`: an external prerequisite must be met (connector auth, API availability, prior deployment)

### Dependency fields on `Task`

- `dependencies`: array of `{ type: 'task' | 'external', ref_id, required_status?, description? }`

### Resolution rules

- if any dependency is unmet, task remains `blocked_pre_start` (never started) or `todo` with gated indicator
- dependency resolution is checked at admission time, not continuously polled
- circular dependencies must be detected and rejected at task creation time

## Approval Classification

Tasks are classified by risk level to determine approval requirements:

| Risk class | Description | Approval requirement |
|---|---|---|
| `low` | Read-only, internal, reversible operations | No approval needed |
| `moderate` | External-facing but bounded (tweet, email, doc update) | Autonomous with audit trail |
| `high` | Financial, deployment, public-facing changes | Founder approval required before execution |
| `dangerous` | Irreversible, multi-system, production-impacting | Founder approval + explicit confirmation |

### Approval rules

- risk class is assigned during task creation/planning by the control plane
- `ApprovalRecord` must be linked before execution starts for `high` and `dangerous` tasks
- approval expires after a configurable window (default: 24 hours for `dangerous`, 72 hours for `high`)
- expired approvals must be re-requested, not silently reused

## Entity Model

### `Task`

- durable founder-visible work unit
- can exist in queue with no admitted run yet
- preserves retry and repair history across attempts

Minimum fields:

- `id`
- `company_id`
- `title`
- `description`
- `worker_lane`
- `task_type`
- `priority`
- `risk_class`
- `approval_state_ref`
- `verification_state_ref`
- `status`
- `dependencies`
- `scheduled_for`
- `created_from`
- `current_session_id` when active
- `latest_run_id` when one exists
- `cost_policy_ref`
- `credit_policy_ref`

### `Session`

- runtime container for one execution context only
- examples that fit the rule:
  - task execution session
  - verification session
  - onboarding bootstrap session
- founder chat should not be used here as a catch-all justification for broad session semantics inside this child

Minimum fields:

- `id`
- `company_id`
- `session_type`
- `task_id` when applicable
- `status`
- `context_packet_version`
- `working_pattern_id`
- `tool_mount_profile_id`
- `prompt_assembly_spec_id`
- `permission_snapshot_id`
- `platform_service_bindings`
- `started_at`
- `ended_at`

### `Run`

- one concrete execution attempt within a session
- retries create new runs rather than overwriting old runs

Minimum fields:

- `id`
- `session_id`
- `task_id`
- `attempt_number`
- `run_channel_ref`
- `executor_backend`
- `status`
- `started_at`
- `ended_at`
- `failure_class`
- `stop_reason`

### `Artifact`

Minimum fields:

- `id`
- `task_id`
- `run_id`
- `artifact_type`
- `uri`
- `summary`
- `structured_metadata`
- `visibility`
- `created_at`

### `ApprovalRecord`

Minimum fields:

- `id`
- `company_id`
- `task_id`
- `risk_class`
- `approval_scope`
- `granted_by`
- `granted_at`
- `expires_at`
- `status`

## Lifecycle Model

### Canonical runtime task states

- `todo`
  - accepted and queued with no active run
- `in_progress`
  - at least one admitted active run exists
- `blocked_pre_start`
  - prerequisite failed before admitted execution began
- `blocked_in_run`
  - admitted execution was interrupted by dependency, credential, approval, or external condition
- `failed`
  - attempted execution path did not succeed and is not yet repaired
- `completed`
  - founder-visible task is truly done after required verification accepts it
- `repaired`
  - earlier same-scope miss recovered on the original task
- `rejected`
  - explicitly removed from normal execution path

### Transition table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| none | `todo` | task created | control plane into runtime | work accepted into queue | task exists with no active session/run | may wait indefinitely without spending credit |
| `todo` | `blocked_pre_start` | prerequisite intercept before admitted execution | control plane/runtime seam | no admitted run exists yet | founder may see `Blocked`; no run history yet; no credit burn | once prerequisite resolves, return to `todo` and re-enter admission |
| `todo` | `in_progress` | admitted execution starts | control plane + runtime | charge/start gate and prerequisites satisfied | `Session` and first `Run` created; timer can start | normal execution continues |
| `blocked_pre_start` | `todo` | prerequisite resolved | runtime consuming control-plane admission | no admitted run exists yet | task returns to queue admission | may later start or block again |
| `in_progress` | `blocked_in_run` | active run interrupted | runtime | at least one admitted run exists | run history preserved; founder may see `Blocked` | only this blocked case may resume directly back to active execution |
| `blocked_in_run` | `in_progress` | interrupted run resumes | runtime | same admitted execution context still valid | active execution continues | if resumed path fails, move through failure or verification result |
| `in_progress` | `failed` | attempted path does not succeed | runtime | active run ends unsuccessfully | failed run history preserved | may later move to repair or rejection |
| `in_progress` | `completed` | required verification accepted or no verification required and policy allows finality | runtime + verification child | evidence supports finality | founder-visible done state becomes true | terminal unless later superseded by new work |
| `failed` | `repaired` | same-scope remediation succeeds | verification/remediation child + runtime | repair remains on original task | original failed history preserved, additional run(s) recorded | terminal for original task unless later superseded |
| `todo` / `blocked_pre_start` / `failed` | `rejected` | founder or platform removes from ordinary execution | control plane/runtime seam | removal decision made | task leaves ordinary execution | terminal unless explicitly repeated/new task created |

## Lifecycle Story

1. control plane creates a `Task`
2. task enters queue as `todo`
3. admission checks decide whether runtime may start
4. if no admitted run exists and prerequisites fail, task becomes `blocked_pre_start`
5. if admitted execution starts, runtime creates `Session` and `Run`, and task becomes `in_progress`
6. if the active attempt is interrupted after start, task becomes `blocked_in_run`
7. if the attempt ends unsuccessfully, task becomes `failed`
8. if evidence is accepted, task becomes `completed`
9. if same-scope remediation succeeds later, task becomes `repaired`

## Founder Projection Rules

- `todo` projects to founder `To Do` or `Recurring` board placement depending on scheduler class
- `in_progress` projects to founder `In Progress` with timer sourced from `Run.started_at`
- both `blocked_pre_start` and `blocked_in_run` may project to founder `Blocked`, but reason copy should distinguish whether execution never started or was interrupted when useful
- founder `Needs Credits` is not a raw runtime state; it is a founder projection produced when a queued `todo` task or due recurring work is held by the charge gate before admitted execution
- `failed` may project to founder-safe wording such as `Couldn't Complete`
- `repaired` may project to founder-safe wording such as `Fixed`, while preserving the failed history underneath
- `rejected` projects to founder `Rejected`

This child owns the raw runtime truth. Dashboard child owns visible copy and placement.

## Edge Cases and Failure Handling

- blocked-before-start tasks must not decrement credits
- retries must preserve prior run history
- a task with no admitted run must never resume directly from blocked into active execution without passing admission again
- verification can prevent a run that stopped cleanly from becoming founder-visible completion
- risky or destructive work must not execute without linked approval lineage when policy requires it
- repair must remain on the original task rather than creating a second purchased task

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “This task exists.” | task record created | task stays in planning instead | Guaranteed if task entered runtime queue |
| “This is running.” | admitted run exists | founder sees blocked, queued, or credit-gated state instead | Guaranteed as raw runtime projection |
| “This is blocked.” | real unmet prerequisite exists | founder sees more specific state if available | Guaranteed as honest projection, even if hidden subtype is flattened |
| “This is fixed.” | same-scope remediation on original task succeeded | founder instead sees failed or blocked posture | Best-effort outcome with honest preserved history |
| “This is done.” | required verification accepted the result | founder sees unresolved or failed posture instead | Guaranteed only after final authority accepts completion |

## Implementation Trap Notes

### Trap 1: using `Task.lane`

- **Wrong assumption:** task routing identity can stay as a generic `lane` field.
- **Why it is wrong:** runtime must not collapse `worker_lane`, `run_channel`, and `billing_lane`.
- **Correct interpretation:** store `worker_lane` on the task and keep run/billing semantics separate.

### Trap 2: allowing `blocked -> in_progress` for every blocked task

- **Wrong assumption:** any blocked task can just resume.
- **Why it is wrong:** pre-start blocked tasks never began admitted execution and must return through queue admission.
- **Correct interpretation:** only `blocked_in_run` may resume directly into `in_progress`.

### Trap 3: treating run stop as task completion

- **Wrong assumption:** if the worker stopped, the task is done.
- **Why it is wrong:** verification may still reject the result.
- **Correct interpretation:** keep run completion, verification result, and task completion separate.

### Trap 4: using founder labels as raw runtime enums

- **Wrong assumption:** `Needs Credits` or `Fixed` should become canonical runtime states.
- **Why it is wrong:** those are founder projections over deeper runtime truth.
- **Correct interpretation:** keep runtime states canonical and derive founder copy later.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- control plane creates and hands off execution-ready tasks into this runtime model
- scheduler operates on queue presence and gating but does not redefine runtime entity meaning
- billing charges at admitted execution start and depends on this child's distinction between queued tasks and active runs
- dashboard projects runtime truth into board buckets and labels
- verification/remediation owns evidence standards and same-scope repair policy, but updates the runtime truth defined here

### Owning spec rule

- this spec owns:
  - `Task`, `Session`, `Run`, `Artifact`, and `ApprovalRecord`
  - runtime lifecycle transitions
  - blocked subtype split
  - layered completion semantics
  - retry and repair history shape
- [control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) owns:
  - intake normalization
  - planning
  - routing
  - approval interception seam
  - runtime handoff seam
- [lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md) owns:
  - `worker_lane` inventory
- [scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md) owns:
  - queue order
  - execution timing
  - recurring and night-shift behavior
- [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md) owns:
  - charge gates and continuity state authority
- [founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md) owns:
  - founder copy and visible layout

### Reconciliation notes

- this rebuilt child now uses `worker_lane` instead of bare `lane` for task routing identity
- this rebuilt child now splits `blocked_pre_start` from `blocked_in_run`
- this rebuilt child now separates run completion from verification result and task completion
- scheduler and dashboard siblings still contain stale older wording and should be cleaned in their own serial passes

## Acceptance Criteria

- every founder-visible task maps to one durable `Task`
- retries are represented as new `Run` records rather than overwritten history
- `blocked_pre_start` and `blocked_in_run` are distinct hidden runtime states
- only `blocked_in_run` may resume directly into active execution
- `worker_lane` is clearly separated from `run_channel` and `billing_lane`
- completion language is layered and unambiguous
- same-scope repair remains on the original task
- founder `Needs Credits` remains a projection rather than a canonical runtime state

## Plain-Language New-Reader Tests

- If a task is blocked before it ever started, does it resume directly or go back through queue admission?
- If a worker stops, is the task automatically complete?
- Does `Needs Credits` mean runtime state or a founder projection on queued work?
- Does a repaired task become a second task or stay the original task?
- Is `night_shift` stored as task identity or execution origin?

If a new reader cannot answer these directly from this file, the lifecycle model is still ambiguous.

## Implementation Freedom

- exact storage schema
- exact enum literal naming beyond the locked meanings
- exact artifact storage backend
- exact retry-count tuning

## Traceability

### Source topics

- [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
- [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
- [knowledge/topics/dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/dashboard-and-taskboard.md)
- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)

### Source facts

- `FACT-EXEC-001`
- `FACT-EXEC-003`
- `FACT-EXEC-010`
- `FACT-EXEC-012B`
- `FACT-EXEC-012C`
- `FACT-EXEC-012D`
- `FACT-EXEC-013`
- `FACT-MON-011`

### Source decisions

- `DEC-TERM-003`
- `DEC-TERM-004`
- `DEC-TERM-005`
- `DEC-EXEC-002`
- `DEC-DASH-002`
- `DEC-CRED-003`

### Claim-to-anchor audit

- `Task`, `Run`, `Session`, and `Repair` must remain separate entities, with repair staying on the original task:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-012B`
  - decisions:
    - `DEC-TERM-003`

- blocked must split into pre-start and in-run cases:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-012C`
  - decisions:
    - `DEC-TERM-004`

- completion language must remain layered across run stop, verification, and task completion:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-012D`
  - decisions:
    - `DEC-TERM-005`

- founder-visible task states are downstream projections of real runtime outcomes rather than dashboard-only labels:
  - topics:
    - [knowledge/topics/dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/dashboard-and-taskboard.md)
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-EXEC-010`
    - `FACT-EXEC-013`
  - decisions:
    - `DEC-EXEC-002`
    - `DEC-DASH-002`

- founder `Needs Credits` remains a projection on queued work rather than a raw runtime state:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-011`
  - decisions:
    - `DEC-CRED-003`

## Change Log

- `2026-04-06`: seeded initial runtime entity packet
- `2026-04-12`: rebuilt the runtime lifecycle model to align with the umbrella vocabulary, replace bare lane semantics, split blocked into pre-start and in-run cases, and separate run completion from verification-backed task completion
