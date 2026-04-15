# Spec: Founder Dashboard and Taskboard

- `Spec ID`: `SPEC-DASH-001`
- `Status`: rebuilt
- `Subsystem`: founder dashboard and taskboard
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent build spec`: [specs/build/founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/founder-dashboard-and-taskboard.md)

## Purpose

Define the private founder operating shell after onboarding:

- company-scoped dashboard at `/dashboard/:slug`
- lighter founder portfolio route at `/portfolio`
- task cards, taskboard modal, and task-detail modal family
- founder menu surfaces and management overlays
- relationship between roadmap, queue, documents, billing posture, channel modules, and CEO/chat
- founder-visible rules for execution gating, status wording, and milestone celebration

This subsystem exists so implementation can build the founder operating product from one coherent contract instead of inferring behavior from scattered onboarding, roadmap, billing, and runtime notes.

## Founder-Visible Contract

The founder should experience two private surfaces in the same product family:

- `/dashboard/:slug`
  - one long vertically scrollable operating dashboard for a single company
- `/portfolio`
  - a simpler founder portfolio overview reachable from the dashboard menu

On `/dashboard/:slug`, the founder should experience:

- company header with:
  - company name
  - `+ New`
  - `Menu`
- top roadmap rail directly below the header as the primary orientation surface
- left operating column with:
  - mascot or status surface
  - trial or subscription posture
  - business summary surface
  - compact `Current Focus` surface showing:
    - current focus
    - top blocker
    - why current task order exists
- center work column with:
  - starter tasks
  - documents with `View all ->`
  - links
- narrow utility column with modules such as:
  - `Twitter` with `Tweet`
  - `Email` with `Cold Outreach`
  - `Ads` with `Run Ads`
- separate persistent CEO/chat workspace on desktop
- same dashboard modules on mobile/tablet collapsed into a single-column feed instead of a different product

## Hidden System Contract

The founder dashboard is a projection junction over deeper company systems:

- company identity and settings state
- roadmap, active milestone, and light shared plan state
- company-local task queue and runtime execution state
- document and report inventory
- founder subscription, trial, and credit posture
- channel snapshot state for founder-visible surfaces like Twitter, Email, and Ads
- CEO/chat thread continuity state

The dashboard itself does not own truth for:

- task execution sessions
- credit accounting or billing ledger logic
- roadmap generation logic
- milestone verification logic
- document generation and writeback logic
- agent routing or worker orchestration

## In Scope

- private founder company dashboard route and shell
- private founder portfolio route where it belongs to the same operating family
- company header, roadmap rail, dashboard columns, and founder shell ordering
- starter-task cards, taskboard modal, task-detail modal, and inline run gating
- founder menu, overlay family, and destructive confirmation family
- desktop CEO/chat dock and mobile chat launch behavior
- founder-visible task wording rules and queue-control affordances
- dashboard-visible projection of trial, subscription, credits, milestone completion, and channel snapshots

## Out of Scope

- public `/live` wall behavior
- public homepage, sign-in, or onboarding entry surfaces themselves
- public company site presentation
- underlying worker/session execution internals
- credit-ledger implementation details
- document-generation internals beyond founder-visible projection

## Canonical Noun Imports

### roadmap rail

- **Meaning:** dashboard projection of `Roadmap` milestone state
- **Owned elsewhere for truth:** roadmap/documents child
- **Used here for:** shell placement and founder-facing presentation

### `Current Focus`

- **Meaning:** compact founder projection of light shared plan
- **Owned elsewhere for truth:** roadmap/documents child
- **Used here for:** shell placement and wording

### founder taskboard buckets

- **Meaning:** the organizing buckets shown in the taskboard modal
- **Owned here for founder-facing projection**
- **Must not be confused with:** canonical runtime states

### founder edge labels

- **Meaning:** softer task explanations used inside task cards/detail surfaces when needed
- **Owned here for founder wording**
- **Must not be confused with:** runtime enums

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| company identity/settings state | Canonical elsewhere | company/settings layer | project header/settings surfaces | re-owned here |
| roadmap rail packet | Derived | roadmap/documents child + this spec | project top-of-dashboard orientation | treated as separate planning system |
| `Current Focus` packet | Derived | roadmap/documents child + this spec | project compact operating orientation | expanded into full PM UI here |
| task queue/runtime truth | Canonical elsewhere | scheduler/runtime children | project cards, rows, labels, timers | redefined here |
| founder bucket labels | Derived | this spec | organize taskboard UI | treated as hidden runtime enums |
| founder edge labels like `Blocked`, `Needs Credits`, `Fixed`, `Couldn't Complete` | Derived | this spec | explain runtime/billing projections in task surfaces | redefined as canonical hidden states |
| trial/subscription/credits posture | Canonical elsewhere | billing children | project trial card, menu count, inline gating | re-owned here |
| CEO/chat thread continuity | Canonical elsewhere | chat/control-plane | project dock/mobile chat surface | treated as task-status authority |

