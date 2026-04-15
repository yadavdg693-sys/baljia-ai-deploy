# Baljia Agentic System Development Plan

## Purpose

This document explains how Baljia should be developed from its current state into a stronger production-grade agentic platform, using patterns from `C:\Users\Vaishnavi\My_Projects\clude_true\agentic_reference` while staying aligned with Baljia’s current architecture and locked product decisions.

## Core principle

**Do not change the founder experience unless necessary. Improve the internal execution model.**

That means Baljia should preserve:
- founder onboarding shape
- CEO chat as the primary founder interface
- specialist-agent concept
- task proposal and approval flow
- credit-based execution model
- live wall / public proof concept
- document suggestion review model

But internally, Baljia should become:
- more modular
- safer
- easier to debug
- easier to extend
- less route-centric
- more worker-oriented
- more explicit about permissions, planning, and verification

---

## What the reference folder makes clear

From the reference pack, the strongest recurring pattern is that a serious agentic system is not just prompts plus tools. It needs explicit subsystems for:
- runtime core
- session lifecycle
- task planning and decomposition
- tool/capability registry
- memory and context assembly
- permission and approval handling
- long-running worker execution
- remote orchestration boundaries
- connector governance
- context compaction and summaries

This maps directly to Baljia’s current gaps.

---

## Current Baljia strengths to preserve

Baljia already has strong product and architecture intent:
- good documentation
- clear 4-layer topology in the technical spec
- strong task/governance concept
- clear specialist-agent catalog
- useful database shape for tasks, reports, documents, memory, billing, failures
- explicit verification model
- strong founder-facing product surface
- strong distinction between free planning and paid execution

So the goal is not to rethink the product from scratch.

The goal is to turn the current implementation into a cleaner **agent platform** underneath the existing product.

---

## Main problems to solve next

### 1. Runtime logic is too concentrated
Baljia currently relies too much on web-app-centric agent code and large control-center files.

### 2. Routes, orchestration, and execution are too close together
API routes should not carry orchestration intelligence or long-running execution responsibility.

### 3. Agent capabilities are too hardcoded
Tool wiring should come from governed definitions and registry metadata, not scattered direct code paths.

### 4. Worker execution needs stronger isolation
Execution-heavy work should not depend on the Next.js app runtime shape.

### 5. Memory and context are conceptually good but operationally thin
Workers need bounded context packets, durable summaries, better retrieval, and cleaner shared/private separation.

### 6. Safety must move from scattered checks to a first-class permission system
Risky actions, connector access, and cross-service privileges need stronger central control.

---

## Recommended target architecture for Baljia

```text
src/
  product/
    app/
    dashboard/
    onboarding/
    founder-chat/
    billing/
    livewall/
    roadmap/

  runtime/
    engine/
    sessions/
    prompts/
    permissions/
    compaction/
    audit/
    api-runtime/

  orchestration/
    planning/
    routing/
    tasks/
    scheduling/
    verification/
    remediation/
    onboarding/

  agents/
    definitions/
    coordinator/
    planner/
    verifier/
    lanes/

  capabilities/
    registry/
    browser/
    research/
    engineering/
    data/
    support/
    twitter/
    ads/
    outreach/
    documents/
    memory/
    billing/

  connectors/
    registry/
    auth/
    transports/
    resources/
    actions/
    permissions/
    operator-state/

  memory/
    company/
    session/
    task/
    retrieval/
    sync/
    secret-filtering/

  workers/
    queue/
    dispatcher/
    execution/
    browser/
    verification/
    scheduler/
    bridge/

  platform/
    auth/
    db/
    queues/
    events/
    telemetry/
    integrations/
    storage/
```

