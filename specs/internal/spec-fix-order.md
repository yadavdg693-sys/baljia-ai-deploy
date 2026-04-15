# Spec Fix Order

This document turns `confuse.md` into a practical cleanup sequence.

The goal is not to rewrite everything at once. The goal is to fix the spec family in the right dependency order so later edits do not reintroduce contradictions.

---

## How to use this document

For each phase:
- finish the canonical definitions first
- then update dependent specs
- do not patch downstream copy before upstream authority is fixed
- when a phase is complete, re-read the affected docs and remove stale wording created by earlier drafts

---

# Phase 0 — Working rule before edits

Before touching any spec, apply these rules:

1. Do not use overloaded words without naming the layer.
   - Avoid bare `status`, `lane`, `completed`, `blocked`, `live`, `ready`.
2. Every important noun must have:
   - one canonical meaning
   - one canonical owner
   - one allowed transition model
3. Every founder-facing promise must state:
   - prerequisites
   - fallback state
   - what is guaranteed vs best-effort
4. Every derived projection must point to its source of truth.

---

# Phase 1 — Create canonical vocabulary and authority

## Objective
Remove the biggest source of confusion before editing behavior.

## Must resolve in this phase
- `lane`
- `task`
- `run`
- `session`
- `repair`
- `approval`
- `recurring occurrence`
- company state vocabulary
- `live` / current-status vocabulary

## Primary files to edit first
1. `control-plane-runtime-and-task-agents.md`
2. `control-plane/control-plane-overview.md`
3. `billing-credits-and-subscription-state.md`

## Supporting files to align immediately after
4. `control-plane/lane-and-agent-responsibility-model.md`
5. `control-plane/runtime-entities-and-task-lifecycle.md`
6. `control-plane/scheduler-queue-night-shift-and-recurring.md`
7. `founder-dashboard-and-taskboard.md`
8. `live-wall-and-projections.md`

## Concrete checklist
- [ ] Add a canonical glossary/authority section near the top of `control-plane-runtime-and-task-agents.md`
- [ ] Define `worker_lane`, `run_channel`, and `billing_lane`; remove mixed uses of plain `lane`
- [ ] Define `Task`, `Run`, `Session`, and `Repair` as separate entities with one-sentence contracts
- [ ] State whether repair is a new run on the original task or a hidden child task
- [ ] Define a company-state authority map in `billing-credits-and-subscription-state.md`
- [ ] Replace ambiguous references to “company status” with exact field names
- [ ] Define whether `/live` means current live status, historical proof, or both

## Output of this phase
After Phase 1, a reader should be able to answer “what is this thing?” before asking “how does it behave?”

---

# Phase 2 — Fix lifecycle and transition truth

## Objective
Make the runtime and scheduler state machines coherent.

## Must resolve in this phase
- pre-start blocked vs in-run blocked
- completion vs verification finality
- pause lifecycle
- delete lifecycle
- milestone-change reconciliation
- recurring occurrence materialization
- run/session start boundaries

## Primary files to edit first
1. `control-plane/runtime-entities-and-task-lifecycle.md`
2. `control-plane/scheduler-queue-night-shift-and-recurring.md`
3. `control-plane/verification-remediation-and-actual-cost-accounting.md`

## Supporting files to align immediately after
4. `control-plane-runtime-and-task-agents.md`
5. `roadmap-and-documents.md`
6. `founder-dashboard-and-taskboard.md`
7. `live-wall-and-projections.md`

## Concrete checklist
- [ ] Split or explicitly define `blocked_pre_start` vs `blocked_in_run`
- [ ] Define what must happen on unblock when no run/session exists
- [ ] Define whether verification is final authority over task completion
- [ ] Add transition tables for task lifecycle and repair lifecycle
- [ ] Add explicit company-level pause transitions and effects on all execution surfaces
- [ ] Add explicit company-level delete transitions and drain/cancel rules
- [ ] Define when a recurring due occurrence becomes a real task
- [ ] Add milestone-change task reconciliation as a required step before projections update
- [ ] Define `/live` freshness and hosting-state gating

## Output of this phase
After Phase 2, a reader should be able to trace any task from queueing through pause/retry/repair/completion without guessing.