## Founder-Visible Task Wording Rules

### Board organization buckets

These remain the main task-management modal buckets:

- `To Do`
- `Recurring`
- `In Progress`
- `Completed`
- `Rejected`
- `Failed`

### Softer explanatory labels

These appear only inside task cards and task-detail/taskboard surfaces when needed:

- `Blocked`
- `Needs Credits`
- `Fixed`
- `Couldn't Complete`

These are founder projections over hidden runtime/billing truth and must not be treated as canonical runtime state names.

### Runtime-to-dashboard state mapping

| `Task.status` (runtime) | Billing condition | Founder bucket | Founder edge label | Notes |
|---|---|---|---|---|
| `todo` | credits available | To Do | — | Normal queued task |
| `todo` | credits = 0 | To Do | Needs Credits | Charge gate holding execution |
| `todo` (recurring source) | any | Recurring | — | Recurring definition shown in Recurring tab |
| `in_progress` | any | In Progress | — | Timer sourced from `Run.started_at` |
| `blocked_pre_start` | any | To Do | Blocked | Never started, prerequisite unmet |
| `blocked_in_run` | any | In Progress | Blocked | Was running, got interrupted |
| `failed` | any | Failed | Couldn't Complete | Attempted but did not succeed |
| `completed` | any | Completed | — | Verification accepted |
| `repaired` | any | Completed | Fixed | Was failed, same-scope repair succeeded |
| `rejected` | any | Rejected | — | Explicitly removed by founder/platform |

### Family label consistency

The same founder-visible task family must not flip between `Growth` and `Cold Outreach`.

- `Cold Outreach` is the canonical founder-facing label.

## Surface and Flow Model

### Company dashboard shell

The private company dashboard renders, in founder reading order:

1. company header
   - company name
   - `+ New`
   - `Menu`
2. roadmap rail
   - horizontal milestone path
   - active progress indicator
   - no old founder-facing terminal strip
3. left operating column
   - mascot/status block
   - trial/subscription posture
   - business summary surface
   - compact `Current Focus`
4. center work column
   - task cards
   - documents with `View all ->`
   - links
5. utility modules column
   - Twitter with `Tweet`
   - Email with `Cold Outreach`
   - Ads with `Run Ads`
6. separate right CEO/chat workspace on desktop

### Portfolio shell

The private founder portfolio remains in the same product family but is intentionally lighter:

- founder header chrome stays available with:
  - `+ New`
  - `Menu`
- main body shows:
  - KPI row with `Views`, `Users`, `Revenue`, and `Companies`
  - company table with company name, live subdomain, short description, and summary metrics
- portfolio should not become a second per-company operations surface

### Task flow

1. onboarding or later planning seeds company-local tasks
2. starter tasks appear directly in the dashboard center column
3. founder opens `Manage ->`
4. centered `Tasks` modal opens with board buckets
5. founder can reorder rows or move one to the top without spending a credit
6. founder can open `View ->`
7. centered task-detail modal opens above the taskboard
8. founder can:
   - delete
   - edit
   - repeat
   - run now
9. run readiness, credits, subscription, and prerequisite checks happen inline
10. runtime outcomes flow back into the same shell as updated cards, labels, timers, and explanations

### Documents flow

1. founder sees a mixed `Documents` surface in the center column
2. founder can open an individual document preview from a visible row
3. founder can open `View all ->`
4. dashboard opens a read-only documents modal inside the same shell

### Utility module flow

1. founder opens `Twitter`, `Email`, or `Ads`
2. founder taps the primary action:
   - `Tweet`
   - `Cold Outreach`
   - `Run Ads`
3. dashboard opens a small action modal inside the same shell
4. submitting the action updates the corresponding module projection
5. utility actions remain believable founder controls instead of decorative buttons

### Recurring task management

Founders can define, view, and manage recurring tasks through three surfaces:

1. **CEO chat:** founder describes what should repeat and the CEO creates the recurring definition
2. **Task-detail modal:** any completed task can be set to repeat via a "Repeat" action, which opens a schedule picker
3. **Taskboard Recurring tab:** shows all active recurring definitions with schedule, last run status, and next due date

Recurring management rules:

- recurring definitions are visible in the Recurring tab regardless of credit state
- due materialized tasks appear in the To Do tab with a recurring indicator
- founder can pause, resume, or delete a recurring definition from the Recurring tab
- pausing a definition stops future materialization but does not affect already-materialized tasks

### Menu and overlays

`Menu` is an anchored dashboard-owned dropdown. Its items resolve like this:

- `My Portfolio`
  - navigates to `/portfolio`