This matches the direction implied by the Baljia docs and the reference system:
- **product** handles founder-facing UX and projections like dashboard, roadmap rail, and live wall
- **runtime** handles agent/session execution and model-call lifecycle
- **orchestration** handles planning, routing, verification, retries, scheduling, and onboarding control flow
- **agents** defines the runnable control-plane and specialist worker roles
- **capabilities** defines governed action surfaces
- **connectors** governs integration auth, transport, resources, actions, and permissions
- **memory** handles durable company/session/task memory and retrieval
- **workers** handles long-running execution outside the request path
- **platform** handles infra and shared services

---

## Core internal contracts Baljia should standardize early

Before adding more agent behavior, Baljia should lock the core runtime objects.

### 1. Session
A durable run context.

Required fields:
- `id`
- `company_id`
- `session_type`
- `initiator_type`
- `status`
- `runtime_mode`
- `agent_definition_id`
- `task_id` if applicable
- `parent_session_id` if delegated
- `permissions_snapshot`
- `context_packet_version`
- `started_at`
- `ended_at`

### 2. Run
One execution attempt inside a session.

Required fields:
- `id`
- `session_id`
- `attempt_number`
- `executor_backend`
- `status`
- `started_at`
- `ended_at`
- `failure_class`
- `stop_reason`

### 3. Task
The orchestration unit underneath the dashboard card.

Add or standardize fields for:
- `lane`
- `risk_class`
- `approval_state`
- `verification_state`
- `dependencies`
- `created_from`
- `cost_policy`
- `credit_policy`

### 4. Artifact
Durable outputs of work.

Examples:
- reports
- document patches
- deployment receipts
- screenshots
- logs
- verification summaries
- external action receipts

Required fields:
- `id`
- `task_id`
- `run_id`
- `artifact_type`
- `uri`
- `summary`
- `structured_metadata`
- `visibility`
- `created_at`

### 5. Agent Definition
Declarative, inspectable, versioned role definition.

### 6. Capability
Governed action surface the runtime dispatches.

### 7. Connector
Governed integration object with owner scope, auth type, transport type, action/resource surfaces, risk class, and tenant scope.

### 8. Approval Record
Stored approval for risky actions with scope and expiry.

### 9. Event
The projection unit for live wall, dashboard state, founder inspection, and audit trails.

### 10. Context Packet
Versioned per-run context bundle made of current task, active milestone, relevant docs, recent artifacts, connector availability, approvals, and selected memory.

These contracts will keep Baljia from letting UI routes, prompt strings, or one-off services become the architecture.
---

## What Baljia should build first

## 1. Extract a runtime core

Baljia should introduce a dedicated runtime layer for:
- model loop execution
- tool dispatch
- session state
- stop/interruption handling
- prompt assembly entrypoints
- runtime mode handling
- execution audit traces

### Why this matters
Right now the architecture conceptually separates product, orchestration, and services, but the implementation shape still risks mixing them together.

### Result
The same runtime core can power:
- CEO chat sessions
- planning sessions
- worker execution sessions
- verification runs
- recurring task runs
- night shifts

---

## 2. Make agent definitions declarative

Baljia should replace hardcoded agent wiring with structured agent definitions.

Each agent definition should include:
- id
- name
- role
- execution style
- default model
- max turns
- allowed capabilities
- memory scope
- planning policy
- verification policy
- approval rules
- allowed connectors
- risk profile

### Why this matters
This makes agent evolution safer and easier than editing one large runtime file whenever a tool, policy, or prompt changes.

### Example Baljia benefit
- Research agent can be upgraded to Tavily-backed read-only web without fragile prompt-only changes.
- Engineering agent can cleanly support deterministic, template-plus-params, and full-agent modes.

---

## 3. Build a capability registry

Baljia already has MCP/tool concepts in the architecture docs. It should take the next step and make capabilities first-class.

Each capability should have metadata like:
- capability name
- owning module
- input/output schema
- risk level
- side-effect class
- approval requirement
- audit tags
- required OAuth or credential state
- allowed agent list
- safe/unsafe visibility rules

