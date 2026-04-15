# Spec: Control Plane Overview and Orchestration

- `Spec ID`: `SPEC-CTRL-101`
- `Status`: rebuilt
- `Subsystem`: control plane overview and orchestration
- `Classification`: internal system
- `Sensitivity`: internal only
- `Parent spec`: [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
- `Parent build spec`: [specs/build/control-plane/control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/control-plane/control-plane-overview.md)

## Purpose

Define the top-level orchestration layer that sits between founder-facing product surfaces and runtime execution.

This child spec owns:

- control-plane intake normalization
- founder-visible CEO versus hidden control-plane module boundaries
- task shaping and routing seams
- admission and interception seams before runtime starts
- verification-request seam after runtime produces evidence
- the exact boundary where control-plane responsibility ends and runtime responsibility begins

This child spec does **not** own runtime entity definitions, runtime state enums, queue algorithms, or billing-state definitions. Those belong to sibling specs.

## Founder-Visible Contract

The founder should experience the control plane like this:

- the founder talks to CEO, not to a public cast of worker personas
- CEO scopes, splits, routes, sequences, and explains work
- CEO can push back on oversized or out-of-envelope asks before execution starts
- CEO can explain work in founder-safe task and credit language
- CEO appears context-rich because it sits on top of control-plane continuity rather than because every worker has universal live memory access
- blocked, credit-gated, or deferred work is surfaced honestly rather than pretending the system already started executing it

The founder does **not** need to see:

- `worker_lane`
- `run_channel`
- runtime handoff packets
- approval payload internals
- connector binding internals
- prompt assembly internals

## Hidden-System Contract

The control plane is the decision and handoff layer between:

- `product surfaces`
- `runtime`

Its canonical responsibilities are:

- normalize work demand from founder or platform surfaces
- shape bounded `Task` units
- assign the correct `worker_lane`
- assign the correct `run_channel`
- check capability fit before promising execution
- intercept on approval, connector, prerequisite, or billing-gate issues before runtime start
- request verification after runtime evidence exists
- request remediation or follow-up work when verification or policy says the work is not truly done

The control plane does **not** directly own:

- `Task`, `Run`, or `Session` definitions
- runtime state enums
- low-level tool dispatch
- raw model execution loops
- storage internals
- billing ledgers or subscription states
- deployed company-app uptime itself

## In Scope

- CEO orchestration model
- hidden planning and verification module boundaries
- intake sources and normalization
- task shaping and routing seams
- admission seams before runtime start
- runtime handoff seam
- verification request seam
- cross-layer boundary between product surfaces, control plane, runtime, and platform services

## Out of Scope

- runtime field schemas
- task lifecycle enums
- queue fairness and concurrency tuning
- connector schema internals
- detailed approval schema
- UI layout details
- build-spec implementation details

## Canonical Noun Imports

This child imports the family vocabulary from the umbrella spec and uses only the nouns it needs.

### `worker_lane`

- **Imported meaning:** specialist executor family chosen for the task
- **Owned by:** [lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
- **Used here for:** routing target selection only
- **Must not be used here for:** execution origin, billing posture, or entitlement

### `run_channel`

- **Imported meaning:** how execution enters the system
- **Owned by:** this spec for intake semantics; [scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md) for scheduler-driven behavior
- **Examples used here:** `manual`, `recurring`, `night_shift`, `remediation`
- **Must not be used here for:** worker identity or billing logic

### `billing_lane`

- **Imported meaning:** economic lane that funds or accounts for the work
- **Owned by:** [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- **Used here for:** admission and founder-safe explanation seams only
- **Must not be used here for:** runtime identity or routing target

### `Task`, `Run`, `Session`, `Repair`

- **Imported meanings:** locked by the umbrella and runtime/verification children
- **Used here for:** orchestration seams only
- **Must not be redefined here**

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| intake request | Canonical | this spec | normalize work demand | treated as runtime state |
| `worker_lane` selection | Canonical | lane-responsibility child | routing target | overloaded into execution origin or billing |
| `run_channel` selection | Canonical | this spec + scheduler child | intake/admission meaning | overloaded into worker identity |
| admission decision | Canonical seam | this spec | decide whether runtime may start | redefine billing or runtime state models |
| `billing_lane` result | Canonical elsewhere | billing umbrella | explain whether manual-credit gate applies | redefine pricing or ledger truth |
| `Task.status` | Canonical elsewhere | runtime child | consumed for explanation and follow-up | defined or mutated here as raw state authority |
| founder board labels | Derived elsewhere | dashboard child | explained by CEO | used as hidden runtime schema |
| verification result | Canonical seam | verification child | consumed to decide follow-up work | redefined here as full verification policy schema |

## Structural Model

### System layer chain

The system must be read in this order:

1. `product surfaces`
   - onboarding
   - CEO chat
   - founder dashboard / taskboard
   - recurring configuration surfaces
2. `control plane`
   - CEO coordinator
   - planning module
   - routing and admission
   - approval interception
   - verification request
3. `runtime`
   - `Session` creation
   - `Run` attempts
   - bounded execution
   - artifact persistence
4. `capabilities and connectors`
   - governed action surfaces
   - connector bindings
   - permission and risk envelope
5. `hidden workers`
   - bounded specialist execution
6. `storage and platform services`
   - task history
   - reports and artifacts
   - approval lineage
   - memory sync
   - billing and OAuth state
   - provisioning

This ordering matters because the control plane is not the worker, and the worker is not the billing or provisioning system.

### Intake families

The control plane accepts two intake families.

#### Founder-initiated intake

- CEO chat ask
- founder task creation or run request
- founder recurring-definition change
- onboarding-produced task demand after bootstrap shaping

#### Platform-initiated intake

- due recurring execution candidate
- night-shift selection candidate
- verification-triggered remediation demand
- unblock / retry / re-admission demand after prerequisites change

Every intake must become a normalized control-plane request before runtime starts. No product surface or worker should bypass this seam and create raw execution directly.

### Founder-facing versus hidden module boundary

#### `ceo_coordinator`

- the only founder-facing orchestrator
- explains scope, credits, queueing, and blockers in founder-safe language
- may propose, narrow, split, defer, or reject work before execution

#### `planning_module`

- hidden module under CEO
- converts vague asks into bounded tasks and dependency order
- does not perform external side effects

#### `routing_and_admission`

- hidden control-plane seam
- assigns `worker_lane`
- assigns `run_channel`
- checks capability fit, connector prerequisites, approvals, and billing-gate posture before runtime start

#### `verification_request`

- hidden control-plane seam after runtime evidence exists
- asks the verification subsystem to judge whether founder-visible completion is justified

These hidden seams must not be described as separate founder-facing agent personas.

### Handoff boundary into runtime

The control plane ends at **execution-ready runtime handoff**.

Control plane responsibilities stop at:

- intake normalization
- task shaping
- milestone-aware routing
- capability-envelope check
- prerequisite and approval interception
- billing-gate admission check
- runtime handoff packet creation
- verification request creation

Runtime responsibilities begin at:

- `Session` creation
- `Run` creation
- bounded context assembly
- tool and connector binding
- execution dispatch
- artifact persistence
- execution telemetry persistence

## Control-Plane System Story

1. A founder or platform surface creates demand for work.
2. Control plane normalizes that demand into a request with source, scope, and company context.
3. CEO/planning determines whether the ask is:
   - in envelope as-is
   - needs splitting
   - needs clarification
   - should be reframed or rejected honestly
4. Routing chooses the correct `worker_lane` and `run_channel`.
5. Admission checks whether execution may start now:
   - capability fit
   - dependency readiness
   - approval posture
   - connector/auth posture
   - billing-gate posture
6. If admission passes, control plane creates a runtime handoff packet.
7. Runtime executes and returns evidence.
8. Control plane requests verification where policy requires it.
9. Based on verification or policy outcome, control plane may:
   - accept completion
   - surface blocked/failure explanation
   - request same-scope remediation
   - create follow-up work

## Data and Interface Contract

### Control-plane request

- `request_id`
- `company_id`
- `origin_surface`
- `initiator_type`
- `raw_goal`
- `founder_intent_summary`
- `active_milestone_ref`
- `approval_context`
- `billing_context`

### Planned task bundle

- `bundle_id`
- `company_id`
- `source_request_id`
- `active_milestone_id`
- `tasks`
- `routing_summary`
- `credit_estimate_summary`
- `requires_founder_input`

### Routing decision

- `task_id`
- `worker_lane`
- `run_channel`
- `task_type`
- `execution_mode`
- `capability_requirements`
- `connector_requirements`
- `dependency_summary`
- `approval_requirement`
- `billing_lane_ref`
- `credit_admission_result`
- `verification_policy`

### Approval interception request

- `task_id`
- `company_id`
- `worker_lane`
- `risk_class`
- `approval_reason`
- `approval_surface`
- `approval_payload_ref`
- `approval_state_ref`
- `requested_at`

### Runtime handoff request

- `task_id`
- `company_id`
- `worker_lane`
- `run_channel`
- `working_pattern_id`
- `execution_mode`
- `context_packet_version`
- `tool_mount_profile_id`
- `prompt_assembly_spec_id`
- `permission_snapshot_id`
- `capability_bindings`
- `connector_bindings`
- `platform_service_bindings`
- `verification_policy`
- `cost_policy_ref`

### Verification request

- `task_id`
- `run_id`
- `verification_policy`
- `expected_outcomes`
- `artifact_refs`
- `founder_visible_claims_under_review`

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| raw founder/platform demand | normalized control-plane request | intake arrives | this spec | demand is attributable to a company and surface | request record created | if request is underspecified, stay in clarification/shaping rather than jump to runtime |
| normalized request | planned task bundle | planning module shapes work | this spec | founder intent sufficiently understood | bounded task bundle created or existing task selected | if work is too large, split before routing |
| planned task bundle | routing decision | routing begins | this spec | capability envelope check passes enough to continue | `worker_lane` and `run_channel` chosen | if envelope fails, reframe or reject honestly |
| routing decision | approval intercept | approval-sensitive work detected | this spec | risky action or spend-sensitive action needs approval | approval request emitted; runtime start blocked | once approval arrives, task returns to admission |
| routing decision | prerequisite intercept | auth, connector, dependency, or external prerequisite missing | this spec | missing prerequisite detected | founder gets honest blocked reason; no runtime start | once prerequisite resolves, task returns to admission |
| routing decision | credit-gated hold | execution-start billing gate fails | this spec consuming billing rules | `billing_lane` requires manual credit and none exists | founder sees `Needs Credits`; no runtime start | when credits return, task re-enters admission |
| routing decision | runtime handoff | admission passes | this spec | capability, prerequisite, approval, and billing gate all satisfied | runtime handoff packet created | runtime takes over from here |
| runtime evidence exists | verification request | verification policy requires judgment | this spec | run has produced evidence | verification request emitted | if no verification needed, downstream completion logic still consumes runtime truth, not founder copy |

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “CEO can handle this.” | ask is inside capability envelope or can be split honestly | CEO narrows, reframes, or says no | Guaranteed as honest scoping, not guaranteed execution success |
| “I’ve queued this task.” | task shaping succeeded | ask stays in clarification or is rejected honestly | Guaranteed if control plane accepted the work into queue |
| “This should run next.” | queue order plus admission gates permit start | task stays queued or blocked with reason | Best-effort sequencing subject to hidden gates |
| “This is blocked.” | control plane or runtime found a real unmet prerequisite | founder sees blocker instead of fake progress | Guaranteed honest projection |
| “This needs credits.” | `billing_lane` for this work is manual task credit and charge-on-start gate failed | task stays queued with no runtime start | Guaranteed honest billing projection |
| “This is being fixed.” | same-scope remediation was actually triggered | founder sees failed or blocked posture instead | Best-effort remediation outcome |

## Edge Cases and Failure Handling

- CEO must not create one giant task when the ask obviously spans multiple bounded outcomes.
- Control plane must not route work into a `worker_lane` that the capability matrix excludes.
- Control plane must not promise runtime behavior that connector/auth/site-tier constraints cannot support.
- Approval-sensitive work must stop at approval interception, not leak into execution.
- Control plane must not treat founder-friendly labels like `Blocked` or `Needs Credits` as raw runtime-state ownership.
- Control plane must not assume agent-to-agent live delegation. Coordination happens through task and queue surfaces, not through a subagent tree.

## Implementation Trap Notes

### Trap 1: using `lane` everywhere

- **Wrong assumption:** routing can keep using a single field called `lane`.
- **Why it is wrong:** this child spec talks about routing target, execution origin, and billing gate, which are different concepts.
- **Correct interpretation:** use `worker_lane`, `run_channel`, and `billing_lane_ref` separately.

### Trap 2: letting control plane redefine runtime

- **Wrong assumption:** because the control plane decides admission, it owns `Task.status`, `Run.status`, and runtime entity meaning.
- **Why it is wrong:** runtime child owns the canonical entity and state model.
- **Correct interpretation:** this child owns the seam into runtime, not runtime-state truth itself.

### Trap 3: treating CEO explanations as direct billing inspection

- **Wrong assumption:** CEO directly inspects billing internals.
- **Why it is wrong:** the deeper source says the CEO/control surface observes Layer 3 behavior through limited Layer 2 context.
- **Correct interpretation:** founder-safe billing explanation is a control-plane presentation layer over hidden billing truth.

### Trap 4: allowing workers to bypass control-plane seams

- **Wrong assumption:** a worker can just create execution directly because it has workflow tools.
- **Why it is wrong:** that recreates the exact separation-of-concerns weakness the rebuild is supposed to remove.
- **Correct interpretation:** all execution still enters through normalized control-plane seams.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- umbrella spec owns canonical family vocabulary and invariant meanings
- runtime child owns `Task`, `Run`, `Session`, `ApprovalRecord`, and runtime-state truth
- lane child owns `worker_lane` inventory and responsibility boundaries
- scheduler child owns queue behavior and scheduler-side `run_channel` behavior
- billing umbrella owns `billing_lane` and execution-charge semantics
- dashboard child owns founder copy and surface projection rules
- verification child owns the final judgment policy and same-scope remediation rules

### Reconciliation notes

- this rebuilt child now uses `worker_lane` and `run_channel` at the seam level instead of bare `lane`
- this child no longer claims to own runtime state definitions
- sibling cleanup completed: runtime child uses `worker_lane`, scheduler child uses `run_channel`, billing umbrella uses `night_shift_eligible`

## Acceptance Criteria

- the spec contains no ambiguous bare `lane` in canonical control-plane logic
- the spec distinguishes `worker_lane` from `run_channel`
- the spec references `billing_lane` only as an external admission/economic seam
- the spec makes control-plane ownership stop at runtime handoff
- the spec clearly separates founder CEO contract from hidden planning/routing/admission/verification seams
- the spec no longer redefines `Task`, `Run`, `Session`, or `Repair`

## Plain-Language New-Reader Tests

- What does the control plane own that runtime does not?
- When does a founder ask become a task bundle?
- When does a task become a runtime handoff?
- When this spec chooses a path, is it choosing `worker_lane` or `run_channel`?
- Does approval happen before runtime starts or inside runtime?
- Does this file define runtime state, or only the seam into runtime?

If a new reader cannot answer those directly from this file, the spec is still ambiguous.

## Implementation Freedom

- exact service boundaries between CEO coordinator and planning module
- exact message transport between control plane and runtime
- exact prompt composition internals
- exact approval UX surface

## Traceability

### Source topics

- [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
- [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
- [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
- [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)

### Source facts

- `FACT-CAP-022`
- `FACT-KNOW-026`
- `FACT-EXEC-004`
- `FACT-EXEC-005`
- `FACT-EXEC-010`
- `FACT-EXEC-011`
- `FACT-EXEC-012A`
- `FACT-EXEC-012B`
- `FACT-EXEC-026`

### Source decisions

- `DEC-TERM-002`
- `DEC-TERM-003`
- `DEC-CHAN-002`
- `DEC-CEO-002`
- `DEC-CEO-003`
- `DEC-CAP-001`
- `DEC-CAP-003`
- `DEC-EXEC-002`
- `DEC-EXEC-004`

### Primary evidence

- [Polsia_Exact_Architecture_Details.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/Polsia_Exact_Architecture_Details.md)
  - `23.2 Control Plane vs Runtime Plane`
  - `23.3 Agent Coordination Reality`
  - control-plane and platform-service layer split

### Claim-to-anchor audit

- CEO is the only founder-facing orchestrator while specialist workers remain hidden:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
  - facts:
    - `FACT-CAP-022`
  - decisions:
    - `DEC-CHAN-002`

- this child must separate `worker_lane`, `run_channel`, and `billing_lane` rather than collapse them:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-012A`
  - decisions:
    - `DEC-TERM-002`

- this child must not redefine `Task`, `Run`, `Session`, or `Repair`:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-012B`
  - decisions:
    - `DEC-TERM-003`

- control-plane continuity is stronger than worker continuity because CEO reads memory more directly while workers get bounded packets:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
  - facts:
    - `FACT-KNOW-026`
  - decisions:
    - `DEC-CEO-002`

- founder-safe task and credit explanation belongs to CEO/control plane, while hidden actual-cost truth stays elsewhere:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-EXEC-004`
    - `FACT-EXEC-026`
  - decisions:
    - `DEC-CEO-003`
    - `DEC-EXEC-004`

- control plane and runtime are separate layers, and already-deployed company apps can remain up while autonomous operation degrades:
  - primary evidence:
    - [Polsia_Exact_Architecture_Details.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/Polsia_Exact_Architecture_Details.md)
  - decisions:
    - `DEC-EXEC-004`

## Change Log

- `2026-04-06`: seeded initial control-plane overview packet
- `2026-04-12`: rebuilt the control-plane child spec to align with the umbrella vocabulary and authority model, separate control-plane seams from runtime truth, and lock intake/admission/handoff semantics before later child cleanup
