# Spec: Live Wall and Projections

- `Spec ID`: `SPEC-LIVE-001`
- `Status`: rebuilt
- `Subsystem`: live wall and projection surfaces
- `Classification`: product subsystem
- `Sensitivity`: internal spec plus sanitized build spec
- `Parent build spec`: [specs/build/live-wall-and-projections.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/live-wall-and-projections.md)

## Purpose

Define the public proof-of-work surfaces and projection logic:

- `/live`
- grouped event feeds
- counters, timers, and orange deltas
- boundary between public proof and founder-private operating views
- current live-status projection versus historical proof events

This subsystem exists so the event-driven trust surface is implemented as a projection system instead of a fake animated marketing page.

## Founder-Visible / Public Contract

The public should experience:

- a real operations wall feeling, not a static marketing page
- live task cards with:
  - owner tags
  - timers
- orange-highlighted changes or deltas when numbers move
- rolling feeds for:
  - tasks
  - companies
  - documents
  - Twitter
  - Email
  - Ads
- last-24-hour counters
- structured operating sections rather than one unbounded noisy feed

The current exact public `/live` shell includes:

- top black terminal/activity strip
- `Baljia` plus `LIVE` badge
- `Try Baljia` CTA
- sectioned layout for:
  - mascot or mood block
  - business metrics with chart
  - Tasks
  - Companies
  - Documents
  - Twitter
  - Email
  - Ads
  - `Live Chat` prompt or CTA

The founder/public should not experience `/live` as if it were the private company dashboard.

## Hidden-System Contract

The live wall is powered by a projection layer over grouped event families.

The projection layer is distinct from:

- the systems emitting the events
- founder-private dashboard state
- task execution runtime
- billing ledgers

The same underlying event model may power:

- public `/live`
- founder dashboard status surfaces
- task timers
- roadmap/milestone motion projections where appropriate

But public `/live` must stay public-safe and hosting-state-aware.

## In Scope

- public `/live` shell and section structure
- grouped feed behavior
- public counters, deltas, and timers
- current-status projection versus historical proof separation
- hosting-state gating for public projections
- relationship between event model and founder-private projections

## Out of Scope

- founder-private dashboard controls
- route-level task management UI
- onboarding
- exact internal event transport implementation
- exact animation timing

## Canonical Noun Imports

### public proof event

- **Meaning:** a public-safe historical event that can appear in a bounded recent feed
- **Owned here for projection semantics**

### current live-status projection

- **Meaning:** the current-state view derived from fresh public-safe sources, not merely recent history
- **Owned here for projection semantics**
- **Must not be confused with:** historical proof feed entries

### `hosting_state`

- **Imported meaning:** public-runtime continuity posture
- **Owned elsewhere:** subscription-continuity child
- **Used here for:** hard gating of what may still appear as currently live

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| public proof event family | Canonical projection grouping | this spec | grouped `/live` sections | flattened into one unbounded feed |
| current live-status projection | Canonical projection layer | this spec | decide what appears live now | replaced by simple recent-event history |
| public-safe visibility scope | Canonical projection rule | this spec | filter public events | ignored in favor of raw internal events |
| `hosting_state` | Canonical elsewhere | continuity child | gate whether a company may appear currently live | redefined here |
| founder dashboard status surfaces | Canonical elsewhere | founder dashboard child | compared for overlap only | re-owned here |

## Section Structure

Public `/live` should remain organized into repeated operating sections:

- mascot or mood block
- business metrics with trend chart
- Tasks
- Companies
- Documents
- Twitter
- Email
- Ads
- `Live Chat` prompt or CTA

Each major activity section should show recent-volume proof such as:

- tasks completed in the past 24h
- companies launched in the past 24h
- documents created in the past 24h
- tweets in the past 24h
- emails in the past 24h
- ads created in the past 24h

## Projection Families

The live wall must project grouped event families rather than flattening everything together:

- provisioning and infrastructure
- documents and knowledge
- company communications
- taskboard and execution
- live dashboard projection
- billing and gating
- connection and identity

## Current-vs-Historical Projection Rule

This split is mandatory.

### Historical proof feed

- shows recent public-safe events
- bounded rolling windows are allowed
- a company can still appear in historical proof even if it is no longer currently live

### Current live-status projection

- shows what is actively live now
- must respect freshness/TTL rules
- must respect `hosting_state`
- must not infer current liveness only from a recent historical event

In other words:

- recent activity != current live status

## Hosting-State Gating Rule

If company `hosting_state` says public runtime is offline or suspended:

- the company may still appear in historical proof sections where appropriate
- but it must not be presented as currently live now without an explicit suspended/offline label

This prevents yesterday’s event history from pretending the company is live today.

## Founder-Private Overlap

The founder dashboard also uses projection-style surfaces:

- task timers
- status changes
- communication modules
- roadmap progression

So the live wall and founder dashboard are different surfaces, but they are driven by related event concepts.

Use shared event-model concepts, but keep the visible UIs distinct.

## Founder Promise Table

| Founder-visible / public statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “This is live.” | current-status projection is fresh and hosting state allows it | show historical proof or offline/suspended label instead | Best-effort live projection with hard gating |
| “This happened recently.” | public-safe event exists in bounded feed window | section may simply have fewer recent events | Guaranteed bounded historical proof if event is public-safe |
| “This wall feels alive.” | grouped event families continue receiving public-safe events | other groups can still keep wall alive if one group is quiet | Best-effort event-driven wall, not fake animation |

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| internal event emitted | public proof event considered | projection pipeline evaluates event | this spec | event is public-safe | event enters grouped historical feed | dropped if not public-safe |
| recent public-safe state | current live projection updated | freshness + hosting checks pass | this spec | source still fresh and hosting state allows current liveness | live section reflects current state | expires when TTL/freshness ends or hosting state changes |
| hosting state active | hosting state offline/suspended | continuity state changes elsewhere | this spec consuming hosting_state | state change observed | current live projection must clear or relabel affected entity | historical proof may remain visible where appropriate |