- `New Company`
  - opens the same add-company or upgrade modal family as `+ New`
- `Task Credits`
  - shows founder credit count inline in the menu
- `Upgrade`
  - opens the centered upgrade surface
- `Company Settings`
  - opens company settings
- `Profile Settings`
  - opens founder profile settings
- `About`
  - opens longform story modal with founder authorship/date
- `FAQ`
  - opens FAQ modal
- `Refer & Earn`
  - opens referral modal
- `Logout`
  - exits the founder shell

Dashboard-owned modal family includes:

- taskboard modal
- task-detail modal
- documents modal
- company settings modal
- pause company confirmation modal
- delete company confirmation modal
- profile settings modal
- about modal
- FAQ modal
- refer-and-earn modal
- upgrade/add-company modal
- tweet compose modal
- cold-outreach action modal
- ads action modal
- milestone celebration overlay

### CEO/chat behavior

Desktop:

- chat is a distinct docked workspace, not part of the utility column
- founder can treat it as the strategy and continuity surface beside the operational dashboard
- it reads the same company, milestone, and task context but does not replace taskboard state as the canonical task-status surface
- it can sit idle with `Let's Chat`
- it stays inside the founder shell and can collapse/reopen without becoming a detached modal
- resize contract:
  - default width `250px`
  - minimum width `230px`
  - maximum width `520px`
- collapsing creates a thin right-edge reopen tab
- reopening restores the last expanded width

Mobile/tablet:

- no permanently wide CEO/chat pane
- floating chat/help affordance stays visible above the stacked feed
- tapping it opens the dedicated mobile chat surface
- same thread continues there with a close control

### Milestone celebration flow

When milestone completion is verified elsewhere:

1. roadmap state marks milestone complete
2. next active milestone becomes current
3. roadmap rail updates
4. founder sees a brief whole-screen celebration
5. CEO/chat follows with encouragement and next-step momentum

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “This is my company dashboard.” | company shell exists and founder can access it | founder may still see initializing or pending projections | Guaranteed shell continuity, best-effort hydration timing |
| “These task states are real.” | runtime and billing children supply task/billing truth | task surfaces show blocked/gated/failure explanations instead of fake completion | Guaranteed projection honesty |
| “I can manage tasks here.” | task records exist and founder has access | some actions may still be gated by billing/prerequisites | Guaranteed shell-owned task controls |
| “The roadmap tells me where we are.” | roadmap rail packet exists | dashboard may show pending orientation while startup state hydrates | Guaranteed roadmap projection semantics |
| “Chat stays with me.” | founder/company thread continuity exists | founder may see idle state but not a different thread model | Guaranteed shared thread continuity across shell modes |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| onboarding handoff | company dashboard visible | founder lands on `/dashboard/:slug` | this spec with onboarding inputs | company shell exists | company dashboard read model renders | projections may hydrate progressively |
| company dashboard | taskboard modal open | founder clicks `Manage ->` | this spec | tasks exist | centered taskboard modal opens | close returns to same shell |
| taskboard row | task-detail modal open | founder clicks `View ->` | this spec | task exists | centered task-detail modal opens | back/close returns inside same shell |
| task-detail modal | inline run/upgrade gating | founder clicks `Run Now` or equivalent | this spec consuming billing/runtime truths | task exists | founder sees run or purchase/prerequisite outcome inline | no route change required |
| verified milestone completion | celebration overlay + updated rail | milestone transition projection arrives | this spec consuming roadmap truth | milestone transition packet exists | celebration overlay appears, rail updates, CEO follow-up can appear | clears back to same shell |

## Data and Interface Contract

### Dashboard shell packet

- `company_identity_ref`
- `roadmap_rail_packet_ref`
- `current_focus_packet_ref`
- `task_projection_refs`
- `document_projection_refs`
- `link_projection_refs`
- `channel_snapshot_refs`
- `billing_posture_ref`
- `chat_thread_ref`

### Task projections

- `task_summary_card_ref`
- `task_board_row_ref`
- `task_detail_surface_ref`
- `founder_bucket_label`
- `founder_edge_label`
- `timer_state_ref`
- `inline_gating_state_ref`

### Dashboard-owned modal family

- `taskboard_modal`
- `task_detail_modal`
- `documents_modal`
- `company_settings_modal`
- `pause_company_confirmation`
- `delete_company_confirmation`
- `profile_settings_modal`
- `about_modal`
- `faq_modal`
- `referral_modal`
- `upgrade_or_add_company_modal`
- `tweet_action_modal`
- `cold_outreach_action_modal`
- `ads_action_modal`
- `milestone_celebration_overlay`
- `mobile_chat_surface`

## Implementation Trap Notes

### Trap 1: treating founder labels as runtime truth

