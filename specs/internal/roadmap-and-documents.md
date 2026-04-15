# Spec: Roadmap and Documents

- `Spec ID`: `SPEC-ROAD-001`
- `Status`: rebuilt
- `Subsystem`: roadmap and company documents
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent build spec`: [specs/build/roadmap-and-documents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/roadmap-and-documents.md)

## Purpose

Define the company-brain layer that turns onboarding context and ongoing company progress into durable documents, milestone guidance, and compact operating orientation.

This spec owns:

- startup docs
- roadmap generation semantics
- active milestone derivation semantics
- light shared plan semantics
- event-based document hydration rules
- roadmap rail and milestone celebration projections
- document suggestion/review contract for post-bootstrap durable updates

## Founder-Visible Contract

The founder should experience the document and roadmap layer like this:

- every new company starts with default startup docs:
  - `Mission`
  - `Market Research`
  - `Roadmap`
- those startup docs are separate documents, not one merged startup brief
- `Mission` stays short and founder-readable:
  - why this company should exist
  - what we are building
  - where we are headed
- `Market Research` stays founder-readable with stable sections:
  - overview
  - market validation
  - competitive landscape
  - gap / opportunity
  - founder fit
  - refinements
  - first priorities
- `Roadmap` is the company journey document, not just a goal statement
- the founder should feel roadmap progress in two ways:
  - full `Roadmap` document for company-journey detail
  - top-of-dashboard roadmap rail for at-a-glance orientation
- the visible Documents area is intentionally mixed:
  - core company docs
  - generated reports and deliverables
- the founder-visible compact plan is not the full roadmap; it only shows:
  - current focus
  - top blocker
  - why current task order exists
- milestone completion should trigger:
  - brief whole-screen celebration for about 2 seconds
  - CEO congratulations and encouragement
- the founder can explicitly request document updates at any time
- strong artifacts produced in chat should be able to become saved documents instead of disappearing into conversation history
- important post-bootstrap company-brain changes should usually appear as suggestions the founder can review rather than silent rewrites

## Hidden-System Contract

- `Roadmap` is generated during onboarding, not later as a disconnected planning system
- the active milestone becomes the source for:
  - `Current Focus`
  - light shared plan
  - starter tasks
- the light shared plan is the operating plan for the active milestone, not the long-term company journey
- roadmap generation must be filtered in this order:
  - founder intent
  - archetype
  - primitive recipe
  - capability matrix
- unsupported ambitions should be excluded or honestly reframed rather than silently becoming default roadmap milestones
- documents are a maintained company brain, not a static wiki and not a per-message rewrite target
- startup docs may be written directly during bootstrap, but post-bootstrap operating-doc changes should usually stage or propose unless the founder explicitly requests the update or the evidence is strong and unambiguous

## In Scope

- startup document pack and founder-facing semantics
- document record semantics and metadata expectations
- roadmap generation and active milestone derivation
- light shared plan semantics
- roadmap archetype playbooks and seeded phase semantics
- roadmap rail projection and milestone celebration behavior
- roadmap update rules
- update triggers for:
  - `product_overview`
  - `tech_notes`
  - `brand_voice`
  - `user_research`
- document suggestion/review surface contract

## Out of Scope

- hidden queue/scheduler implementation details
- task execution internals
- billing or purchase behavior except where roadmap honesty depends on capability truth
- bootstrap login/auth timing beyond shared contracts with onboarding
- exact worker prompt formatting or transport details

## Canonical Noun Imports

### `Roadmap`

- **Meaning:** the long-term staged company journey
- **Owned here**
- **Must not be confused with:** the light shared plan or the queue

### `active_milestone`

- **Meaning:** the current phase the company should actually operate inside
- **Owned here**
- **Must not be confused with:** any single queued task

### `light_shared_plan`

- **Meaning:** the operating plan for the active milestone
- **Owned here**
- **Must not be confused with:** full roadmap or founder taskboard

### startup docs

- **Meaning:** `mission`, `market_research`, and `roadmap`
- **Owned here for semantics**
- **Creation timing shared with onboarding**

### operating docs

- **Meaning:** `product_overview`, `tech_notes`, `brand_voice`, `user_research`
- **Owned here for update semantics**

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| startup doc semantics | Canonical | this spec | define meaning and structure of startup docs | reduced to loose report blobs |
| `Roadmap` document truth | Canonical | this spec | define company journey and milestone path | replaced by queue order or chat only |
| `active_milestone` | Canonical | this spec | drive plan and roadmap rail | derived ad hoc from dashboard state |
| `light_shared_plan` | Canonical | this spec | define current operating plan | confused with roadmap |
| roadmap rail packet | Derived | this spec + dashboard | project roadmap state into dashboard | treated as separate planning system |
| document suggestion/review state | Canonical proposal seam | this spec | stage post-bootstrap updates | replaced by silent rewrites |
| queue order and task execution | Canonical elsewhere | scheduler/runtime | consume milestone/plan context | re-owned here |

## Startup Document Semantics

### `Mission`

- sections:
  - `why_this_should_exist`
  - `what_we_are_building`
  - `where_we_are_headed`
- generation logic preserves the pain/audience/unique-take/optional-boundary shape without forcing exact Mad-Libs phrasing

### `Market Research`

- sections:
  - `overview`
  - `market_validation`
  - `competitive_landscape`
  - `gap_or_opportunity`
  - `founder_fit`
  - `refinements`
  - `first_priorities`
- founder-visible title may still read `Market Research` or `Market Research Report`

### `Roadmap`

- company-journey document
- captures:
  - phase progression
  - milestone path
  - what each milestone means
  - what unlocks the next milestone
  - founder-specific direction changes

## Structural Model

### Knowledge hierarchy

- `startup docs`
  - `mission`
  - `market_research`
  - `roadmap`
- `operating docs`
  - `product_overview`
  - `tech_notes`
  - `brand_voice`
  - `user_research`
- `reports and deliverables`
  - research reports
  - execution outputs
  - saved chat artifacts

### Planning hierarchy

- `Roadmap`
  - long-term staged company journey
  - milestone path
  - unlock logic
- `active_milestone`
  - current phase inside roadmap
- `light_shared_plan`
  - operating plan for the active milestone
- `tasks`
  - concrete execution slices inside the current milestone and light shared plan

### Projection hierarchy

- `Roadmap` projects to:
  - roadmap rail
  - milestone celebration state
- `light_shared_plan` projects to:
  - `Current Focus`
  - `top blocker`
  - `why current task order exists`
- `Documents and reports` project to:
  - mixed founder-visible documents list

## Causal Story

1. onboarding saves the durable startup docs so the company has a real mission, research packet, and staged path
2. because `Roadmap` exists, the system can derive an honest `active_milestone`
3. because the active milestone exists, the `light_shared_plan` can summarize what matters right now
4. because the light shared plan exists, the founder can see `Current Focus` and the queue can stay aligned with the same company phase
5. as execution outcomes happen, durable changes promote into operating docs and verified milestone completion updates the roadmap itself
6. because roadmap remains stable while the plan updates more frequently, the founder gets both:
   - long-term direction
   - short-term operating clarity

## Stage Semantics

### `save_mission`

- purpose:
  - convert company framing into a stable north-star document
- likely inputs:
  - founder/business enrichment
  - founder angle
  - selected strategy
- output:
  - `mission` document saved
- founder-visible effect:
  - `Mission` appears in Documents as part of startup pack

### `generate_market_research`

- purpose:
  - turn enriched company context into market, competitor, and opportunity framing
- likely inputs:
  - business enrichment
  - market/category context
  - competitor signals
- output:
  - `market_research` document saved
- founder-visible effect:
  - `Market Research` appears in Documents

### `generate_roadmap`

- purpose:
  - create the long-term company journey document
- likely inputs:
  - founder intent
  - archetype
  - primitive recipe
  - capability matrix
  - mission
  - market research
- output:
  - `roadmap` saved with phases, success signals, and unlock logic
- founder-visible effect:
  - founder can open a real roadmap document instead of only seeing tactical tasks

### `derive_active_milestone`

- purpose:
  - choose the phase the company should actually operate inside now
- likely inputs:
  - roadmap phases
  - current company state
  - supported capability envelope
- output:
  - active milestone state saved
- founder-visible effect:
  - roadmap rail knows which node is active

### `refresh_light_shared_plan`

- purpose:
  - turn the active milestone into a compact operating plan
- likely inputs:
  - active milestone
  - founder priority
  - blockers
  - recent execution outcomes
- output:
  - plan object updated with current focus, blocker, ordered tasks, rationale
- founder-visible effect:
  - `Current Focus` remains coherent without heavy PM UI

### `promote_operating_doc_update`

- purpose:
  - keep durable operating docs alive without rewriting them after every chat
- likely inputs:
  - founder-confirmed decisions
  - verified shipped work
  - repeated real-user evidence
  - repeated founder tone corrections
  - explicit founder update requests
- output:
  - staged proposal or direct write depending on confidence and explicitness
- founder-visible effect:
  - documents feel maintained rather than empty or stale

### `materialize_chat_artifact`

- purpose:
  - convert a strong chat artifact into a durable saved document
- likely inputs:
  - chat draft
  - founder or CEO request
  - review or acceptance
- output:
  - canonical document or report saved with provenance
- founder-visible effect:
  - strong chat artifacts become real saved documents

### `celebrate_milestone`

- purpose:
  - make milestone completion visible and motivating
- likely inputs:
  - verified milestone completion
  - next milestone availability
- output:
  - short celebration event and CEO follow-up trigger
- founder-visible effect:
  - whole-screen celebration followed by CEO encouragement

## Roadmap Generation Guardrails

`Roadmap` generation must be filtered first by explicit founder intent, then by:

- company archetype
- primitive recipe
- platform capability matrix

A milestone should only enter the default roadmap if:

- it matches founder intent
- it fits the company archetype
- its primitive recipe stays inside the capability envelope
- the platform can directly build, directly operate, or materially improve it
- it logically unlocks the next phase

If a proposed milestone fails those checks, it should not become a default roadmap milestone.

## Roadmap Update Rules

Update `Roadmap` only when:

- a milestone completes
- a founder-approved direction change alters the company path
- a major company-state change materially changes the journey

Do **not** update `Roadmap` merely because CEO suggests a new tactical next step.

Normal tactical suggestions should update the light shared plan first.

## Operating-Doc Update Rules

### `product_overview`

Update when:

- a founder-confirmed product decision changes user-facing product truth
- verified shipped work changes what the product does
- core workflow, onboarding, pricing, CTA, main use case, or target user changes materially

Do not update for:

- vague brainstorming
- unfinished ideas
- minor polish
- copy tweaks that do not change product truth

### `tech_notes`

Update when completed work creates durable technical knowledge such as:

- schema changes
- API behavior changes
- auth changes
- deployment or infrastructure changes
- integration changes
- architectural decisions
- important limitations/workarounds future engineers need

Do not update for:

- trivial UI polish
- content-only work
- tiny refactors with no durable technical consequence

### `user_research`

Update when repeated real-user evidence changes customer truth such as:

- new user segment discovered from real users
- customer feedback that changes problem understanding
- churn patterns or repeated objections revealing mismatch
- onboarding drop-off insights from real data
- pricing-sensitivity signals from actual behavior
- ICP refinement based on evidence

Do not update for:

- one-off anecdotal feedback with no pattern
- hypothetical personas not validated
- speculative targeting ideas without evidence
- survey ideas or research plans that are still future work

### `brand_voice`

Update when durable communication truth changes such as:

- founder explicitly sets a new tone direction
- brand positioning shifts enough to change how the company should sound
- repeated founder corrections on tone appear across tasks

Do not update for:

- one-off copy edits
- temporary A/B-test variants
- exploratory drafts not endorsed by the founder
- casual chat tone variation
- isolated tweet rewrites

## Document Suggestion / Review Contract

Post-bootstrap meaningful company-brain changes should usually follow:

- durable change detected
- suggestion generated
- founder can `accept`, `edit`, or `skip`
- canonical document updates only after that review when silent direct update is not justified

Direct writes are still allowed when:

- startup docs are created during bootstrap
- the founder explicitly requests the document update
- the signal is strong and unambiguous enough to count as durable truth

## Document Update Trigger Ownership

Document updates are triggered by the control plane as a post-verification side effect, not by a cron job or scheduled process:

### Trigger chain

1. A task completes and passes verification
2. The control plane evaluates whether the completed task produced information that should update a core document
3. If yes, the control plane creates a `document_suggestion` (not a direct write) for founder review
4. The founder reviews and accepts/rejects the suggestion from the dashboard

### What is NOT a valid trigger

- Cron jobs or scheduled processes must not silently update core documents
- Workers must not directly write to core documents during execution
- Night shift must not update documents as a side effect of task repair

### Exception: bootstrap writes

During onboarding bootstrap, startup documents (`Mission`, `Market Research`, `Roadmap`) are written directly because the founder has not yet seen them. Post-bootstrap, all updates follow the suggestion flow.

## Archetype Playbook Rule

The three default packs remain:

- `SaaS / Tool`
- `Service / Agency`
- `Grow my company / Existing Business`

Each seeded phase must carry semantic structure, not only a name:

- `phase_name`
- `what_it_means`
- `success_signal`
- `what_platform_can_help_with`
- `unlocks_next_phase`

Playbooks are stable defaults underneath. Per company, the system may adapt:

- milestone wording
- success metric
- phase emphasis
- active milestone
- starter tasks

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “These are my company docs.” | startup docs and saved artifacts exist | docs may appear progressively during bootstrap | Guaranteed mixed Documents surface, best-effort hydration timing |
| “This roadmap shows where we’re headed.” | roadmap generated from founder intent plus capability guardrails | roadmap may remain pending during bootstrap | Guaranteed roadmap-as-journey semantics |
| “Current Focus tells me what matters now.” | active milestone and light shared plan exist | dashboard may show pending/partial state during bootstrap | Guaranteed compact projection, not full PM interface |
| “The docs stay up to date.” | durable change detection and update flow work | founder may receive staged suggestions instead of silent rewrites | Best-effort living company brain with controlled updates |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| onboarding context ready | startup docs created | bootstrap document generation | onboarding + this spec | enriched company framing exists | `mission`, `market_research`, `roadmap` saved | progressive visibility allowed during bootstrap |
| roadmap exists | active milestone derived | roadmap derivation step | this spec | roadmap phases available | active milestone saved | later milestone changes can re-derive |
| active milestone exists | light shared plan refreshed | milestone or operating context changes | this spec | milestone state available | compact plan refreshed | may update more frequently than roadmap |
| milestone verified complete | roadmap advanced | milestone completion verified elsewhere | this spec consuming verified signal | unlock logic satisfied | roadmap updated, next milestone active, celebration emitted | later milestones repeat same flow |
| durable operating-doc signal | suggested or direct document update | event-based hydration rule fires | this spec | signal strong enough or founder explicitly requested update | doc proposal or doc write created | founder review required when silent update is not justified |

## Data and Interface Contract

### Document record metadata

Each saved document should carry metadata such as:

- document type
- source
- created_at
- updated_at
- company_id
- provenance or evidence note where relevant

### Startup docs contract

- `mission`
  - sections:
    - `why_this_should_exist`
    - `what_we_are_building`
    - `where_we_are_headed`
- `market_research`
  - sections:
    - `overview`
    - `market_validation`
    - `competitive_landscape`
    - `gap_or_opportunity`
    - `founder_fit`
    - `refinements`
    - `first_priorities`
- `roadmap`
  - fields:
    - archetype
    - `current_milestone_id`
    - milestone phases
    - success signals
    - unlock logic
    - last strategic update source

### Roadmap phase schema

Every roadmap phase should use:

- `phase_name`
- `what_it_means`
- `success_signal`
- `what_platform_can_help_with`
- `unlocks_next_phase`

### Light shared plan object

- `current_phase`
- `current_main_goal`
- `founder_priority`
- `top_blocker`
- `ordered_next_tasks`
- `short_rationale`
- `last_major_update_source`

### Projection packets

- `roadmap_rail_packet`
  - ordered milestones
  - active milestone id
  - completed milestone ids
  - upcoming milestone ids
  - progress position
- `current_focus_summary_packet`
  - current focus
  - top blocker
  - task-order rationale
- `milestone_transition_packet`
  - completed milestone id
  - next milestone id
  - celebration pending
  - CEO follow-up pending
- `document_suggestion_packet`
  - target doc
  - reason
  - proposed change summary
  - accept/edit/skip options

## Implementation Trap Notes

### Trap 1: treating roadmap as queue order

- **Wrong assumption:** whatever is top of the task queue is the roadmap.
- **Why it is wrong:** roadmap is company journey truth, not transient task ordering.
- **Correct interpretation:** roadmap -> active milestone -> light shared plan -> tasks.

### Trap 2: rewriting docs after every chat

- **Wrong assumption:** if docs are living, every chat turn should mutate them.
- **Why it is wrong:** that creates noise and destroys trust in the docs.
- **Correct interpretation:** update only on durable signals, with staged suggestions when appropriate.

### Trap 3: letting empty startup docs persist indefinitely

- **Wrong assumption:** docs can remain mostly empty and workers will rediscover context as needed.
- **Why it is wrong:** empty docs degrade later execution quality.
- **Correct interpretation:** startup docs must exist from day one and operating docs should hydrate over time.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- onboarding owns startup-doc creation timing and first visibility
- dashboard owns rendering of roadmap rail, documents area, and current-focus projections
- control-plane/runtime own execution, milestone verification, and task artifacts that feed this layer
- capability matrix constrains what roadmap may honestly promise

### Reconciliation notes

- this rebuilt child now clearly separates roadmap from light shared plan
- this rebuilt child now adds an explicit suggestion/review contract for post-bootstrap durable doc changes
- this rebuilt child now keeps dashboard projections dependent on named roadmap/plan sources rather than local UI invention

## Acceptance Criteria

- startup docs are clearly separate and semantically defined
- roadmap is clearly the company-journey document
- active milestone and light shared plan are distinct and causally connected
- operating-doc update triggers are explicit and bounded
- founder can explicitly request document updates at any time
- post-bootstrap doc changes can flow through suggestion/review when direct silent updates are not justified
- roadmap rail and `Current Focus` are projections of named durable sources
- milestone completion updates roadmap and triggers celebration plus CEO follow-up

## Plain-Language New-Reader Tests

- What is the difference between `Roadmap` and the light shared plan?
- Which thing drives starter tasks: roadmap, milestone, or queue order?
- When should `Roadmap` change, and when should only `Current Focus` change?
- Are operating-doc updates always silent, always manual, or staged when appropriate?
- Where does the roadmap rail get its truth from?

If a new reader cannot answer these directly from this file, the company-brain layer is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/documents-roadmap-and-plan.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/documents-roadmap-and-plan.md)
- [specs/internal/onboarding-bootstrap.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/onboarding-bootstrap.md)
- [specs/internal/founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md)

### Source decisions

- `DEC-DOC-001`
- `DEC-DOC-002`
- `DEC-DOC-003`
- `DEC-ROAD-001`
- `DEC-ROAD-002`
- `DEC-ROAD-003`
- `DEC-ROAD-004`
- `DEC-ROAD-005`
- `DEC-ROAD-006`
- `DEC-PLAN-001`
- `DEC-ONB-003`

### Claim-to-anchor audit

- startup docs are `Mission`, `Market Research`, and `Roadmap`:
  - topics:
    - [knowledge/topics/documents-roadmap-and-plan.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/documents-roadmap-and-plan.md)
  - decisions:
    - `DEC-DOC-001`

- roadmap is generated during onboarding and active milestone is derived before starter tasks:
  - topics:
    - [knowledge/topics/documents-roadmap-and-plan.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/documents-roadmap-and-plan.md)
    - [specs/internal/onboarding-bootstrap.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/onboarding-bootstrap.md)
  - decisions:
    - `DEC-ONB-003`

- roadmap generation must be filtered by founder intent, archetype, primitive recipe, and capability matrix:
  - topics:
    - [knowledge/topics/documents-roadmap-and-plan.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/documents-roadmap-and-plan.md)
  - decisions:
    - `DEC-ROAD-003`
    - `DEC-ROAD-004`

- the founder-visible compact plan is only `Current Focus`, top blocker, and task-order rationale:
  - topics:
    - [knowledge/topics/documents-roadmap-and-plan.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/documents-roadmap-and-plan.md)
  - decisions:
    - `DEC-PLAN-001`

- roadmap rail and milestone celebration are dashboard projections of roadmap truth:
  - topics:
    - [knowledge/topics/documents-roadmap-and-plan.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/documents-roadmap-and-plan.md)
    - [specs/internal/founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md)
  - decisions:
    - `DEC-ROAD-001`
    - `DEC-ROAD-005`
    - `DEC-ROAD-006`

- operating docs hydrate over time with bounded, event-based update rules rather than per-message rewrite:
  - topics:
    - [knowledge/topics/documents-roadmap-and-plan.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/documents-roadmap-and-plan.md)
  - decisions:
    - `DEC-DOC-002`
    - `DEC-DOC-003`

## Change Log

- `2026-04-08`: seeded initial roadmap and documents spec
- `2026-04-12`: rebuilt the company-brain layer to separate roadmap from light shared plan, add explicit document suggestion/review semantics, and align startup docs, milestones, and dashboard projections with the rebuilt onboarding and billing siblings