### Why this matters
This solves several issues at once:
- hardcoded tool sprawl
- uneven safety enforcement
- poor observability
- weak capability readiness checks
- prompt/tool mismatches

### Important Baljia rule
Configured mount must not be treated as actual callable capability. The registry should be the source of truth.

### Capability-envelope rule
Baljia should scope roadmap generation, CEO promises, and execution planning from:
1. founder intent
2. company archetype
3. primitive recipe
4. capability matrix

That prevents the system from promising business milestones that Baljia cannot directly build, directly operate, or materially improve.
---

## 4. Separate orchestration from execution

This is one of the most important changes.

### Orchestration should own
- task creation
- decomposition
- approval gating
- queueing
- assignment
- retries
- failure classification
- verification transitions
- remediation routing

### Execution should own
- performing the domain work
- using capabilities
- generating outputs
- producing evidence

### Why this matters
Baljia’s workers should do work, not manage platform lifecycle overhead.

This is also already suggested by your docs: task lifecycle and verification authority should increasingly belong to the platform, not the worker.

---

## 5. Introduce explicit session types

Baljia should treat these as distinct runtime objects:
- founder chat session
- planning session
- worker execution session
- verification session
- recurring task session
- night-shift session
- onboarding pipeline session

Each session should have:
- session id
- company id
- task id if applicable
- initiating actor
- runtime mode
- status
- progress markers
- permission state
- context packet version
- compacted summary artifact

### Why this matters
This improves:
- debugging
- resumability
- founder-visible execution history
- failure investigation
- auditability

---

## 6. Promote planning into a real stage

Baljia already has governance, but planning should be more explicit.

For non-trivial work, the platform should do this sequence:
1. interpret founder request
2. classify task type and execution mode
3. decompose if needed
4. check dependencies and connections
5. quote credits
6. choose verification level
7. request approval if required
8. then create executable work items

### Why this matters
This reduces oversized tasks, poor routing, and bad execution starts.

### Baljia-specific alignment
This directly supports your locked decisions:
- free planning, paid execution
- hard split enforcement
- execution mode selection
- first-class credit transparency

### Planning must also separate three layers
- **Roadmap** = full company journey and milestone path
- **Light shared plan** = operating plan for the active milestone
- **Task queue** = executable slices of the current plan

Normal tactical CEO suggestions should usually update the light shared plan first, not rewrite the roadmap.

Roadmap changes should happen only on:
- milestone completion
- founder-approved direction change
- major company-state change that alters the journey

This keeps Baljia’s planning system stable and founder-trustworthy rather than overreactive.
---

## 7. Strengthen memory and context architecture

Baljia’s three-layer memory model is directionally good, but it should mature into:
- bounded context packets per run
- structured retrieval contracts
- durable summary artifacts after runs
- private vs shared memory semantics
- secret filtering for sync and reuse
- explicit inclusion of prior related reports
- context compaction over long sessions

### Recommended memory model
- **Company persistent memory**: `Mission`, `Market Research`, `Roadmap`, `product_overview`, `tech_notes`, `brand_voice`, `market_research`
- **Session memory**: recent goals, constraints, unresolved questions
- **Task memory**: planning summary, intermediate evidence, final summary, failure fingerprints
- **Shared retrieval store**: prior reports, learnings, reusable patterns, known issues
- **Run packet**: task-specific compiled context
- **Run summary**: output artifact for future retrieval

### Key rule
Workers should not receive ever-growing generic context. They should receive a compiled, bounded packet.

### Important Baljia behavior to preserve
- CEO/control plane has stronger direct continuity access
- workers usually get bounded platform-assembled context rather than universal live memory CRUD
- the system should be able to explain why each memory item was injected into a run

### Document update policy should be event-based
Operating docs should update when durable company knowledge changes, not after every conversation.

Examples:
- `product_overview` updates on founder-confirmed product truth changes or verified shipped work
- `tech_notes` updates on durable engineering changes like schema, API, auth, infra, or integration changes
- `market_research` updates from repeated real-user evidence, not one-off anecdotes
- `brand_voice` updates slowly, usually through proposed updates unless the founder explicitly changes tone direction

