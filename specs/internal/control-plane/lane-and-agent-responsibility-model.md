# Spec: Lane and Agent Responsibility Model

- `Spec ID`: `SPEC-CTRL-104`
- `Status`: rebuilt
- `Subsystem`: lane and agent responsibility model
- `Classification`: internal system
- `Sensitivity`: internal only
- `Parent spec`: [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
- `Parent build spec`: [specs/build/control-plane/lane-and-agent-responsibility-model.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/control-plane/lane-and-agent-responsibility-model.md)

## Purpose

Define the canonical `worker_lane` inventory, the responsibility boundary of each lane, and the routing truth that determines which hidden specialist executor family should perform bounded work.

This child spec owns:

- `worker_lane` inventory
- `worker_lane` responsibility boundaries
- `worker_lane` working patterns
- distinction between founder-visible orchestrator, hidden control-plane modules, and hidden specialist worker lanes
- `content` as task-type routing nuance rather than a default standalone lane

This child spec does **not** own:

- `run_channel`
- `billing_lane`
- runtime entity definitions
- queue behavior
- connector schema internals
- pricing rules

## Founder-Visible Contract

The founder should experience the lane model like this:

- CEO is the only founder-facing orchestrator
- specialist work may appear as task-family or ownership labels such as Engineering, Browser, Research, Data, Support, Twitter, Meta Ads, and Cold Outreach
- the founder should not need to understand prompt families, mount profiles, or internal lane-specific capability wiring
- if a request is out of envelope, CEO should reframe or reject honestly rather than pretending some hidden lane can do it

## Hidden-System Contract

The hidden worker system must distinguish sharply between:

- `ceo_coordinator`
  - founder-facing orchestrator only
- hidden CEO-owned modules
  - planning and verification under the control plane
- `worker_lane`
  - the specialist executor family chosen for the task
- task types or planning labels
  - for example `content`, which is not automatically its own worker lane

Lane identity must stay distinct from:

- `run_channel`
- `billing_lane`
- approval state
- connector readiness

## In Scope

- `ceo_coordinator`
- `planning_module`
- `verification_module`
- `engineering`
- `browser`
- `research`
- `data`
- `support`
- `twitter`
- `meta_ads_manager`
- `cold_outreach`
- content-routing nuance
- lane-level unsupported or reframe behavior

## Out of Scope

- runtime entity schema
- queue and scheduling mechanics
- detailed connector schema
- detailed approval schema
- UI layout
- pricing copy

## Canonical Noun Imports

### `worker_lane`

- **Imported meaning:** the specialist executor family responsible for performing bounded work
- **Owned here**
- **Must not be confused with:** `run_channel`, `billing_lane`, or eligibility flags

### `run_channel`

- **Imported meaning:** how execution entered the system
- **Owned elsewhere:** [control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) and [scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md)
- **Used here only to note that lane choice does not decide execution origin**

### `billing_lane`

- **Imported meaning:** economic lane that funds or accounts for the work
- **Owned elsewhere:** [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md)
- **Used here only to note that lane choice does not decide billing semantics**

## State Authority Section

| State / field | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| `worker_lane` | Canonical | this spec | define executor family and working pattern | overloaded into execution origin or billing semantics |
| `run_channel` | Canonical elsewhere | control-plane/scheduler specs | acknowledged as separate concept | redefined here |
| `billing_lane` | Canonical elsewhere | billing umbrella | acknowledged as separate concept | redefined here |
| capability classes | Canonical elsewhere | memory-context-tools-and-connectors child | consumed as lane capability shape | re-owned here as connector schema |
| founder-visible task-family label | Derived | dashboard child | aligned for founder reading | used as sole hidden routing truth |

## Structural Model

### Worker taxonomy

The hidden worker model has three distinct families.

#### 1. Founder-facing orchestrator family

- `ceo_coordinator`

This is the only founder-facing member of the family.

#### 2. Hidden control-plane module family

- `planning_module`
- `verification_module`

These are internal modules under CEO/control plane, not specialist worker lanes.

#### 3. Specialist `worker_lane` family

- `engineering`
- `browser`
- `research`
- `data`
- `support`
- `twitter`
- `meta_ads_manager`
- `cold_outreach`

Only this third family is the canonical `worker_lane` inventory.

### Responsibility boundary

- `ceo_coordinator`
  - scopes, explains, routes, and follows up
  - does not become a hidden execution lane just because it can create or reframe work
- `planning_module`
  - decomposes and sequences work
  - does not impersonate an execution worker
- `verification_module`
  - judges outcomes and same-scope repair needs
  - does not replace the worker that attempted the task
- specialist `worker_lane`
  - performs bounded work inside its capability envelope
  - must not expand its promise because the founder asked through CEO
  - must resolve to a concrete mount/profile/context shape before execution starts

### Routing truth model

Routing should resolve in this order:

1. founder ask or roadmap task type
2. capability-envelope check
3. `worker_lane` fit check
4. connector and site-tier prerequisites
5. approval or spend-sensitive requirements
6. either:
   - route to one real `worker_lane`
   - split into multiple lane-bound tasks
   - reject or reframe honestly

The lane spec determines **who executes**. It does not determine **how execution entered** (`run_channel`) or **which economic bucket pays** (`billing_lane`).

## Canonical Worker Lane Definitions

### `ceo_coordinator`

- **Family:** founder-facing orchestrator
- **Role:** continuity, scoping, explanation, routing, expectation-setting
- **Not a `worker_lane`:** yes, by design
- **Why included here:** to stop readers from collapsing CEO into the specialist lane set

### `planning_module`

- **Family:** hidden control-plane module
- **Role:** convert founder or roadmap intent into executable bounded tasks
- **Not a `worker_lane`:** yes

### `verification_module`

- **Family:** hidden control-plane module
- **Role:** decide whether runtime output is good enough to count as success and whether same-scope repair is needed
- **Not a `worker_lane`:** yes

### `engineering`

- **Role:** build, fix, integrate, verify, and deploy product changes on the managed stack
- **Capability shape:** strongest internal/environment mutation lane
- **Working model:**
  - read compiled brief, docs, prior reports, and skills
  - inspect codebase, logs, schema, and service context
  - apply bounded change
  - push to staging or preview
  - verify staging behavior
  - promote only after staging passes
  - save report and artifacts
- **Must not be mistaken for:** catch-all lane for unsupported growth or research work

### `browser`

- **Role:** bounded interactive web actions that need navigation, forms, screenshots, or authenticated sessions
- **Capability shape:** browser execution within site-tier, auth, and anti-bot constraints
- **Working model:**
  - check site tier and credential readiness first
  - navigate, inspect, click, fill, or extract inside allowed flows
  - stop early on CAPTCHA-heavy or unsupported account-creation/login conditions
  - return proof and runtime result
- **Must not be mistaken for:** universal “can use any website” lane

### `research`

- **Role:** synthesize company context, options, and structured recommendations
- **Capability shape:** read-heavy synthesis lane
- **Working model:**
  - read docs, reports, roadmap, and prior outputs
  - synthesize findings into briefs or decision support
  - escalate to CEO or Browser when fresh web evidence is actually required
- **Must not be mistaken for:** strong fresh-web autonomous retrieval lane

### `data`

- **Role:** analyze schemas, metrics, logs, and platform-built database state
- **Capability shape:** read-heavy diagnostic lane
- **Working model:**
  - inspect schema, logs, metrics, or query context
  - run bounded analysis
  - produce findings and hand implementation fixes back to Engineering if code changes are needed
- **Must not be mistaken for:** generic BI theater, predictive modeling, or external-database default lane

### `support`

- **Role:** inbound company-support email and async reply handling
- **Capability shape:** email-thread read/write with company identity context
- **Working model:**
  - read thread and company context
  - draft or send reply
  - escalate unclear or risky cases
  - preserve thread state and summary
- **Must not be mistaken for:** live chat, refund lane, or generic outbound prospecting lane

### `twitter`

- **Role:** bounded short-form posting within shared-account or allowed connected-account posture
- **Capability shape:** outbound posting lane with narrow default promise
- **Working model:**
  - read positioning and recent docs
  - draft concise post
  - check rate-limit/policy constraints
  - publish and save artifact
- **Must not be mistaken for:** full social-listening, DM, or rich-media automation lane

### `meta_ads_manager`

- **Role:** Meta-only ad operations
- **Capability shape:** spend-sensitive external-action lane
- **Working model:**
  - inspect account, campaign, audience, and asset context
  - prepare or update creatives/settings
  - respect approval and spend guardrails
  - record metrics snapshot and follow-up recommendation
- **Must not be mistaken for:** generic multi-network ads lane or task-credit-funded lane

### `cold_outreach`

- **Role:** low-volume outbound email outreach and early reply handling
- **Capability shape:** outbound email plus contact discovery/verification lane
- **Working model:**
  - read offer, targeting brief, and supporting docs
  - source or verify contacts when scope allows
  - draft and send bounded outreach
  - watch replies and hand off support-style threads when appropriate
  - save outcomes
- **Must not be mistaken for:** mass automation, drip campaigns, or browser-first sourcing lane

## Content-Routing Rule

`content` is not a canonical `worker_lane` in the current exact model.

Use this rule:

- `content` = task type or planning label
- long-form drafts, landing-page copy, newsletters, and SEO writing must route through a real lane such as:
  - `research`
  - `browser`
  - `engineering`
  - later-improved dedicated growth/content capability only if explicitly added later

The system must never create a fake standalone content worker just because UI or planning language used a content-style label.

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “Engineering will handle this.” | task is inside engineering envelope and required context/connectors exist | CEO reframes or reroutes honestly | Best-effort execution, guaranteed honest routing |
| “Browser can do this.” | site tier, credentials, and anti-bot posture allow it | task is blocked, narrowed, or rejected honestly | Best-effort within site-tier policy |
| “Research will look into this.” | synthesis lane is sufficient for the ask | CEO or Browser is used when fresh web evidence is needed | Best-effort synthesis, not guaranteed fresh retrieval |
| “Meta Ads will run this.” | separate ads billing readiness and approval/spend posture exist | founder sees spend/approval blocker rather than fake action | Best-effort inside Meta-only lane |
| “Cold Outreach will handle this.” | low-volume email-first scope fits and required contact/inbox posture exists | task is narrowed, blocked, or rerouted | Best-effort inside low-volume email-first limits |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| founder or roadmap task type | candidate `worker_lane` set | lane-fit analysis begins | this spec | capability envelope understood enough to compare lanes | candidate set narrowed | if none fit, reframe or reject honestly |
| candidate `worker_lane` set | resolved `worker_lane` | routing decision | this spec with control-plane overview | real lane fit exists | lane-specific working pattern and prerequisites become available downstream | if prerequisites later fail, lane identity stays the same unless the task is explicitly rerouted |
| resolved `worker_lane` | blocked or reframe recommendation | connector/site-tier/policy mismatch discovered before or during routing | this spec + control-plane overview | lane promise cannot be honestly fulfilled as requested | founder-safe explanation and/or nearby supported shape | task may re-enter routing if prerequisites or scope change |
| resolved `worker_lane` | execution-ready lane packet | control plane completes routing and admission | control-plane overview consuming this spec | lane fit accepted and downstream policy passes | runtime receives one concrete lane target | runtime takes over from there |

## Data and Interface Contract

### Worker lane definition

- `worker_lane_id`
- `founder_visible_label`
- `responsibility_summary`
- `execution_scope`
- `allowed_task_types`
- `capability_classes_ref`
- `connector_prerequisites`
- `default_tool_mount_profile_id`
- `prompt_family_id`
- `context_policy_id`
- `working_pattern_id`
- `handoff_rules`
- `success_artifact_types`
- `risk_profile`
- `unsupported_examples`

### Worker lane routing result

- `task_id`
- `worker_lane`
- `route_reason`
- `required_connectors`
- `site_tier_requirement` when browser applies
- `approval_requirement`
- `billing_lane_ref`
- `unsupported_reason` when not routable
- `reframe_suggestion` when not routable as requested

### Unsupported or reframe result

- `task_id`
- `requested_shape`
- `rejection_reason`
- `nearby_supported_shape`
- `recommended_worker_lane` when applicable
- `founder_safe_explanation`

## Edge Cases and Failure Handling

- research must not be treated as a strong autonomous live-web lane
- browser must not be used to overpromise account creation or CAPTCHA-heavy automation
- support and cold outreach must not collapse into one generic email lane
- `meta_ads_manager` must stay separate from generic content/posting work and from task-credit semantics
- `content` must remain a task type routed through a real lane, not a fake default worker
- engineering must not absorb unsupported growth or research work merely because it is flexible

## Implementation Trap Notes

### Trap 1: calling every kind of lane a `worker_lane`

- **Wrong assumption:** manual, recurring, night shift, and remediation are also part of the lane inventory.
- **Why it is wrong:** those are `run_channel` concepts, not specialist executor families.
- **Correct interpretation:** this file owns only specialist executor families plus founder-facing/control-plane module distinction.

### Trap 2: putting billing semantics into lane identity

- **Wrong assumption:** if a lane usually implies spend, the lane itself owns the billing rule.
- **Why it is wrong:** billing semantics belong to `billing_lane`, not `worker_lane`.
- **Correct interpretation:** lane spec may reference billing boundaries, but it does not own them.

### Trap 3: inventing a `content` worker from planning language

- **Wrong assumption:** content labels imply a first-class worker lane exists.
- **Why it is wrong:** current evidence supports content as task type/routing nuance, not a canonical lane.
- **Correct interpretation:** route content work through real lanes.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- CEO is the only founder-facing orchestrator even though hidden modules and specialist `worker_lane` values exist
- roadmap and planning can propose work only if it can resolve into a real supported `worker_lane` or honest reframe
- connector and capability governance can narrow what a lane may actually do on a given task
- `billing_lane` remains separate from `worker_lane`, especially for Meta Ads and other spend-sensitive work
- scheduler and runtime consume lane-routing results without redefining lane promises mid-run

### Owning spec rule

- this spec owns:
  - canonical `worker_lane` inventory
  - lane responsibility boundaries
  - lane working patterns
  - content-routing nuance
  - lane-specific unsupported or reframe behavior
- [control-plane-overview.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/control-plane-overview.md) owns:
  - intake normalization
  - planning, routing, approval, and runtime handoff seams
  - `run_channel`
- [memory-context-tools-and-connectors.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/memory-context-tools-and-connectors.md) owns:
  - capability classes
  - connector governance
  - permission and context policy
- [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md) owns:
  - `billing_lane`
  - founder-visible credits policy
  - ads and external-spend accounting semantics
- [scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md) owns:
  - queue ordering and execution timing after routing
  - `run_channel` behavior after routing

### Reconciliation notes

- this rebuilt child now treats `worker_lane` as the specialist executor family only
- this child no longer mixes `run_channel` or billing semantics into lane ownership
- sibling cleanup completed: all specs now use `worker_lane`, `run_channel`, and `billing_lane` distinctly

## Acceptance Criteria

- `worker_lane` is clearly defined as the specialist executor family only
- the spec no longer mixes `worker_lane` with `run_channel` or `billing_lane`
- every canonical lane has explicit responsibility, capability shape, and working model
- CEO remains founder-facing while planning and verification remain hidden control-plane modules rather than worker lanes
- `content` is clearly treated as task-type routing nuance instead of a default standalone lane
- Meta Ads and Cold Outreach keep distinct execution and billing-boundary language

## Plain-Language New-Reader Tests

- Is `night_shift` a `worker_lane` or a `run_channel`?
- Is `Meta Ads` a worker lane, a billing lane, or both?
- Is `content` a real lane right now or a task type routed through real lanes?
- What is the difference between `ceo_coordinator` and `engineering` in this file?
- Can `browser` be used for any website just because it is the browser lane?

If a new reader cannot answer these directly from this file, the spec is still ambiguous.

## Implementation Freedom

- exact agent-definition registry schema
- exact enum names for lane IDs
- exact fallback routing policy for borderline task types

## Traceability

### Source topics

- [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
- [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
- [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)
- [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)

### Source facts

- `FACT-CAP-003`
- `FACT-CAP-009`
- `FACT-CAP-010`
- `FACT-CAP-011`
- `FACT-CAP-012`
- `FACT-CAP-013`
- `FACT-CAP-014`
- `FACT-CAP-021`
- `FACT-CAP-022`
- `FACT-EXEC-012A`

### Source decisions

- `DEC-TERM-002`
- `DEC-CHAN-002`
- `DEC-CAP-001`
- `DEC-CAP-002`
- `DEC-CEO-002`

### Claim-to-anchor audit

- CEO remains the only founder-facing orchestrator while specialist lanes stay hidden execution workers:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
    - [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
  - facts:
    - `FACT-CAP-022`
  - decisions:
    - `DEC-CEO-002`
    - `DEC-CHAN-002`

- `worker_lane` must stay separate from execution origin and billing semantics:
  - topics:
    - [knowledge/topics/control-plane-runtime-and-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/control-plane-runtime-and-agents.md)
  - facts:
    - `FACT-EXEC-012A`
  - decisions:
    - `DEC-TERM-002`

- separate execution lanes matter, and channel claims must be locked by observed worker reality rather than optimistic sales phrasing:
  - topics:
    - [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)
    - [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
  - facts:
    - `FACT-CAP-003`
    - `FACT-CAP-009`
    - `FACT-CAP-010`
    - `FACT-CAP-011`
    - `FACT-CAP-012`
    - `FACT-CAP-013`
    - `FACT-CAP-014`
  - decisions:
    - `DEC-CAP-001`
    - `DEC-CAP-002`

- browser promises must remain site-tier-gated and not silently absorb login-heavy or anti-bot work as default capability:
  - topics:
    - [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
    - [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)
  - facts:
    - `FACT-CAP-010`
  - decisions:
    - `DEC-CAP-001`

- `content` remains a task type routed through real workers rather than a first-class canonical worker lane:
  - topics:
    - [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
    - [knowledge/topics/platform-capability-matrix.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/platform-capability-matrix.md)
  - facts:
    - `FACT-CAP-021`
  - decisions:
    - `DEC-CAP-002`

## Change Log

- `2026-04-06`: seeded initial lane-responsibility packet
- `2026-04-12`: rebuilt the lane model to make `worker_lane` ownership exact, separate lane identity from run and billing semantics, and align founder-visible lane labels with hidden worker reality before later sibling cleanup