---

# Phase 3 — Fix approvals, retries, and repair economics

## Objective
Close the biggest safety and trust gaps in permissions and cost behavior.

## Must resolve in this phase
- approval lifecycle ownership
- approval scope and revision binding
- retry safety for non-idempotent actions
- stop-loss for same-scope repair
- relationship between remediation and billing

## Primary files to edit first
1. `control-plane/memory-context-tools-and-connectors.md`
2. `control-plane/verification-remediation-and-actual-cost-accounting.md`
3. `billing/credits-and-task-charging.md`

## Supporting files to align immediately after
4. `control-plane/control-plane-overview.md`
5. `control-plane-runtime-and-task-agents.md`
6. `founder-dashboard-and-taskboard.md`
7. `billing/internal-ledgers-and-unit-economics.md`

## Concrete checklist
- [ ] Define `ApprovalRequest` and `ApprovalGrant/ApprovalRecord` lifecycle clearly
- [ ] Bind approval to task revision plus scope hash
- [ ] Define expiry and invalidation rules for edits, retries, repeats, repairs, connector changes, and spend changes
- [ ] Define lane-specific retry policy
- [ ] Forbid automatic retry for non-idempotent external actions unless explicitly allowed
- [ ] Add stop-loss thresholds for same-scope repair: attempts, time, cost
- [ ] Define when repair stops being founder-free and becomes new work

## Output of this phase
After Phase 3, a reader should be able to answer “what am I allowed to retry, and when do I need new approval or a new charge?”

---

# Phase 4 — Fix founder contract and onboarding truth

## Objective
Make the founder-visible promises match the hidden system contract.

## Must resolve in this phase
- pre-trial side effects and public-surface policy
- trial unlock matrix
- connector-aware starter tasks
- utility-module gating
- document review surface
- bootstrap readiness / CEO summary truth
- night-shift promise during trial

## Primary files to edit first
1. `onboarding-bootstrap.md`
2. `billing-credits-and-subscription-state.md`
3. `founder-dashboard-and-taskboard.md`

## Supporting files to align immediately after
4. `roadmap-and-documents.md`
5. `control-plane/memory-context-tools-and-connectors.md`
6. `control-plane/lane-and-agent-responsibility-model.md`
7. `control-plane-runtime-and-task-agents.md`
8. billing child specs

## Concrete checklist
- [ ] Define a pre-trial bootstrap policy: allowed outputs, forbidden outputs, TTL, budget, retries
- [ ] Add a trial unlock matrix by surface/module/action type
- [ ] Make starter-task generation connector-aware and milestone-aware
- [ ] Add utility-module gating states such as `Start Trial`, `Connect Account`, `Needs Approval`, `Not Ready`
- [ ] Add an explicit founder-visible document suggestion/review surface
- [ ] Change CEO bootstrap summary to proof-backed artifact reporting
- [ ] Make night-shift entitlement during trial explicit everywhere
- [ ] Reconcile `Pause Company` promise with actual backend behavior

## Output of this phase
After Phase 4, a reader should be able to explain the founder experience from onboarding through first trial execution without hidden surprises.

---

# Phase 5 — Fix planning and projection integrity

## Objective
Make roadmap, queue, dashboard, and public projections stay synchronized.

## Must resolve in this phase
- roadmap vs queued-work truth
- current focus vs old queued tasks
- document suggestions vs persistent docs
- live wall vs hosting state
- read model freshness

## Primary files to edit first
1. `roadmap-and-documents.md`
2. `founder-dashboard-and-taskboard.md`
3. `live-wall-and-projections.md`

## Supporting files to align immediately after
4. `control-plane/control-plane-overview.md`
5. `control-plane/scheduler-queue-night-shift-and-recurring.md`
6. `control-plane/runtime-entities-and-task-lifecycle.md`

## Concrete checklist
- [ ] Define which projections are canonical vs derived
- [ ] Define reconciliation on milestone/direction change
- [ ] Define how document suggestions become durable docs
- [ ] Add freshness/TTL rules to live/public projections
- [ ] Prevent historical event streams from implying current runtime truth without explicit status projection

