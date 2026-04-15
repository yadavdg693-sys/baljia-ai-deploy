# Spec: Onboarding Bootstrap

- `Spec ID`: `SPEC-ONB-001`
- `Status`: rebuilt
- `Subsystem`: onboarding bootstrap
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent build spec`: [specs/build/onboarding-bootstrap.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/onboarding-bootstrap.md)

## Purpose

Define the founder-visible onboarding flow, the hidden bootstrap control plane, and the contract between public entry, auth branching, quick-start submission, initializing dashboard, bootstrap proof bundle, and the first CEO/task surfaces.

This spec owns:

- public onboarding IA
- quick-start branching and terminal intent model
- draft-company creation and initializing-dashboard handoff
- bootstrap-time artifact creation timing
- first CEO onboarding message contract
- bootstrap-time archetype classification as an onboarding step

## Founder-Visible Contract

The founder should experience onboarding like this:

- public onboarding is lightweight and question-led
- the visible onboarding UI is a two-step tree, not four equal backend modes
- the four visible founder choices across the public IA are:
  - `Create a new company`
  - `Grow my company`
  - `Surprise me`
  - `Build my idea`
- the canonical terminal onboarding path family remains:
  - `Surprise me`
  - `Build my idea`
  - `Grow my company`
- `Create a new company` is a branch selector only, not a submitted bootstrap mode
- after quick-start and authentication, the founder lands in an initializing dashboard quickly
- bootstrap artifacts appear as hidden bootstrap finishes:
  - company shell
  - generated company name and slug
  - subdomain
  - landing page
  - dashboard shell
  - company inbox identity
  - welcome email
  - launch tweet or launch artifact
  - `Mission`
  - `Market Research`
  - `Roadmap`
  - starter tasks
  - dashboard links into those artifacts
  - first CEO bootstrap summary
- the emotional product effect is part of the contract:
  - the company should feel already alive before the founder spends credits manually
- trial is the execution unlock, not the visibility unlock

## Hidden System Contract

- search and enrichment happen before naming and before artifact generation
- hidden bootstrap accepts only terminal onboarding intents:
  - `surprise_me`
  - `build_my_idea`
  - `grow_company`
- hidden bootstrap must not treat `create_new_company` as a terminal submitted mode
- bootstrap pipeline remains:
  - `heartbeat`
  - `enrich_founder`
  - `enrich_business`
  - `persist_context`
  - `extract_founder_angle`
  - `select_strategy`
  - `classify_archetype`
  - `name_company`
  - `provision_infrastructure`
  - `generate_market_research`
  - `save_mission`
  - `generate_roadmap`
  - `derive_active_milestone`
  - `create_starter_tasks`
  - `flush_diagnostics`
  - `celebrate`
- extra rebuild steps remain hidden control-plane work
- starter tasks come from the active milestone, not from a disconnected static bundle
- hidden bootstrap should tolerate partial failure and progressive completion

## In Scope

- public landing/auth to quick-start handoff
- quick-start branch behavior
- draft company creation before full dashboard use
- path-dependent naming during onboarding
- hidden bootstrap sequencing
- initializing dashboard state
- first artifact and task appearance
- first CEO bootstrap summary
- initial generated public company-site shape

## Out of Scope

- founder dashboard shell beyond onboarding-critical surfaces
- post-onboarding task execution behavior
- billing lifecycle after trial activation

## Canonical Noun Imports

### terminal onboarding intent

- **Meaning:** one of `surprise_me`, `build_my_idea`, `grow_company`
- **Owned here**
- **Must not be confused with:** `Create a new company`, which is a branch selector only

### bootstrap proof bundle

- **Meaning:** the pre-trial visible startup artifacts proving the company already exists
- **Owned here for creation timing**
- **Not to be confused with:** execution unlock

### `execution_unlocked`

- **Imported meaning only:** whether execution may begin for the company posture
- **Owned elsewhere:** trial unlock child
- **Used here for:** boundary explanation only

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| public onboarding branch state | Canonical | this spec | control visible IA tree | treated as terminal bootstrap intent |
| terminal onboarding intent | Canonical | this spec | start hidden bootstrap | confused with UI branch selector |
| bootstrap proof bundle visibility | Canonical timing/projection contract | this spec | define pre-trial visible value | treated as execution unlock |
| startup-doc semantics | Canonical elsewhere | roadmap/documents spec | ensure startup docs appear during bootstrap | redefined here |
| `execution_unlocked` | Canonical elsewhere | trial unlock child | explain pre-trial vs post-trial boundary | redefined here |

## Public IA Tree

### Visible tree

1. `/new` root
   - `Create a new company`
   - `Grow my company`
2. if `Create a new company` is chosen:
   - `Surprise me`
   - `Build my idea`

### Canonical backend terminal intents

Only these are terminal submitted modes:

- `grow_company`
- `build_my_idea`
- `surprise_me`

`create_new_company` is a non-terminal branch selector only:

- it advances the founder into the second step
- it must never create a bootstrap run by itself
- it must never be stored as the final onboarding mode for a company

## Public Flow

1. founder lands on public homepage
2. founder opens `Get Started` and sees `Create a free account`
3. founder creates account with Google or email
4. new email signup first routes through `/api/waitlist`
5. existing-user or magic-link-sent signup can stop in `Check your email`
6. new-user signup routes to `/new?email=...`
7. `Sign in` remains a separate passwordless login surface
8. founder chooses root branch and then terminal path if applicable
9. quick-start submission creates draft account/company shell
10. unauthenticated founders are redirected to passwordless login with dashboard redirect target
11. founder lands in initializing dashboard

## Waitlist Gate

The platform supports a togglable waitlist gate controlled by a feature flag:

### Feature flag: `waitlist_enabled`

- **When enabled (`true`):**
  - new email signups route through `/api/waitlist` and receive a "You're on the list" confirmation
  - the founder does NOT proceed to onboarding until manually approved or the flag is turned off
  - Google OAuth signups also route through the waitlist
  - approved waitlist entries receive a magic link to proceed to `/new`

- **When disabled (`false`):**
  - all signups proceed directly to onboarding as described in the Public Flow
  - step 4 in Public Flow (`/api/waitlist`) is skipped entirely
  - this is the default production state after launch ramp-up

### Waitlist data

- `waitlist_entry_id`
- `email`
- `source` (direct, referral, etc.)
- `status`: `pending | approved | rejected`
- `created_at`
- `approved_at`

## Naming Flow

1. hidden bootstrap receives one of the three terminal intents
2. naming logic branches by path:
   - existing-business preservation for `Grow my company`
   - founder-idea-led framing for `Build my idea`
   - hidden enrichment-led framing for `Surprise me`
3. naming uses the finalized business framing plus market/location context when useful
4. founder can rename later from company settings

## Bootstrap Progression Model

- hidden bootstrap begins only after terminal onboarding intent is submitted
- founder-facing dashboard can appear while bootstrap is still incomplete
- bootstrap proof appears progressively, but intended dependency order is:
  1. draft company shell
  2. naming and slug
  3. provisioning and public-site shell
  4. startup documents
  5. active milestone
  6. starter-task trio
  7. first CEO onboarding message
- trial activation happens after this bootstrap proof posture, not before it

## Bootstrap Proof Bundle

The proof bundle includes:

- company shell
- generated company name and slug
- subdomain
- landing page
- dashboard shell
- company inbox identity
- welcome email
- launch tweet or launch artifact
- `Mission`
- `Market Research`
- `Roadmap`
- starter-task trio
- links into those artifacts
- first CEO bootstrap summary

## Startup Artifact Causal Story

1. hidden bootstrap enriches context
2. company is named and provisioned
3. `Mission`, `Market Research`, and `Roadmap` are generated
4. company inbox identity, welcome email, and launch artifact are created
5. active milestone is derived
6. first three starter tasks are created from that milestone
7. landing page and dashboard links point to the generated artifacts
8. CEO bootstrap message appears with checklist plus queued tasks

## Starter Task Rule

The stable starter-task trio remains:

- one build or product task
- one market or competitor analysis task
- one audience, outreach, or growth task

The trio is stable at founder-visible shape, but it now derives from the active milestone instead of from a disconnected static bundle.

### Bootstrap-to-runtime handoff

Bootstrap creates starter tasks as canonical `Task` records (as defined in `runtime-entities-and-task-lifecycle.md`):

- three `Task` records are created with `status = todo` during the bootstrap pipeline
- tasks are funded by a platform-provisioned bootstrap credit (not charged to the founder)
- these are the same `Task` entities that appear in the founder's dashboard and taskboard
- they sit in `todo` until trial activation flips `execution_unlocked = true`
- no separate "bootstrap task" entity exists — starter tasks are normal runtime tasks from creation

## Trial Boundary and Handoff

- bootstrap artifacts are visible before card capture
- before trial:
  - company shell exists
  - site can already be live
  - inbox identity exists
  - starter tasks can already sit in `todo`
  - planning and CEO chat continue
- after trial starts:
  - queued starter tasks become runnable
  - manual task execution can begin
  - night shifts can operate
- founder-visible trial packaging at this boundary remains:
  - `3-day` free trial
  - `10` trial credits
  - `3` night shifts

## Generated Company-Site Shape

Bootstrap site generation is agent-based: the Engineering lane generates the site using a platform-provisioned bootstrap credit (not charged to the founder). This is hidden execution that happens before trial activation.

The default bootstrap site can be launch-first and narrative-first:

- wordmark or brand name
- category tag
- hard-hitting headline
- short explanatory paragraph
- compact proof strip
- problem framing
- feature blocks
- `How it works`
- closing manifesto
- `Built and operated by Baljia` attribution

A public form, pricing block, or obvious signup CTA is not required in the first bootstrap site.

## First CEO Onboarding Message

1. CEO starts with:
   - `I've set up everything for {CompanyName}:`