This makes the memory/doc system reliable instead of noisy.
---

## 8. Move long-running execution out of the Next.js app runtime

Next.js should remain responsible for:
- UI
- auth-facing APIs
- request validation
- streaming status to users
- dashboard and public surfaces

Worker services should handle:
- execution runs
- verification runs
- recurring tasks
- night shifts
- browser-heavy flows
- long-running external actions

### Why this matters
This is the cleanest path to:
- better reliability
- better scaling
- cleaner timeouts
- safer operational isolation
- clearer observability

### Baljia-specific implication
Your `worker-launcher`, `watchdog`, `verification`, and future scheduler should converge into a dedicated worker-oriented platform execution layer.

### Minimum worker topology
- queue dispatcher
- general execution worker
- browser-heavy worker
- verification worker
- scheduler worker for recurring and night shifts

Workers should own leases, heartbeats, interruption recovery, structured progress events, and cleanup of browser/external sessions.
---

## 9. Build a first-class permission and approval system

Baljia should centralize safety around capabilities, not routes.

Permission decisions should consider:
- capability risk level
- tenant scope
- whether external side effects occur
- whether money is involved
- whether user-owned integrations are being touched
- whether destructive changes are possible

### Example risk classes
- **low**: read-only internal data
- **medium**: create/update internal platform objects
- **high**: send email, post content, modify production config
- **critical**: delete infrastructure, spend real money, touch billing state, destructive credential operations

### Approval surfaces needed
- destructive infra actions
- ad spend changes
- external publishing when not pre-authorized
- connector authorization scope expansion
- dangerous admin/service-role operations

### Key design rule
Fail closed for admin and connector-sensitive actions.

---

## 10. Treat verification as a separate authority

Baljia already states that the worker is not the final authority on completion. That must stay true in implementation.

Verification should be its own subsystem with:
- verification plan selection
- evidence requirements
- typed evidence capture
- repair loop policy
- final status authority
- failure fingerprint creation

### Verification levels should remain
- none
- deterministic
- browser_flow
- quality_review
- hybrid

### Why this matters
This turns “task completed” from a worker claim into a platform decision.

That is essential for founder trust.

---

## 11. Make failure learning operational, not aspirational

Baljia already has strong ideas around failure fingerprints. Build that early enough that it actually shapes later runs.

Closed loop should be:
1. capture failure evidence
2. normalize/fingerprint
3. link to task and capability
4. store known issue context
5. feed into planning/routing/prompt assembly
6. monitor for regression

### Why this matters
This is one of the biggest differences between a demo agent system and a durable platform.

### Also add the scheduler cost loop
Every executed task should write actual variable cost after completion, including things like:
- model tokens
- search usage
- browser/runtime minutes
- verification cost
- retries
- remediation cost

Baljia should use that data to improve:
- task splitting
- execution mode choice
- verification policy
- remediation policy
- pricing calibration

The goal is good founder simplicity with real internal margin discipline.
---

## 12. Build reusable workflow packages

Baljia should avoid letting services become a grab-bag of one-off logic.

Reusable workflow units should exist for:
- onboarding stages
- worker launch ceremony
- verification flow
- remediation flow
- recurring task evaluation
- night-shift planning/execution/summary
- document suggestion generation
- public event publishing/redaction

This is the Baljia equivalent of a skills/workflow layer.

---

## 13. Build a real connector subsystem

The knowledge pack makes this more explicit: integrations should not stay as ad hoc wrappers.

Baljia should separate:
- platform-owned connectors
- founder/company-owned connectors
- read-only connectors
- write-enabled connectors

The connector subsystem should own:
- auth state
- transport handling
- resource listing and reading
- action invocation
- permission scope
- health and lifecycle
- operator visibility

