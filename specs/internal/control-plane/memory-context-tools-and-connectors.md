# Spec: Memory, Context, Tools, and Connectors

- `Spec ID`: `SPEC-CTRL-105`
- `Status`: rebuilt
- `Subsystem`: memory, context, tools, and connectors
- `Classification`: internal system
- `Sensitivity`: internal only
- `Parent spec`: [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
- `Parent build spec`: [specs/build/control-plane/memory-context-tools-and-connectors.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/control-plane/memory-context-tools-and-connectors.md)

## Purpose

Define the hidden execution surfaces that a run actually receives:

- CEO/control-plane continuity memory
- bounded worker context packets
- capability classes and permission boundaries
- connector governance
- tool-server and mount-profile topology
- skill/playbook guidance
- prompt assembly rules
- hidden platform-service boundary above worker execution

This child spec owns the distinction between:

- continuity memory
- injected execution context
- runtime-callable tools
- non-callable injected aids
- hidden platform services

## Founder-Visible Contract

The founder should experience this subsystem like this:

- CEO feels more context-rich than ordinary worker execution because CEO sits on the strongest continuity layer
- product promises should match the true connector, approval, and capability envelope
- the founder should not see raw connector scopes, raw capability registries, mount metadata, or hidden memory counters
- if execution cannot really use a surface, the system should block or reframe before pretending the worker has that capability

## Hidden-System Contract

The hidden system must preserve five distinct concepts.

1. `continuity memory`
   - strongest on CEO/control plane
2. `ContextPacket`
   - bounded injected context assembled for one task/run
3. `runtime-callable tool surface`
   - what a worker may actually call during the run
4. `injected non-tool aids`
   - skills, memory summaries, doc snippets, artifacts, policy blocks
5. `platform services`
   - hidden services that shape or supervise execution but are not normal worker-callable tools

The system must not collapse these into one blurry idea like “the agent has access to memory/tools.”

## In Scope

- CEO memory asymmetry
- worker context assembly
- capability classes
- connector posture and governance
- permission snapshots
- tool-server and mount-profile topology
- skill/playbook exposure mode
- prompt assembly and execution brief compilation
- platform-service versus worker-tool boundary

## Out of Scope

- scheduler policy
- runtime lifecycle ownership
- lane inventory ownership
- UI copy
- exact provider SDK details

## Canonical Noun Imports

### `ContextPacket`

- **Meaning:** bounded execution context assembled for one task/run
- **Owned here**
- **Not to be confused with:** continuity memory or full company history

### `PermissionSnapshot`

- **Meaning:** the concrete permission and approval envelope granted for one run
- **Owned here**
- **Not to be confused with:** generic company trust level or founder intent in chat

### `worker_lane`

- **Imported meaning:** specialist executor family chosen for the task
- **Owned elsewhere:** [lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md)
- **Used here for:** selecting allowed context, tools, and connectors

### `run_channel`

- **Imported meaning:** how execution entered the system
- **Owned elsewhere:** [control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) and [scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md)
- **Used here for:** prompt/context mode differences only

### `billing_lane`

- **Imported meaning:** economic lane that funds or accounts for work
- **Owned elsewhere:** [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- **Used here for:** approval/risk/cost guardrails only, not tool identity

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| continuity memory access posture | Canonical | this spec | define CEO-versus-worker asymmetry | treated as universal worker CRUD |
| `ContextPacket` contents | Canonical | this spec | define bounded execution context | confused with tool inventory |
| capability class definitions | Canonical | this spec | define risk and side-effect grouping | used to invent lane inventory |
| connector posture | Canonical | this spec | define ownership/auth/risk/access posture | flattened into generic “integration available” |
| `PermissionSnapshot` | Canonical | this spec | define run-level permission envelope | treated as lane identity |
| tool mount profile | Canonical | this spec | define configured versus callable tool shape | confused with prompt claims |
| `worker_lane` | Canonical elsewhere | lane child | select lane-specific policy | redefined here |
| `Task`, `Run`, `Session` | Canonical elsewhere | runtime child | attach refs for context and permission | redefined here |
| founder-visible labels and blockers | Derived elsewhere | dashboard child | projected from runtime/control-plane truth | treated as hidden tool availability |

## Structural Model

### Context hierarchy

The execution context hierarchy has three layers.

#### 1. CEO continuity layer

- strongest direct access to shared company context
- strongest ability to read prior plans, docs, and recent outcomes
- explains why CEO can sound broader and more context-rich than specialist workers

**CEO data access mechanism:**

The CEO/chat agent receives a broader `ContextPacket` than specialist workers:

- direct read access to all three memory layers (Domain Knowledge, User Prefs, Cross-Company)
- direct read access to task status and history across all lanes
- direct read access to billing/credit state (for explaining purchase options)
- direct read access to connector state (for explaining what is connected vs missing)
- write access to memory layers (workers get injected read-only summaries)
- no direct access to internal cost accounting, hidden ledgers, or platform service internals

This asymmetry is why the CEO can answer questions about "what happened with that task" or "how many credits do I have" while specialist workers cannot.

#### Memory layer token budgets

| Layer | Name | Token budget | Purpose | Writeback behavior |
|---|---|---|---|---|
| 1 | Domain Knowledge | 15,000 tokens | Company-specific technical and business knowledge: product details, domain knowledge, technical decisions, business logic | Written by CEO and control plane after significant technical decisions or task completions |
| 2 | User and Company Preferences | 3,000 tokens | Conversation-derived context: mission, products, capabilities, pricing, preferences, founder communication style | Autosaves every ~20 messages (counter-based, not event-driven) |
| 3 | Cross-Company Patterns | 15,000 tokens | Shared learnings across all companies: what works and what does not, network-effect style operational patterns | Written by platform ops and learning aggregation processes |

**Token budget implications:**

- Layer 2 is deliberately small (3,000 tokens) — it is a bottleneck for complex businesses, but this forces concise preference capture rather than unbounded conversation replay
- Layer 1 and Layer 3 share the same 15,000-token budget but serve different scopes (company-specific vs. cross-company)
- all three layers are serialized into prompt context at session/run startup — they are injected, not dynamically retrieved mid-conversation

#### Memory save cadence

- **Layer 2 autosave:** every ~20 messages during CEO/chat conversation (counter-based trigger)
- **Layer 1 writes:** after significant task completions, technical decisions, or domain knowledge changes — triggered by CEO or post-verification control-plane side effects
- **Layer 3 writes:** aggregated by platform processes, not by individual company agents — updated when cross-company patterns emerge from failure fingerprinting, routing analysis, or task outcome aggregation
- **Workers do not write to memory layers** — they receive injected read-only summaries. Discoveries made mid-run are captured in task reports and artifacts, then selectively promoted to memory layers by the CEO or control plane post-run

#### Memory eviction policy

When a layer approaches its token budget:

- **Layer 2 (3K):** oldest preference entries are summarized and compressed. Recent founder preferences take priority over historical ones. The autosave process overwrites the full layer content with a fresh summary derived from recent conversation context + prior layer state
- **Layer 1 (15K):** domain knowledge entries are scored by recency and relevance. Outdated technical decisions (superseded by newer ones) are evicted first. Active project context takes priority
- **Layer 3 (15K):** cross-company patterns are scored by applicability breadth and recency. Patterns that apply to fewer company archetypes or that have aged without reinforcement are evicted first

Eviction is not deletion — evicted entries may persist in task reports, documents, or the learnings system. Memory layers are a working-set cache, not an archive.

#### Learnings system (separate from memory layers)

The platform maintains a second, separate knowledge store for task-derived learnings:

**What learnings capture:**

- task-level outcomes: what worked, what failed, and why
- agent-task routing outcomes: which agent succeeded/failed for which task shapes
- tool effectiveness: which tools produced good results for which task types
- failure patterns: reusable context for similar future tasks

**Learnings CRUD model:**

- `create_learning(company_id, task_id, learning_type, content, tags)` — record a new learning from a task outcome
- `search_learnings(query, company_id?, tags?, limit)` — search learnings by content, company scope, or tags
- `read_learning(learning_id)` — retrieve a specific learning
- `update_learning(learning_id, content?, tags?, status?)` — update or refine a learning
- `delete_learning(learning_id)` — remove an outdated or incorrect learning

**Access model:**

- CEO/chat has active CRUD/search access to learnings via the `learnings` MCP
- not every worker agent has the learnings surface mounted equally — access varies by lane
- learnings are separate from the 3-layer memory system: memory layers hold continuity context; learnings hold operational knowledge

**Learning shape:**

- `learning_id`
- `company_id` (null for cross-company learnings)
- `source_task_id`
- `learning_type`: `success_pattern | failure_pattern | routing_insight | tool_insight | domain_knowledge`
- `content`
- `tags`
- `confidence_score`
- `usage_count` (how many times this learning has been referenced)
- `created_at`
- `last_referenced_at`
- `status`: `active | superseded | archived`

#### Cross-company memory sharing rules

Layer 3 is the cross-company learning layer. Its sharing rules:

- **What is shared:** operational patterns that improve execution quality across companies (e.g., "SaaS onboarding tasks succeed more often when auth is built before dashboard")
- **What is NOT shared:** company-specific data, founder preferences, business secrets, domain knowledge, or any PII
- **Aggregation model:** patterns are derived from anonymized task outcomes across companies, not copied from individual company memory
- **Write authority:** only platform-level processes (platform ops, learning aggregation) write to Layer 3 — individual company agents and CEOs cannot write cross-company patterns directly
- **Read authority:** all company CEOs can read Layer 3 for improved planning context
- **Quality gate:** patterns must meet a minimum confidence threshold (based on occurrence count and success rate) before being written to Layer 3
- **Staleness:** patterns that are not reinforced by new evidence within a rolling window are eventually evicted

**Baljia improvement over Polsia:** In Polsia, Layer 3 was observed to be empty (cross-company intelligence not active). Baljia should implement actual cross-company pattern aggregation from the start, with proper anonymization and quality gating.

#### 2. Control-plane assembly layer

- decides what is relevant for one task/run
- packages bounded execution context
- compiles tool, permission, and policy envelopes

#### 3. Worker execution layer

- receives only the `ContextPacket`, `PermissionSnapshot`, callable tool surface, and injected aids granted for that run
- does not receive universal memory CRUD by default

### Governance chain

Capability use must pass through this chain:

1. `worker_lane` fit
2. capability allowance
3. connector availability and posture
4. approval and permission snapshot
5. runtime dispatch

If any earlier layer denies the action, the worker must not discover that only after trying the tool.

### Connector posture model

Every connector must be classified by:

- ownership
  - platform-owned
  - founder/company-owned
- access posture
  - read-only
  - write-enabled
- auth posture
  - no auth
  - platform auth
  - founder auth
- tenant scope
  - shared platform
  - company-scoped
- risk profile
  - low
  - moderate
  - dangerous

### Tool topology model

The tool surface has five layers.

1. `registered tool server`
   - governed server bundle such as infra, browser, company email, twitter, ads
2. `configured mount profile`
   - what a lane or run family is configured to use in principle
3. `runtime-callable tool surface`
   - what this run may actually call
4. `injected non-tool aids`
   - memory summaries, skills, docs, artifacts, policy blocks
5. `platform services`
   - memory sync, OAuth state, registry, watchdog, provisioning, and similar hidden services above the worker tool layer

Configured mounts, callable tools, injected aids, and platform services must remain explicit separate concepts.

### Skill/playbook model

Skills are reusable execution playbooks:

- they are not proof of tenant-owned repo files
- they do not expand the raw capability envelope by themselves
- they improve execution quality when injected or referenced by policy
- they may be mixed-provenance and require reauthoring rather than blind reuse

### Prompt assembly model

Prompt assembly is a compiler step, not a static universal string.

The compiler should combine:

1. lane prompt family and task-type rules
2. company-specific docs and active milestone context
3. recent artifacts and prior report summaries
4. summarized continuity memory, not raw unlimited recall
5. connector/auth state
6. true callable tool surface
7. approval, cost, and risk guardrails
8. output contract and verification expectations

The result is one compiled execution brief for one task on one company in one run context.

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “CEO knows the company context.” | CEO continuity layer has richer direct access | CEO still explains limits honestly | Best-effort continuity with real asymmetry |
| “This worker can do X.” | lane fit, capability, connector posture, and permission envelope all allow it | task is blocked, narrowed, or rerouted before fake execution | Guaranteed honest capability boundary |
| “The system has this integration.” | connector exists with required ownership/auth/access posture | founder sees connect/auth/blocker state instead | Best-effort within real connector posture |
| “This task is running with the right context.” | control plane assembled a bounded packet and real tool surface | worker gets blocked or degraded rather than bluffing with missing context | Best-effort execution with bounded packet |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| task routed | context assembly starts | runtime handoff requires packet | this spec with control-plane overview | `worker_lane` selected and task exists | relevant docs/memory/artifacts/connectors selected | if required context is missing, stop before execution |
| assembly inputs | `ContextPacket` compiled | relevant context chosen | this spec | bounded packet can be built | versioned packet emitted | new packet may be built if task/run context changes materially |
| allowed surfaces | `PermissionSnapshot` issued | approval/auth/risk rules resolved for this run | this spec | connector posture and policy support issuance | run-level envelope emitted | refresh only when approval/connectors/state change materially |
| configured mount profile | runtime-callable tool surface | run-specific pruning occurs | this spec + runtime | current run constraints known | callable tool surface fixed for the run | rebuild if run context or approvals materially change |
| lane prompt family + run context | compiled execution brief | final assembly step | this spec + runtime | packet, tools, permissions, and guardrails available | prompt assembly spec emitted | rebuild for later run, remediation run, or materially different context |

## Context Assembly Policy

Workers should receive only what they need:

- current task
- active milestone
- relevant company docs
- recent task artifacts
- connector state if needed
- permission scope for the run

Workers should not receive by default:

- full company history
- giant document dumps
- unbounded founder-chat replay
- broader tools than the current run actually allows

## Capability Governance

Useful capability classes:

- `read`
- `internal_mutation`
- `environment_mutation`
- `external_action`
- `dangerous`

Every capability should define:

- input/output shape
- side-effect class
- risk class
- approval requirement
- allowed lane families
- connector requirements

## Data and Interface Contract

### `ContextPacket`

- `context_packet_id`
- `company_id`
- `task_id`
- `active_milestone_id`
- `included_documents`
- `included_artifacts`
- `included_memory_refs`
- `connector_context_refs`
- `assembled_for_worker_lane`
- `assembled_at`
- `version`

### `CapabilityDefinition`

- `capability_id`
- `capability_class`
- `input_schema_ref`
- `output_schema_ref`
- `side_effect_class`
- `risk_class`
- `approval_requirement`
- `allowed_lane_families`
- `connector_requirements`
- `site_tier_requirement` when relevant

### `ConnectorDefinition`

- `connector_id`
- `connector_type`
- `ownership_model`
- `tenant_scope`
- `auth_posture`
- `access_posture`
- `risk_class`
- `allowed_capabilities`
- `allowed_worker_lanes`
- `status`

### `PermissionSnapshot`

- `permission_snapshot_id`
- `company_id`
- `task_id`
- `worker_lane`
- `allowed_capabilities`
- `allowed_connectors`
- `approval_scope_refs`
- `issued_at`
- `expires_at`

### `SkillDescriptor`

- `skill_id`
- `skill_name`
- `skill_family`
- `applies_to_lanes`
- `source_type`
- `version`
- `status`
- `notes`

### `ToolServerDefinition`

- `tool_server_id`
- `server_name`
- `server_family`
- `tenant_scope`
- `auth_posture`
- `exposure_mode`
- `callable_tools`
- `dangerous_tools`
- `conditional_activation_rules`
- `owning_platform_service`
- `status`

### `ToolMountProfile`

- `tool_mount_profile_id`
- `worker_lane`
- `configured_servers`
- `runtime_callable_servers`
- `injected_context_sources`
- `conditional_servers`
- `forbidden_tools`
- `prompt_family_id`
- `version`

### `PromptAssemblySpec`

- `prompt_assembly_spec_id`
- `worker_lane`
- `company_id`
- `task_id`
- `prompt_family_id`
- `workflow_rule_refs`
- `document_refs`
- `artifact_refs`
- `memory_summary_refs`
- `connector_state_refs`
- `tool_surface_summary`
- `approval_guardrail_refs`
- `cost_guardrail_refs`
- `output_contract_ref`
- `compiled_at`
- `version`

### `PlatformServiceDefinition`

- `platform_service_id`
- `service_name`
- `service_family`
- `owner_layer`
- `callable_by_control_plane`
- `callable_by_workers`
- `provided_state_refs`
- `failure_signal_types`
- `governance_policy_ref`
- `status`

## Edge Cases and Failure Handling

- packets that are too broad create noisy, inconsistent workers
- packets that are too thin create weak execution and repeated re-explaining
- connector governance must stop lanes from using actions they are not approved or authenticated for
- a prompt claim must never outrank the actual callable tool surface
- platform services such as watchdog or OAuth state must not be misrepresented as ordinary lane-callable tools

## Implementation Trap Notes

### Trap 1: treating memory as a universal worker tool

- **Wrong assumption:** if CEO can read memory directly, every worker should also get rich live memory CRUD.
- **Why it is wrong:** the preserved asymmetry is part of the hidden system design.
- **Correct interpretation:** CEO has richer continuity access; workers get bounded injected packets.

### Trap 2: treating configured mounts as callable truth

- **Wrong assumption:** if a mount is configured or named in prompt text, the worker can call it.
- **Why it is wrong:** configured profile, callable surface, injected aids, and platform services are different layers.
- **Correct interpretation:** runtime-callable surface is the execution truth.

### Trap 3: treating skills as tools or capability expansion

- **Wrong assumption:** injecting a skill means the lane can now do more categories of work.
- **Why it is wrong:** skills improve behavior inside the existing envelope; they do not redefine the envelope.
- **Correct interpretation:** keep skill/playbook guidance separate from capability and connector allowance.

### Trap 4: treating platform services as worker tools

- **Wrong assumption:** watchdog, OAuth state, registry, or provisioning are just bigger tools the worker calls.
- **Why it is wrong:** they sit above worker execution and supervise or enrich it.
- **Correct interpretation:** model them as platform services, not lane-callable tool surfaces.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- CEO continuity is richer than worker continuity, but both remain inside the same company truth
- lane routing may only promise actions that can be backed by real capabilities and connectors
- runtime handoff depends on `ContextPacket`, `ToolMountProfile`, `PromptAssemblySpec`, and `PermissionSnapshot`
- billing and approval policy can restrict connector use without changing founder-visible simplicity
- configured mounts, callable tools, injected aids, and platform services must stay distinct across sibling specs

### Owning spec rule

- this spec owns:
  - CEO memory asymmetry
  - bounded context assembly
  - capability classes
  - connector posture and ownership model
  - permission snapshots
  - skill/playbook descriptors
  - tool and mount topology
  - prompt assembly and company-specific execution brief compilation
  - platform-service versus worker-tool boundary
- [control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) owns:
  - routing and runtime handoff seams
- [lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/lane-and-agent-responsibility-model.md) owns:
  - which lanes exist and what they are allowed to claim at a lane level
- [runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md) owns:
  - where packet and permission refs attach to sessions and runs
- [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md) owns:
  - `billing_lane` economics and continuity entitlements

### Reconciliation notes

- this rebuilt child keeps memory asymmetry explicit instead of flattening CEO and worker context into one model
- this rebuilt child clearly separates callable tools from injected aids and platform services
- sibling cleanup completed: scheduler and continuity specs now use correct `run_channel` and `night_shift_eligible` terminology

## Acceptance Criteria

- CEO has stronger continuity access than ordinary workers
- worker runs receive bounded, role-sensitive `ContextPacket` objects
- capabilities have centralized governance
- connectors are explicit governed objects with ownership/auth/access posture
- skills are modeled as platform playbooks, not assumed tenant-owned repo assets
- every lane and module resolves to a concrete mount/context/prompt shape before execution
- configured mounts, callable tools, injected aids, and platform services remain explicitly separated
- execution briefs are compiled per company, lane, task, and run context rather than treated as one static generic prompt
- memory layer token budgets are enforced (Layer 1: 15K, Layer 2: 3K, Layer 3: 15K)
- Layer 2 autosaves every ~20 messages during CEO chat
- workers receive injected read-only memory summaries, not live CRUD access
- eviction policy preserves recent and relevant entries over stale ones
- learnings system operates independently from memory layers with CRUD/search access
- cross-company patterns in Layer 3 are anonymized and quality-gated before sharing

## Plain-Language New-Reader Tests

- Can every worker call the same memory surface as CEO?
- If a prompt mentions a tool, does that automatically mean the run can call it?
- Are skills tools, context, or permission grants?
- Is OAuth state a connector, a platform service, or a normal worker tool?
- What exactly gets handed to runtime for one run: full memory, or a bounded packet plus permissions and callable tools?
- How much space does each memory layer have?
- How often does Layer 2 save, and what triggers it?
- What happens when a memory layer runs out of space?
- Are learnings the same thing as memory layers?
- Can one company's private data leak into another company's Layer 3?

If a new reader cannot answer these directly from this file, the subsystem is still ambiguous.

## Implementation Freedom

- exact memory-store implementation
- exact packet serialization format
- exact prompt-template wording
- exact MCP transport and registry implementation
- exact connector registry schema
- exact skill storage format

## Traceability

### Source topics

- [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
- [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
- [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
- [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)

### Source facts

- `FACT-KNOW-026`

### Source decisions

- `DEC-CEO-002`
- `DEC-CAP-002`
- `DEC-CAP-003`

### Claim-to-anchor audit

- CEO has stronger continuity access than ordinary workers, and worker context is assembled rather than universally exposed:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
  - facts:
    - `FACT-KNOW-026`
  - decisions:
    - `DEC-CEO-002`

- founder-facing capability claims must stay inside real execution surfaces and limits instead of optimistic chat wording:
  - topics:
    - [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)
    - [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
  - decisions:
    - `DEC-CAP-003`

- skills are platform playbooks and cannot be copied blindly or treated as proof of tenant-owned repo state:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
    - [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
  - decisions:
    - `DEC-CAP-002`

- configured mounts, callable tools, injected aids, and prompt claims must be reconciled before execution truth is declared:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
    - [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)
  - decisions:
    - `DEC-CAP-003`

- hidden platform services such as watchdog, memory sync, registry, and provisioning should be modeled above the worker tool layer:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - decisions:
    - `DEC-CEO-002`

## Change Log

- `2026-04-06`: seeded initial memory/context/tools/connectors packet
- `2026-04-12`: rebuilt the spec to separate continuity memory from bounded run context, separate callable tools from injected aids and platform services, and align execution-brief assembly with the updated control-plane and runtime umbrellas
- `2026-04-13`: deepened memory model with token budgets per layer, save cadence rules, eviction policy, learnings CRUD model, and cross-company memory sharing rules