2. CEO shows a completed-checklist block before listing starter tasks
3. checklist commonly includes:
   - research done
   - welcome email sent from `{slug}@baljia.ai`
   - tweet posted from `@baljia`
   - landing page built at the company URL
   - mission created
   - market research saved
   - three tasks queued for cycle 1
4. CEO then lists the three starter tasks explicitly
5. CEO closes with:
   - `To continue building, subscribe to start your first operating cycle.`
   - daily-progress promise

## Geolocation and Locale Handling

- `timezone` is part of the observed onboarding submission contract for `Build my idea` and `Grow my company`
- rebuild internal payload should preserve `timezone` explicitly
- location or locale context may also come from:
  - IP-derived market hints
  - browser locale
  - OAuth/profile metadata when available
- these signals can shape early framing, local-market examples, and scheduling defaults, but should not be treated as founder-visible promised personalization unless later locked more strongly

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “We can get started quickly.” | public auth and quick-start handoff succeed | founder may stop in `Check your email` or pending auth posture | Best-effort quick handoff, not guaranteed instant dashboard |
| “My company already exists before trial.” | bootstrap proof bundle created progressively | founder may see initializing/pending surfaces until some artifacts finish | Guaranteed continuity of company shell, best-effort hydration timing |
| “These tasks are real.” | starter tasks are seeded from active milestone | execution still remains trial-gated | Guaranteed queue presence before manual execution |
| “Trial starts the work.” | card-required trial activation succeeds | founder stays in planning-only posture | Guaranteed trial boundary rule, not payment success |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| public landing | branch selection | founder navigates `/new` | this spec | founder created account or reached public onboarding | UI branch state changes | must not create bootstrap yet |
| branch selection | terminal onboarding intent | founder chooses one of three terminal paths | this spec | path-specific inputs valid | hidden bootstrap may start | if input incomplete, remain in current branch screen |
| terminal onboarding intent | draft company shell | quick-start submission succeeds | this spec | valid quick-start payload | company shell created, placeholder slug allowed | auth handoff may still be required |
| draft company shell | initializing dashboard | auth/dashboard handoff succeeds | this spec | dashboard redirect target valid | founder sees operating shell while bootstrap continues | progressive hydration may continue after first render |
| initializing dashboard | bootstrap proof bundle visible | hidden bootstrap progresses | this spec with roadmap/documents sibling | startup docs and artifacts finish progressively | docs/tasks/site/CEO summary appear | partial failure may leave pending state while retries/remediation continue |