## Data and Interface Contract

### Public event record

- `event_id`
- `event_family`
- `event_type`
- `subject_type`
- `subject_id`
- `display_title`
- `display_summary`
- `owner_label`
- `occurred_at`
- `duration_seconds` when relevant
- `delta_value` when relevant
- `visibility_scope`

### Section projection model

Each `/live` section should be able to render:

- recent event list
- recent-volume proof line
- counter or aggregate metric
- chart or trend payload when relevant

### Current live-status packet

- `subject_id`
- `is_currently_live`
- `fresh_until`
- `hosting_state_ref`
- `status_label`
- `last_confirmed_event_at`

### Visibility contract

The projection layer distinguishes:

- public-safe events
- founder-private events
- internal-only events that never reach UI

## Edge Cases and Failure Handling

- `/live` must never become one unbounded event log; feeds stay grouped and bounded
- public proof surfaces must not leak founder-private task controls, credits, or dashboard-only controls
- if one event family goes quiet, the page should still feel alive through other families rather than collapsing into emptiness
- orange delta treatment should emphasize change without becoming a permanent alarm state
- a company suspended yesterday may still appear in historical proof today, but must not be shown as currently live without an explicit current-state basis

## Implementation Trap Notes

### Trap 1: treating recent history as current liveness

- **Wrong assumption:** if a company had an event recently, it is still live now.
- **Why it is wrong:** historical proof and current live status are different layers.
- **Correct interpretation:** current liveness must come from fresh projection plus `hosting_state` gating.

### Trap 2: mirroring the private dashboard publicly

- **Wrong assumption:** `/live` can just be a public version of the founder dashboard.
- **Why it is wrong:** public proof and founder controls are different products.
- **Correct interpretation:** share event concepts, not private controls or full private state.

### Trap 3: flattening all event families into one feed

- **Wrong assumption:** more events in one stream equals more proof.
- **Why it is wrong:** it destroys legibility and section-specific trust signals.
- **Correct interpretation:** keep grouped families and bounded windows.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- founder dashboard exposes related timers and status projections but remains a different shell
- scheduler and runtime emit many of the task/timer events the live wall projects
- continuity child owns `hosting_state`, which must gate current live-status projection
- onboarding emits bootstrap/provisioning/company-alive proof events that can appear in historical feeds

### Reconciliation notes

- this rebuilt child now separates current live-status truth from historical proof feeds
- this rebuilt child now explicitly gates current liveness by `hosting_state`
- this rebuilt child now keeps public `/live` distinct from founder-private dashboard controls

## Acceptance Criteria

- `/live` feels like a real event-driven operations wall
- live task cards show owner tags and timers
- orange deltas/highlights appear for important numeric movement
- rolling feeds cover recent companies, documents, email, Twitter, ads, and task completions
- last-24-hour counters are visible
- `/live` is organized into the locked section family rather than one flat feed
- public proof surfaces stay distinct from founder-private dashboard controls
- historical proof and current live-status projection are separate modeled concepts
- offline or suspended companies are not presented as currently live without explicit current-state basis

## Plain-Language New-Reader Tests

- Is `/live` showing current truth or recent history?
- Can a company appear in historical proof after it is suspended?
- Can that same suspended company still be shown as currently live?
- What stops public `/live` from leaking founder-private controls?
- Why is the live wall grouped into sections instead of one feed?

If a new reader cannot answer these directly from this file, the projection model is still ambiguous.

## Traceability

### Source topics

- [knowledge/topics/live-wall-and-event-projections.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/live-wall-and-event-projections.md)
- [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)
- [specs/internal/founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md)
- [specs/internal/billing/subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/subscription-continuity-and-hosting-state.md)

### Source decisions

- `DEC-LIVE-001`
- `DEC-DASH-001`
- `DEC-ROAD-001`
- `DEC-HOST-001`
- `DEC-HOST-002`
- `DEC-HOST-003`

### Claim-to-anchor audit

- `/live` is a grouped event-driven proof wall, not a static page:
  - topics:
    - [knowledge/topics/live-wall-and-event-projections.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/live-wall-and-event-projections.md)
  - decisions:
    - `DEC-LIVE-001`

- public `/live` and founder dashboard share event-model concepts but remain distinct surfaces:
  - topics:
    - [knowledge/topics/live-wall-and-event-projections.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/live-wall-and-event-projections.md)
    - [specs/internal/founder-dashboard-and-taskboard.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/founder-dashboard-and-taskboard.md)
  - decisions:
    - `DEC-DASH-001`
    - `DEC-ROAD-001`

- current live status must respect hosting continuity posture:
  - topics:
    - [specs/internal/billing/subscription-continuity-and-hosting-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/subscription-continuity-and-hosting-state.md)
  - decisions:
    - `DEC-HOST-001`
    - `DEC-HOST-002`
    - `DEC-HOST-003`

## Change Log

- `2026-04-08`: seeded initial live wall and projections spec
- `2026-04-12`: rebuilt the live wall to separate current live-status projection from historical proof feeds and align public proof with hosting-state gating and the rebuilt founder dashboard sibling