- **Wrong assumption:** `Blocked`, `Needs Credits`, `Fixed`, and `Couldn't Complete` are the hidden system’s canonical states.
- **Why it is wrong:** runtime and billing children already own canonical state truth.
- **Correct interpretation:** this child owns founder wording and placement only.

### Trap 2: letting purchase handling escape the shell

- **Wrong assumption:** it is fine to kick founders out to unrelated pricing pages from dashboard actions.
- **Why it is wrong:** founder shell continuity is part of the product contract.
- **Correct interpretation:** route dashboard-owned purchase handling through the shared purchase family.

### Trap 3: reintroducing a second orientation strip

- **Wrong assumption:** roadmap rail and a separate terminal/activity strip can coexist as founder orientation surfaces.
- **Why it is wrong:** that creates noisy duplicate orientation.
- **Correct interpretation:** roadmap rail is the primary top-of-dashboard orientation surface.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- onboarding owns company creation, starter-task seed creation, startup-doc creation timing, and first dashboard handoff
- roadmap/documents owns roadmap semantics, active milestone, milestone completion semantics, and document truth
- billing owns trial, subscription, credits, checkout handoff rules, and zero-credit execution rules
- control-plane/runtime own queue execution, readiness checks, blocked/failed/repaired truth, and task artifact production
- purchase surfaces own hosted checkout versus in-dashboard modal routing for purchase entries

### Reconciliation notes

- this rebuilt child now clearly keeps founder bucket labels and edge labels separate from runtime truth
- this rebuilt child now keeps `Current Focus` and roadmap rail as projections from the rebuilt roadmap/documents child
- this rebuilt child now aligns `+ New`, `Upgrade`, and inline gating with the rebuilt purchase-surface child
- this rebuilt child now relies on the rebuilt runtime/billing children for honest blocked, charge-gated, failed, and repaired projections

## Acceptance Criteria

- founder dashboard and portfolio routes stay in the same product family
- founder dashboard shell ordering remains coherent and operational
- taskboard modal, task-detail modal, and inline run gating remain shell-owned
- `Task Credits` stays lightweight and informational in the menu
- `Cold Outreach` remains the canonical founder-visible family label
- roadmap rail remains the primary orientation strip on the company dashboard
- founder-visible task wording stays honest and projection-based
- desktop CEO/chat remains docked and resizable, while mobile uses the floating entry into dedicated chat surface
- milestone completion triggers a visible celebration and CEO follow-up

## Plain-Language New-Reader Tests

- Where does the founder go to inspect a task deeply?
- Does `Needs Credits` come from runtime truth or founder dashboard projection?
- Does `+ New` leave the dashboard shell or open purchase handling inside it?
- Where does the roadmap rail get its truth from?
- Is mobile chat a different product or the same thread in a different shell mode?

If a new reader cannot answer these directly from this file, the founder shell is still ambiguous.

## Traceability

### Source topics

- [specs/internal/onboarding-bootstrap.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/onboarding-bootstrap.md)
- [specs/internal/roadmap-and-documents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/roadmap-and-documents.md)
- [specs/internal/billing/purchase-surfaces-and-expansion.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/purchase-surfaces-and-expansion.md)
- [specs/internal/control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)

### Source decisions

- `DEC-DASH-001`
- `DEC-DASH-002`
- `DEC-DASH-003`
- `DEC-DASH-004`
- `DEC-DASH-005`
- `DEC-DASH-006`
- `DEC-DASH-007`
- `DEC-ROAD-001`
- `DEC-ROAD-005`
- `DEC-ROAD-006`

### Claim-to-anchor audit

- roadmap rail and milestone celebration are dashboard projections of roadmap truth:
  - topics:
    - [specs/internal/roadmap-and-documents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/roadmap-and-documents.md)
  - decisions:
    - `DEC-ROAD-001`
    - `DEC-ROAD-005`
    - `DEC-ROAD-006`

- founder task wording is softer projection language layered over runtime and billing truth:
  - topics:
    - [specs/internal/control-plane/runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
    - [specs/internal/billing/credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md)
  - decisions:
    - `DEC-DASH-002`

- centered in-dashboard modals remain the founder task and management flow instead of route-level pages:
  - decisions:
    - `DEC-DASH-003`
    - `DEC-DASH-006`

- desktop keeps a separate docked CEO/chat workspace while mobile uses floating entry into dedicated chat surface:
  - decisions:
    - `DEC-DASH-004`
    - `DEC-DASH-005`

- `Cold Outreach` is the canonical founder-facing family label:
  - decisions:
    - `DEC-DASH-007`

## Change Log

- `2026-04-08`: seeded initial founder dashboard and taskboard spec
- `2026-04-12`: rebuilt the founder shell to align roadmap, runtime, billing, and purchase projections into one coherent dashboard contract with explicit founder wording ownership