### Why this matters
Baljia mixes very different kinds of power:
- platform-managed infrastructure
- founder-owned accounts
- read-only research access
- write-heavy external actions like email, posting, ads, and deploys

Those need uniform governance.

---

## 14. Treat founder surfaces as projections of engine state

The dashboard, roadmap rail, task modal, and live wall should project durable engine state rather than inventing state locally.

### This means
- taskboard reads from task + run + artifact state
- roadmap rail reads from `Roadmap` + active milestone state
- current focus reads from the light shared plan
- live wall reads from curated public-safe events only
- founder-visible blocked/failed/repaired states reflect real runtime outcomes

### Important founder-surface rules
- keep queued tasks visible before execution is unlocked
- use task start, not task proposal, as the execution charge boundary
- keep the centered in-dashboard task detail modal as the main run surface
- keep internal runtime states and founder-facing labels related but not identical where softer wording improves clarity
- dashboard and mobile surfaces should remain projections of the same engine state, not separate products

### Why this matters
This makes the UI honest, debuggable, and consistent with execution reality.
---

## How Baljia should evolve by subsystem

## A. CEO / founder chat

Keep the CEO experience, but make it less privileged internally.

### Recommended change
CEO should consume governed service outputs rather than raw internal access wherever possible.

### Keep
- task proposal
- planning help
- queue interaction
- founder explanations
- strategy discussion

### Reduce
- raw introspection exposure
- raw memory access patterns
- raw operational surface where a safer abstraction can exist

### Important operating rule
CEO should remain the single founder-facing orchestrator.
Planning and verification can exist as internal modules under the control plane, but they should not become separate founder-facing personalities.

### Billing and execution rule for CEO
CEO should keep founder-facing language simple:
- planning is free
- tasks cost credits only when execution starts
- blocked-before-start work should not consume credits
- quotes should be explained through deliverables and task split, not infrastructure math

---

## B. Engineering system

Engineering should become the strongest execution system in Baljia.

### Recommended structure
- deterministic mode for standard platform CRUD/admin/integration templates
- template-plus-params mode for familiar patterns with custom inputs
- full-agent mode for ambiguous or novel work

### Important rule
Lifecycle overhead should be platform-owned. Engineering should focus on domain execution, not task bookkeeping.

---

## C. Research system

Research must have real read-only web capability.

### Recommended change
Implement Tavily-backed public web retrieval with citation requirements or explicit insufficiency reporting.

### Why this matters
Without this, Research remains structurally weaker than its product promise.

---

## D. Browser system

Browser should remain the interactive web executor, but under stronger orchestration.

### Add
- cleaner session lifecycle
- verification evidence contracts
- more explicit credential/approval boundaries
- isolated long-running worker execution
- explicit site-tier gating before risky actions

### Important rule
Browser should not be assumed to reliably solve CAPTCHA-heavy, 2FA-heavy, or account-creation-heavy flows. Those should be constrained in policy and planning.

---

## E. Growth systems

Twitter, Meta Ads, and Cold Outreach should move toward workflow-first orchestration with agent assistance where needed.

### Why
These systems are repetitive, policy-heavy, and externally visible.

They benefit from:
- explicit approval rules
- scheduled workflows
- template governance
- evidence and metrics capture
- connector-specific permissions

---

## F. Event bus and observability

Baljia should wire the event bus much earlier and use it as a platform backbone.

It should carry:
- task lifecycle events
- session lifecycle events
- run lifecycle events
- verification events
- failure events
- approval events
- document suggestion events
- billing and credit events
- live wall safe projection events
- mascot state events

### Why this matters
This supports:
- live wall
- founder execution transparency
- watchdogs
- retries
- analytics
- public-safe redaction
- honest founder-safe state projection across dashboard, task modal, and roadmap rail

---

## Recommended implementation phases

## Phase 0 — Contracts and state models
Define first:
- session schema
- run schema
- task schema
- artifact schema
- capability schema
- connector schema
- approval schema
- event schema
- context packet schema