## Output of this phase
After Phase 5, a reader should be able to trust that dashboard/public views are projections of named sources of truth, not stale approximations.

---

# File-by-file recommended edit order

## Tier 1 — Foundation docs
Edit these first because other specs inherit their meanings.

1. `control-plane-runtime-and-task-agents.md`
2. `billing-credits-and-subscription-state.md`
3. `control-plane/control-plane-overview.md`

## Tier 2 — Runtime truth docs
4. `control-plane/runtime-entities-and-task-lifecycle.md`
5. `control-plane/scheduler-queue-night-shift-and-recurring.md`
6. `control-plane/verification-remediation-and-actual-cost-accounting.md`
7. `control-plane/memory-context-tools-and-connectors.md`
8. `control-plane/lane-and-agent-responsibility-model.md`

## Tier 3 — Founder contract docs
9. `onboarding-bootstrap.md`
10. `founder-dashboard-and-taskboard.md`
11. `roadmap-and-documents.md`
12. `live-wall-and-projections.md`

## Tier 4 — Billing children / supporting economic docs
13. `billing/credits-and-task-charging.md`
14. `billing/internal-ledgers-and-unit-economics.md`
15. `billing/trial-and-execution-unlock.md`
16. `billing/subscription-continuity-and-hosting-state.md`
17. `billing/purchase-surfaces-and-expansion.md`

---

# Editing rules by file type

## For umbrella specs
Use them to define nouns, ownership, and invariants.
Do not bury edge-case lifecycle rules in them.

Applies to:
- `control-plane-runtime-and-task-agents.md`
- `billing-credits-and-subscription-state.md`

## For child/system specs
Use them to define transitions, state tables, and failure/re-entry behavior.
Do not redefine canonical nouns here.

Applies to control-plane child specs and billing child specs.

## For founder-facing internal specs
Use them to define what the founder sees, what is promised, and what fallback state appears when prerequisites are missing.
Do not invent hidden runtime behavior here.

Applies to:
- `onboarding-bootstrap.md`
- `founder-dashboard-and-taskboard.md`
- `roadmap-and-documents.md`
- `live-wall-and-projections.md`

---

# Suggested section additions in the specs

To make the cleanup durable, add these section types where missing.

## 1. Canonical noun section
Format:
- Name
- Meaning
- Canonical owner
- Not to be confused with

## 2. State authority section
Format:
- State/field
- Canonical or derived
- Owner
- Used by
- Must not be used by

## 3. Transition table
Format:
- From
- To
- Trigger
- Owner
- Preconditions
- Side effects
- Re-entry rule

## 4. Founder promise table
Format:
- Founder-visible statement
- Hidden prerequisites
- If prerequisites fail
- Guaranteed vs best-effort

## 5. Implementation trap notes
Format:
- Common wrong assumption
- Why it is wrong
- Correct interpretation

---

# Quick win checklist

If you want the smallest set of edits with the biggest payoff, do these first:

- [ ] Rename and split `lane`
- [ ] Lock the task/run/session/repair model
- [ ] Create the company-state authority map
- [ ] Define pause/delete semantics
- [ ] Define recurring occurrence materialization
- [ ] Define approval lifecycle + revision invalidation
- [ ] Add a trial unlock matrix
- [ ] Add a pre-trial bootstrap policy
- [ ] Add a document suggestion review surface
- [ ] Add `/live` freshness and hosting-state gating

---

# Review checklist after every phase

After each phase, ask these questions:

1. Could two readers now draw the same lifecycle?
2. Is every founder-facing promise backed by a hidden-system rule?
3. Does every projection cite a source of truth?
4. Have we removed stale wording from dependent docs?
5. Did we replace overloaded words with layer-specific language?

If the answer is no to any of these, do not move to the next phase yet.

---

# Definition of success

The cleanup is successful when:
- a new reader can answer core lifecycle questions without asking for tribal context
- the founder-facing story and hidden-system model do not contradict each other
- no major runtime concept is overloaded across multiple meanings
- every high-risk transition has explicit ownership and re-entry rules
- roadmap, dashboard, scheduler, and billing all point to the same canonical truths