## Document Suggestion / Review Note

Startup docs may be written directly during bootstrap.

Post-bootstrap durable doc changes are governed by roadmap/documents:

- direct founder-requested updates may write directly
- many important post-bootstrap changes should be staged as reviewable suggestions instead of silent rewrites

## Implementation Trap Notes

### Trap 1: treating `Create a new company` as a terminal mode

- **Wrong assumption:** it is one of the real backend onboarding modes.
- **Why it is wrong:** it is only a visible branch selector.
- **Correct interpretation:** only `surprise_me`, `build_my_idea`, and `grow_company` are terminal bootstrap intents.

### Trap 2: treating trial as visibility unlock

- **Wrong assumption:** founders should not see real company artifacts before paying.
- **Why it is wrong:** bootstrap proof before trial is part of the core product effect.
- **Correct interpretation:** trial unlocks execution, not company existence.

### Trap 3: treating starter tasks as disconnected onboarding extras

- **Wrong assumption:** the starter trio is static and unrelated to roadmap state.
- **Why it is wrong:** rebuild semantics require starter tasks to derive from the active milestone.
- **Correct interpretation:** preserve the trio shape while grounding it in milestone logic.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- onboarding owns the two-step public IA, terminal intent model, draft-company handoff, and first CEO/bootstrap proof contract
- roadmap/documents owns startup-doc semantics, roadmap semantics, and deeper archetype-playbook logic
- billing owns trial unlock semantics and checkout/purchase-surface routing
- dashboard owns founder-shell projection of tasks, docs, links, trial card, and CEO pane

