# Spec: Control Plane, Runtime, and Task Agents

- `Spec ID`: `SPEC-CTRL-001`
- `Status`: rebuilt
- `Subsystem`: control plane, runtime, and task agents
- `Classification`: internal system
- `Sensitivity`: internal only
- `Parent build spec`: [specs/build/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/control-plane-runtime-and-task-agents.md)

## Purpose

Define the canonical hidden execution model that sits behind founder chat, the taskboard, scheduler activity, and specialist work.

This umbrella spec owns:

- the family-level architecture chain
- the canonical runtime vocabulary used by the control-plane family
- the founder-visible contract versus hidden-system contract split
- the cross-child invariants that must stay true across runtime, scheduler, lane-routing, memory/tools, verification, and billing seams

This umbrella spec does **not** own the deepest field schemas or child-state machines. Child specs own those.

## Child Spec Family

This umbrella governs these child specs:

- [control-plane/control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md)
- [control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- [control-plane/lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
- [control-plane/memory-context-tools-and-connectors.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/memory-context-tools-and-connectors.md)
- [control-plane/scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md)
- [control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)

## Founder-Visible Contract

The founder should experience the system like this:

- CEO is the only founder-facing orchestrator.
- Specialist work appears through founder-safe family labels such as Engineering, Browser, Research, Data, Support, Twitter, Meta Ads, and Cold Outreach.
- A founder can see queued work before execution starts.
- Queue order matters, even though hidden prerequisites can prevent the top item from starting immediately.
- `Blocked`, `Needs Credits`, `Fixed`, `Couldn't Complete`, and `Rejected` are honest founder projections of deeper hidden execution truth rather than decorative UI copy.
- Night shift is a real background operating path separate from manual task clicks.
- Recurring work is real repeated work, not a cosmetic reminder system.
- A repaired task means the platform recovered an earlier miss inside the same scope; it does not mean the founder silently bought a second task.

The founder should **not** need to understand:

- `Run`
- `Session`
- prompt assembly
- connector binding internals
- mount-profile internals
- retry policy internals
- actual-cost accounting internals

## Hidden-System Contract

The hidden system must be modeled as this chain:

`platform ops -> product surfaces -> control plane -> runtime -> capabilities and connectors -> hidden workers -> storage`

Responsibilities split across that chain:

- `platform ops`
  - hidden supervisory layer above all per-company execution
  - monitors runtime health, failure patterns, routing accuracy, and cost baselines across the entire platform
  - clusters failures, guards against regressions, and proposes improvements
  - never visible to founders; consumes internal platform budget
- `product surfaces`
  - collect founder asks
  - project queue and task outcomes
  - render founder purchase, approval, and action surfaces
- `control plane`
  - normalize asks
  - shape tasks
  - assign the correct `worker_lane`
  - assign the correct `run_channel`
  - select the correct `execution_mode`
  - enforce admission and prerequisite checks before execution starts
  - request verification
  - request remediation when needed
- `runtime`
  - create and track `Session` and `Run` records
  - assemble bounded context
  - bind tool, capability, connector, and permission envelopes
  - dispatch one bounded execution attempt
  - persist artifacts and execution telemetry
- `capabilities and connectors`
  - constrain what a given run is allowed to do
  - distinguish internal mutation from external action
  - distinguish platform-owned from founder/company-owned integration posture
- `hidden workers`
  - perform bounded work inside the envelope chosen upstream
  - never act as the whole orchestration system by themselves
- `storage`
  - preserve task history, run history, approvals, artifacts, verification results, and actual-cost records

## In Scope

- family-level hidden architecture beneath founder chat and taskboard
- canonical runtime vocabulary for this family
- founder-visible contract versus hidden-system contract split
- system-layer boundaries
- cross-child invariants
- family-level state authority and ownership boundaries
- family-level transition meaning

## Out of Scope

- child-level field schemas beyond umbrella seams
- child-level queue algorithms
- child-level connector payloads
- child-level approval payload formats
- exact provider or transport choices
- build-spec implementation details

## Canonical Nouns

Every noun below has one canonical meaning in this family.

### `worker_lane`

- **Meaning:** the specialist executor family responsible for performing the bounded work
- **Canonical owner:** [control-plane/lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
- **Examples:** `engineering`, `browser`, `research`, `data`, `support`, `twitter`, `meta_ads_manager`, `cold_outreach`
- **Not to be confused with:** execution origin, billing lane, entitlement flags, founder board labels

### `run_channel`

- **Meaning:** how a task attempt entered execution
- **Canonical owner:** [control-plane/control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) for intake semantics, [control-plane/scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md) for scheduler-driven channels
- **Examples:** `manual`, `recurring`, `night_shift`, `remediation`
- **Not to be confused with:** specialist executor family or billing bucket

### `billing_lane`

- **Meaning:** the economic lane that funds or accounts for the work
- **Canonical owner:** [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- **Examples:** `task_credit` (manual/recurring tasks charged per credit), `subscription_autopilot` (night shifts and platform-initiated work funded by subscription entitlement, not manual credits), `ads_spend` (fully independent ads billing — founder deposits, platform takes 20%, rest goes to ad spend)
- **Not to be confused with:** worker identity or scheduler path

### `Task`

- **Meaning:** the durable founder-visible unit of work that appears on the board and keeps history across execution attempts
- **Canonical owner:** [control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- **Not to be confused with:** one attempt, one chat thread, one scheduler tick, or one artifact

### `Run`

- **Meaning:** one concrete execution attempt for a `Task`
- **Canonical owner:** [control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- **Not to be confused with:** the full durable task record or the founder-visible board card

### `Session`

- **Meaning:** the runtime container for one execution context only
- **Canonical owner:** [control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- **Not to be confused with:** founder chat as a catch-all umbrella for every system interaction

### `Repair`

- **Meaning:** same-scope remediation performed through additional run(s) on the original task after a miss
- **Canonical owner:** [control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)
- **Not to be confused with:** a second founder-visible purchased task

### `Artifact`

- **Meaning:** durable output, evidence, or proof produced by a run and linked to that run
- **Canonical owner:** [control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- **Not to be confused with:** a document, a report, or a memory layer entry

### `ApprovalRecord`

- **Meaning:** the stored approval lineage for risky work
- **Canonical owner:** [control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- **Not to be confused with:** founder intent in chat, general consent, or a permanent account-level trust flag

### `execution_mode`

- **Meaning:** which execution strategy the control plane selects before launching a run
- **Canonical values:** `deterministic`, `template_plus_params`, `full_agent`
- **Canonical owner:** [control-plane/control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) for selection; [control-plane/lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md) for lane-specific applicability
- **Not to be confused with:** `worker_lane` (who executes), `run_channel` (how execution entered), or `working_pattern_id` (lane-specific behavioral template)

### `working_pattern_id`

- **Meaning:** the lane-specific behavioral template that defines how a worker performs its bounded work (read-inspect-apply-verify cycle, synthesis cycle, etc.)
- **Canonical owner:** [control-plane/lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
- **Used by:** runtime (Session fields), verification (VerificationRecord), control-plane overview (runtime handoff request)
- **Not to be confused with:** `execution_mode` (strategy tier) or `prompt_family_id` (prompt assembly template)

### `ContextPacket`

- **Meaning:** bounded execution context assembled for one task/run
- **Canonical owner:** [control-plane/memory-context-tools-and-connectors.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/memory-context-tools-and-connectors.md)
- **Not to be confused with:** continuity memory, full company history, or tool inventory

### `PermissionSnapshot`

- **Meaning:** the concrete permission and approval envelope granted for one run
- **Canonical owner:** [control-plane/memory-context-tools-and-connectors.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/memory-context-tools-and-connectors.md)
- **Not to be confused with:** generic company trust level or founder intent in chat

### `failure_class`

- **Meaning:** canonical classification of why a run failed
- **Canonical values:** `infra_error`, `capability_miss`, `external_block`, `verification_reject`, `timeout`, `scope_overflow`, `policy_violation`, `connector_failure`
- **Canonical owner:** [control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)
- **Not to be confused with:** founder-visible failure labels like `Couldn't Complete`

## State Authority Map

This section exists to stop readers from deriving state from the wrong layer.

| State / field | Canonical or derived | Owner | Used by | Must not be used by |
|---|---|---|---|---|
| `worker_lane` | Canonical | `lane-and-agent-responsibility-model.md` | control plane, runtime, scheduler, reporting | billing as a substitute for economic lane |
| `run_channel` | Canonical | `control-plane-overview.md` + `scheduler-queue-night-shift-and-recurring.md` | admission, scheduler, reporting | lane routing as a substitute for executor family |
| `billing_lane` | Canonical | `billing-credits-and-subscription-state.md` | charging, accounting, ads separation | runtime as a substitute for executor family |
| `Task.status` | Canonical | `runtime-entities-and-task-lifecycle.md` | scheduler, dashboard projection, CEO explanation | founder UI as its own independent source |
| `Run.status` | Canonical | `runtime-entities-and-task-lifecycle.md` | verification, telemetry, retry logic | founder board copy as a substitute for attempt truth |
| `Session.status` | Canonical | `runtime-entities-and-task-lifecycle.md` | runtime context management | founder board as a substitute for task state |
| founder board bucket | Derived | `founder-dashboard-and-taskboard.md` | founder taskboard | runtime as a raw status enum |
| founder edge labels like `Blocked` or `Needs Credits` | Derived | `founder-dashboard-and-taskboard.md` | task cards, task detail, CEO explanation | hidden runtime schema |
| queue position | Canonical within queue projection | `scheduler-queue-night-shift-and-recurring.md` | founder reorder, scheduler selection | billing or verification |
| trial / subscription / hosting state | Canonical | `billing-credits-and-subscription-state.md` | billing, scheduler eligibility, founder gating | runtime task state as a substitute for company state |

## Canonical Family Invariants

These invariants must remain true across every child spec.

- CEO remains the only founder-facing orchestrator. Hidden specialist workers never become separate founder-facing personas.
- All execution demand normalizes through control-plane intake before runtime starts.
- `worker_lane`, `run_channel`, and `billing_lane` are separate concepts and must not be collapsed into a single overloaded field.
- A `Task` is durable. A `Run` is one attempt. A `Session` is one runtime context. `Repair` happens on the original task through additional run(s).
- Founder-visible task state is a projection of canonical runtime truth plus scheduler and billing gates; it is not a separate hidden source of truth.
- Queue presence is free. Credit charging happens when admitted execution starts.
- Active subscription with `0` manual credits keeps night-shift execution available while manual and recurring execution remain credit-gated.
- Same-scope remediation must not silently create a second founder-visible purchased task.
- Internal actual-cost truth stays hidden behind founder-safe credit language.
- Hidden platform services such as billing, OAuth management, memory sync, provisioning, and watchdog supervision must not be misdescribed as worker capabilities.
- Default company concurrency is one active execution slot. Night shift and manual execution share this slot and cannot run concurrently.
- Every run has hard termination limits: a turn budget (`maxTurns`) and watchdog time-based stall detection. "Bounded execution" means both limits exist.
- `execution_mode` must be selected before runtime dispatch. Not every task needs a full agent — `deterministic` and `template_plus_params` modes exist for standardized and semi-standardized work.
- A task can be `rejected` (explicitly removed from execution). This is a real terminal state, not a euphemism for failure.

## System Story

This is the required causal story for the full family.

1. A demand for work appears.
   - founder asks CEO
   - founder interacts with the dashboard
   - onboarding emits starter work
   - recurring work becomes due
   - night shift selects background work
   - remediation is triggered after verification failure
2. The control plane normalizes that demand into one or more bounded `Task` objects.
   - for founder-initiated work, governance estimates credit cost and returns a founder-safe quote before task creation
   - CEO may decompose large asks into multiple tasks, narrow scope, or refuse
3. The control plane assigns:
   - the correct `worker_lane`
   - the correct `run_channel`
   - the correct `execution_mode` (`deterministic`, `template_plus_params`, or `full_agent`)
   - the correct capability and connector envelope
   - the correct verification posture
4. Admission checks run before runtime starts.
   - prerequisites satisfied or not
   - approval required or not
   - credit-governed or subscription-governed or other billing lane
5. If admitted, runtime creates the execution context.
   - `Session`
   - `Run`
   - `ContextPacket` (bounded execution context)
   - `PermissionSnapshot` (permission and approval envelope)
   - compiled execution brief (prompt assembly from lane family, docs, memory, tools, guardrails)
   - mount and permission bindings
6. The hidden worker executes one bounded attempt within hard termination limits (`maxTurns` turn budget and watchdog time-based stall detection).
7. `Artifacts`, logs, and evidence are persisted.
8. Verification decides whether the task is truly complete, blocked, failed, or repair-needed.
9. Founder surfaces then project the result using task state, queue state, billing gates, and evidence-backed summaries.
10. Post-execution feedback loops run.
    - actual-cost record is written (hidden economic truth)
    - failure fingerprinting captures reusable signatures for failed runs
    - routing accuracy tracking updates agent-fit baselines
    - document and milestone updates fire as post-verification side effects when applicable
    - memory writes may persist new domain knowledge or learnings

## Cross-Family Transition Table

This umbrella table defines the family-level transition meanings. Child specs own the exact fields and side effects.

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| founder or scheduler demand | normalized `Task` | intake normalization | `control-plane-overview.md` | demand is in scope enough to shape | bounded task(s) created or existing task selected | if shaping is incomplete, remain in control-plane planning rather than inventing runtime state |
| queued `Task` | admitted execution | runtime handoff begins | `control-plane-overview.md` + `runtime-entities-and-task-lifecycle.md` | scope bounded, prerequisites satisfied, billing gate satisfied | `Session` and first `Run` created | if admission fails, task stays queued or becomes pre-start blocked rather than pretending execution began |
| queued `Task` | pre-start blocked posture | prerequisite intercept | `control-plane-overview.md` + `runtime-entities-and-task-lifecycle.md` | approval, auth, connector, dependency, or external prerequisite missing | founder sees blocked reason; no credit burn; no admitted run | when prerequisite resolves, return to queue admission |
| queued `Task` | credit-gated queued posture | execution-start charge gate fails | `billing-credits-and-subscription-state.md` + `scheduler-queue-night-shift-and-recurring.md` | `billing_lane` requires manual credits and none are available | founder sees `Needs Credits`; no run starts | when credits return, same task re-enters admission |
| active `Run` | in-run blocked posture | execution interrupted by dependency or external condition | `runtime-entities-and-task-lifecycle.md` | task already admitted and at least one run exists | run history preserved; founder sees blocked reason | only an already-admitted active context can resume directly |
| active `Run` | verification decision | worker stops and evidence exists | `verification-remediation-and-actual-cost-accounting.md` | run has produced enough evidence to judge | verification records outcome | if evidence is insufficient, task remains unresolved rather than called complete |
| verification decision | task completed | verification passes | `verification-remediation-and-actual-cost-accounting.md` + `runtime-entities-and-task-lifecycle.md` | evidence supports founder-visible completion | task projection updates; actual-cost written | terminal unless new task is created later |
| verification decision | repair path on original task | same-scope miss | `verification-remediation-and-actual-cost-accounting.md` | miss is inside original paid scope | remediation path created on original task; no new founder-visible purchased task | repair creates additional run(s) on same task |
| repair path | repaired task outcome | repair succeeds | `verification-remediation-and-actual-cost-accounting.md` + `runtime-entities-and-task-lifecycle.md` | repair evidence accepted | founder may see `Fixed`; failed history preserved | terminal for original task unless later superseded by new work |
| repair path | founder-decision or re-scope posture | stop-loss exceeded (max 100 repair attempts, or time/cost threshold) | `verification-remediation-and-actual-cost-accounting.md` | attempts/time/cost threshold exceeded | silent repair stops; further work requires founder decision or new task | new work only after explicit founder decision or re-scope |
| queued or failed `Task` | `rejected` | founder or platform removes from execution | `runtime-entities-and-task-lifecycle.md` | removal decision made | task leaves ordinary execution path; founder sees `Rejected` | terminal unless explicitly repeated as new task |

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “CEO is handling this.” | CEO can read control-plane state and route to hidden workers | CEO explains blocker or limitation instead of faking execution | Guaranteed founder interface; hidden success is best-effort |
| “This task is on the board.” | task normalization succeeded | ask stays in planning or is reframed honestly | Guaranteed if task was accepted into queue |
| “Queue order matters.” | scheduler recognizes founder order as primary visible selector | hidden gates can delay the top task, but do not erase queue order | Guaranteed as a visible prioritization input, not a guarantee of immediate start |
| “Blocked.” | task or run has a real hidden unmet prerequisite | founder sees the reason rather than fake progress | Guaranteed as honest projection of hidden state |
| “Needs Credits.” | billing lane is manual task credit and charge-on-start gate failed | task stays queued; no admitted run starts | Guaranteed as a founder-safe billing projection |
| “Fixed.” | same-scope remediation succeeded on the original task | founder instead sees blocked or couldn't-complete posture | Best-effort outcome; guaranteed that repair history is preserved honestly |
| “Night shift will keep working.” | subscription posture keeps night-shift eligibility on | scheduler may skip work that is out of envelope or blocked by prerequisites | Best-effort execution with real eligibility rule |
| “Couldn't Complete.” | attempted execution path did not succeed and is not yet repaired | founder sees failed posture with preserved history | Guaranteed honest failure projection |
| “Rejected.” | founder or platform explicitly removed the task | task leaves ordinary execution path | Guaranteed terminal state |

## Major Ambiguous Terms Resolved

### `lane`

Bare `lane` is forbidden as a canonical noun in this family.

Use one of:

- `worker_lane`
- `run_channel`
- `billing_lane`

### `status`

Bare `status` is forbidden unless the exact owning object is named.

Use one of:

- `Task.status`
- `Run.status`
- `Session.status`
- founder board bucket
- founder edge label
- subscription / hosting / trial state

### `blocked`

`blocked` is not one universal meaning.

Family-level meaning:

- a real hidden unmet prerequisite exists

Required split:

- pre-start blocked posture: no admitted run exists yet
- in-run blocked posture: an admitted run exists and progress was interrupted

Child specs must preserve this split even if founder surfaces collapse both to `Blocked`.

### `completed`

Bare `completed` is forbidden unless the layer is named.

Use one of:

- run finished
- verification passed
- task completed

This family treats verification as the final authority for founder-visible task completion.

### `live`

Do not use bare `live` in this family.

Use one of:

- currently executing
- public runtime online
- recent historical proof event
- persistent hosted surface online

### `ready`

Do not use bare `ready`.

Use exact language such as:

- prerequisites satisfied
- admitted for execution
- connector available
- approval granted
- billing gate satisfied

## Implementation Trap Notes

### Trap 1: using one field named `lane` for everything

- **Wrong assumption:** one `lane` field can encode worker family, billing posture, and scheduler origin.
- **Why it is wrong:** the same word is used in founder copy for multiple concepts and creates contradictory schemas.
- **Correct interpretation:** keep `worker_lane`, `run_channel`, and `billing_lane` separate.

### Trap 2: treating `Repair` as a second founder task

- **Wrong assumption:** same-scope remediation should create a second normal purchased task.
- **Why it is wrong:** it breaks founder trust, history continuity, and the locked same-scope repair rule.
- **Correct interpretation:** repair happens through additional run(s) on the original task.

### Trap 3: charging credits on queue or proposal

- **Wrong assumption:** queue creation is close enough to execution start.
- **Why it is wrong:** the founder-visible contract keeps planning and queue formation free.
- **Correct interpretation:** charge only when admitted execution starts in the correct billing lane.

### Trap 4: turning founder copy into hidden runtime enums

- **Wrong assumption:** labels like `Needs Credits` or `Fixed` should become raw runtime status fields.
- **Why it is wrong:** they are founder-safe projections that flatten deeper hidden truth.
- **Correct interpretation:** keep canonical runtime state in runtime children and derive founder copy downstream.

### Trap 5: treating night shift, recurring work, and manual execution as the same path

- **Wrong assumption:** all three are just tasks with a schedule bit.
- **Why it is wrong:** they differ in entry path, billing logic, entitlement posture, and founder promise.
- **Correct interpretation:** separate them with `run_channel` and `billing_lane` instead of flattening them.

## Sibling Ownership and Reconciliation Rules

### Ownership rule

- this umbrella owns:
  - family vocabulary
  - family invariants
  - founder-versus-hidden contract split
  - cross-family state authority and boundary rules
- child specs own:
  - detailed schemas
  - detailed transitions
  - detailed policy tables
  - field-level payloads

### Required sibling alignment

- [control-plane/control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md)
  - now uses `worker_lane` and `run_channel` consistently for intake and handoff semantics
- [control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
  - now preserves `Task` versus `Run` versus `Session`, keeps repair on the original task, and splits `blocked_pre_start` from `blocked_in_run`
- [control-plane/lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
  - now owns `worker_lane` only, not scheduler origin or billing posture
- [control-plane/scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md)
  - now owns `run_channel` behavior and recurring due-work materialization without redefining task identity
- [control-plane/memory-context-tools-and-connectors.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/memory-context-tools-and-connectors.md)
  - now keeps continuity memory, bounded context packets, callable tools, injected aids, and platform services distinct
- [control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)
  - now keeps verification as final authority over founder-visible completion, keeps same-scope repair on the original task, and defines repair stop-loss boundaries
- [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
  - now owns `billing_lane`, company-state authority, execution charging seams, and continuity posture without redefining runtime task identity
- [onboarding-bootstrap.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/onboarding-bootstrap.md)
  - now aligns bootstrap proof, startup-doc creation timing, starter-task derivation, and trial handoff with the control-plane family
- [roadmap-and-documents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/roadmap-and-documents.md)
  - now aligns roadmap truth, active milestone, and light shared plan with the task-routing and dashboard projections
- [founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md)
  - now keeps founder wording and shell projections layered over runtime and billing truth instead of redefining it
- [live-wall-and-projections.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/live-wall-and-projections.md)
  - now separates current live-status projection from historical proof feeds and gates current public liveness by hosting state
- [ceo-chat-and-founder-conversation.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/ceo-chat-and-founder-conversation.md)
  - owns the CEO 10-step decision model, credit quoting governance handoff, free planning lane, rate limiting, and task decomposition rules that feed into control-plane intake
- [platform-ops-and-self-healing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/platform-ops-and-self-healing.md)
  - owns the 9 hidden platform-side agents (watchdog, failure fingerprinter, known-issue registry, regression guard, etc.) that supervise control-plane and runtime health across all companies

### Final family reconciliation note

At this point the control-plane family is internally stabilized at the umbrella level:

- `worker_lane` = who executes
- `run_channel` = how execution entered
- `billing_lane` = which economic lane funds/accounts for it
- `execution_mode` = which execution strategy (`deterministic` / `template_plus_params` / `full_agent`)
- `working_pattern_id` = lane-specific behavioral template
- `Task` / `Run` / `Session` / `Artifact` / `Repair` / `ApprovalRecord` are no longer overloaded across sibling specs
- `ContextPacket` and `PermissionSnapshot` are the runtime handoff objects assembled by the memory/tools child
- `failure_class` is the canonical taxonomy for why runs fail
- verification final authority, recurring due-task materialization, bounded context packets, and founder-safe dashboard/live projections now read as one coherent system rather than competing models
- CEO/chat spec owns task shaping and governance upstream; platform-ops spec owns supervisory health downstream

Any later changes to these shared contracts should update this umbrella first and then cascade to children.

## Acceptance Criteria

- A new reader can explain the difference between `worker_lane`, `run_channel`, and `billing_lane` without guessing.
- A new reader can explain the difference between `Task`, `Run`, `Session`, `Artifact`, and `Repair` without guessing.
- A new reader can explain the difference between `execution_mode` and `working_pattern_id` without guessing.
- Founder-visible queue, blocked, rejected, repaired, and credit-gated language maps to named hidden-system truth.
- Verification is clearly the final authority for founder-visible task completion.
- Same-scope remediation is clearly kept on the original task rather than becoming a second purchased task.
- Repair has an explicit stop-loss: max 100 attempts, with time and cost thresholds TBD.
- Default company concurrency is one active slot; night shift and manual share the same slot.
- Every run terminates via turn budget or watchdog stall detection — "bounded" means both limits exist.
- This umbrella no longer relies on bare `lane`, `status`, `completed`, `blocked`, `live`, or `ready` in ambiguous ways.

## Plain-Language New-Reader Tests

- If a founder sees `Needs Credits`, is that a runtime task status or a billing projection on a queued task?
- If a task is `Blocked`, did execution ever start, or is it still waiting for admission?
- If a run fails and the platform fixes it overnight, does the founder now have two tasks or one repaired original task?
- If a night shift runs with `0` manual credits, which concept explains that: `worker_lane`, `run_channel`, or `billing_lane`?
- If a spec sentence says “completed,” can the reader tell whether it means run finished, verification passed, or task completed?
- What stops a run from running forever? (Two answers: turn budget and watchdog)
- Can two tasks execute concurrently for the same company? (No — one active slot by default)
- What is the difference between `execution_mode` and `worker_lane`? (Strategy tier vs. executor family)
- What happens if repair keeps failing — does it retry forever? (No — stop-loss at 100 attempts)
- Can a founder reject a task, and is that the same as failure? (Yes they can; no, it is a separate terminal state)

If the answer to any of these is “not from this spec,” the family is still ambiguous.

## Implementation Freedom

- exact queue backend
- exact job transport
- exact prompt composition format
- exact connector storage schema
- exact provider choice
- exact retry backoff tuning

## Traceability

### Source topics

- [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
- [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
- [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
- [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)
- [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)

### Source facts

- `FACT-CAP-022`
- `FACT-KNOW-026`
- `FACT-EXEC-005`
- `FACT-EXEC-010`
- `FACT-EXEC-011`
- `FACT-EXEC-012`
- `FACT-EXEC-012A`
- `FACT-EXEC-012B`
- `FACT-EXEC-026`
- `FACT-MON-010`
- `FACT-MON-011`
- `FACT-MON-016`

### Source decisions

- `DEC-TERM-002`
- `DEC-TERM-003`
- `DEC-CHAN-002`
- `DEC-CEO-002`
- `DEC-CEO-003`
- `DEC-SCHED-001`
- `DEC-NIGHT-001`
- `DEC-NIGHT-002`
- `DEC-NIGHT-003`
- `DEC-EXEC-002`
- `DEC-EXEC-003`
- `DEC-EXEC-004`
- `DEC-CRED-003`

### Primary evidence

- [Polsia_Exact_Architecture_Details.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/Polsia_Exact_Architecture_Details.md)
  - control plane versus runtime split
  - company-local queue and one-task-per-night night shift behavior
  - common failure families
  - task-splitting and actual-cost logic

### Claim-to-anchor audit

- `worker_lane`, `run_channel`, and `billing_lane` must stay separate:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-EXEC-012A`
    - `FACT-EXEC-012`
    - `FACT-MON-010`
  - decisions:
    - `DEC-TERM-002`
    - `DEC-NIGHT-001`
    - `DEC-CRED-003`

- `Task`, `Run`, `Session`, and `Repair` have separate meanings and repair stays on the original task:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-012B`
  - decisions:
    - `DEC-TERM-003`
    - `DEC-NIGHT-002`

- CEO is the only founder-facing orchestrator while specialist workers remain hidden:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
  - facts:
    - `FACT-CAP-022`
  - decisions:
    - `DEC-CHAN-002`

- founder-visible blocked and failed outcomes must come from real runtime truth rather than dashboard-only labels:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-010`
    - `FACT-EXEC-011`
  - decisions:
    - `DEC-EXEC-002`
    - `DEC-EXEC-003`

- active subscription with `0` manual credits keeps night-shift execution available while recurring work stays credit-gated:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-MON-010`
    - `FACT-MON-011`
    - `FACT-EXEC-012`
  - decisions:
    - `DEC-NIGHT-001`
    - `DEC-NIGHT-003`
    - `DEC-CRED-003`

- the `~4 hour` idea is only a scoping heuristic, while actual-cost accounting is the hidden economic truth:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-MON-016`
    - `FACT-EXEC-026`
  - decisions:
    - `DEC-CEO-003`
    - `DEC-EXEC-004`

## Change Log

- `2026-04-06`: seeded internal-system umbrella for the hidden execution layer
- `2026-04-12`: rebuilt the umbrella to lock canonical runtime vocabulary, founder-visible versus hidden-system contract boundaries, state authority, cross-family transitions, founder promise mapping, and claim-to-anchor coverage before rebuilding child specs
- `2026-04-13`: applied 3-sweep audit fixes — added `execution_mode`, `working_pattern_id`, `Artifact`, `ContextPacket`, `PermissionSnapshot`, `failure_class` to vocabulary; added platform ops to system chain; added governance/quoting, execution mode, bounded execution, and post-execution feedback to system story; added concurrency, bounded-execution, and rejection invariants; added stop-loss and rejection transitions; added CEO/chat and platform-ops sibling references