Goal: all later execution work depends on shared contracts instead of ad hoc service logic.

## Phase 1 — Establish runtime boundaries
Build first:
- `src/runtime/*`
- `src/orchestration/*`
- declarative agent definitions
- capability registry metadata
- explicit session types
- model API runtime wrapper
- prompt/context inspection support

Goal: keep behavior the same, improve architecture boundaries.

## Phase 2 — Thin the routes and build the task engine
Move orchestration logic out of routes and into orchestration services.
Implement:
- planning service
- task state machine
- routing
- dependency handling
- verification transitions
- retry/remediation entrypoints

Goal: API routes become transport and validation layers only.

## Phase 3 — Isolate execution and add the worker bridge
Move long-running execution, verification, recurring work, and night shifts into dedicated worker processes/services.
Implement:
- queue
- dispatcher
- worker leases and heartbeats
- resume and stop support
- event stream back to product surfaces

Goal: product app and execution plane scale separately.

## Phase 4 — Capabilities, connectors, and safety hardening
Implement:
- capability risk classes
- approval surfaces
- connector governance
- permission sync rules
- fail-closed admin behavior
- resource/action separation for integrations

Goal: reduce blast radius and improve trust.

## Phase 5 — Memory and context maturation
Implement:
- bounded context packets
- compaction
- durable run summaries
- structured retrieval
- known-issues injection from failures
- secret filtering for sync and reuse

Goal: better quality, lower prompt bloat, stronger reuse.

## Phase 6 — Founder-safe projections and platform intelligence
Implement:
- roadmap rail projection from roadmap state
- taskboard projection from task/run/artifact state
- live wall projection from public-safe events
- failure fingerprint feedback
- routing improvement signals
- verification-driven repair loops
- remediation capacity policy

Goal: Baljia gets better from operating, and founder UI reflects real engine state.
---

## Immediate high-value build order for Baljia specifically

If choosing what to do next from the current repo state, the highest-value sequence is:

1. **Standardize session, run, artifact, approval, event, and context-packet contracts**
2. **Extract runtime core from current agent execution code**
3. **Create declarative agent definitions, including internal planner and verifier roles**
4. **Create capability registry and connector subsystem contracts**
5. **Wire the event bus and session/run model**
6. **Move worker lifecycle ownership into platform orchestration**
7. **Implement Engineering agent modes properly**
8. **Implement real verification execution**
9. **Implement Tavily-backed Research**
10. **Move long-running work into dedicated workers**
11. **Add failure fingerprint feedback into prompt/context assembly**
12. **Project roadmap/task/live-wall UI from real engine state**
13. **Harden permission and approval policies**

This order gives the biggest architectural leverage without changing the founder-facing product.
---

## What Baljia should explicitly not do

To stay aligned with current docs and product goals, Baljia should not:
- replace CEO chat as the primary founder interface
- expose raw internal complexity to founders
- make workers share unlimited context by default
- let route handlers become the orchestration engine
- let completion be decided by the worker alone
- treat every task as full-agent work
- over-index on more agents before fixing runtime and governance
- rely on prompts alone for safety or capability truth

---

## Final recommendation

Baljia should be developed as a **three-plane system**:

### 1. Product plane
Founder-facing experience: onboarding, dashboard, CEO chat, live wall, task UI.

### 2. Control plane
Planning, governance, routing, verification, scheduling, remediation, memory assembly, billing policy, approvals.

### 3. Execution plane
Workers, browser sessions, long-running jobs, recurring runs, night shifts, external connector actions.

This is the cleanest way to preserve Baljia’s current product vision while building a far stronger internal agentic platform.

---

## One-sentence summary

**Baljia should keep the same founder experience, but rebuild the internals around a dedicated runtime core, explicit orchestration, governed capabilities, bounded memory, separate workers, and verifier-led execution authority.**