### Reconciliation notes

- this rebuilt child now clearly separates visible branch selectors from terminal backend modes
- this rebuilt child now includes `Roadmap` in the bootstrap proof bundle and aligns that with the rebuilt roadmap/documents spec
- this rebuilt child keeps bootstrap artifact visibility before trial and execution unlock after trial aligned with the rebuilt trial child

## Acceptance Criteria

- founders can complete public onboarding without a long visible setup wizard
- draft company shell is created before the founder reaches the operating dashboard
- founders land in an initializing dashboard quickly
- visible onboarding screens preserve the lightweight current copy shape
- path-dependent naming remains intact and founders can rename later
- search/enrichment happens before naming and artifact generation
- `Mission`, `Market Research`, and `Roadmap` appear progressively
- landing page, inbox identity, welcome email, and launch artifact appear as part of the bootstrap proof bundle
- first three starter tasks come from the active milestone while preserving the stable trio shape
- same starter tasks appear both in the first CEO message and as real dashboard task cards
- bootstrap artifacts remain visible before card capture, and trial acts as execution unlock rather than visibility unlock
- first CEO message uses checklist -> starter tasks -> subscribe-to-continue pattern

## Plain-Language New-Reader Tests

- Is `Create a new company` a real submitted mode or just a branch selector?
- What exactly exists before trial starts?
- When does the founder first see the dashboard?
- Do starter tasks come from a fixed bundle or from the active milestone?
- What is the difference between bootstrap proof and execution unlock?

If a new reader cannot answer these directly from this file, the onboarding model is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/onboarding.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/onboarding.md)
- [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [specs/internal/roadmap-and-documents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/roadmap-and-documents.md)

### Source decisions

- `DEC-ONB-001`
- `DEC-ONB-002`
- `DEC-ONB-003`
- `DEC-ONB-004`
- `DEC-ONB-005`
- `DEC-ONB-006`
- `DEC-ONB-007`
- `DEC-BOOT-001`
- `DEC-CEO-001`
- `DEC-NAME-001`
- `DEC-NAME-002`
- `DEC-TASK-001`
- `DEC-TRIAL-001`
- `DEC-DOC-001`
- `DEC-PLAN-001`

### Claim-to-anchor audit

- `Create a new company` is a non-terminal branch selector rather than a submitted bootstrap mode:
  - topics:
    - [knowledge/topics/onboarding.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/onboarding.md)
  - decisions:
    - `DEC-ONB-001`
    - `DEC-ONB-005`

- hidden bootstrap remains behind the public quick-start flow, with initializing-dashboard handoff and partial-progress tolerance:
  - topics:
    - [knowledge/topics/onboarding.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/onboarding.md)
  - decisions:
    - `DEC-ONB-006`

- `Roadmap` is created during onboarding and the first starter-task batch comes from the active milestone:
  - topics:
    - [knowledge/topics/onboarding.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/onboarding.md)
    - [specs/internal/roadmap-and-documents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/roadmap-and-documents.md)
  - decisions:
    - `DEC-ONB-003`
    - `DEC-DOC-001`
    - `DEC-PLAN-001`

- bootstrap proof remains visible before trial and trial acts as execution unlock:
  - topics:
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - decisions:
    - `DEC-TRIAL-001`
    - `DEC-BOOT-001`

## Change Log

- `2026-04-08`: seeded initial onboarding bootstrap spec
- `2026-04-12`: rebuilt the onboarding model to align public IA, hidden bootstrap, roadmap creation, starter-task derivation, and trial boundary semantics with the rebuilt roadmap and billing siblings
