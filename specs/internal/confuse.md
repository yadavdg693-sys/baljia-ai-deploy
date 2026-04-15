# Confusion Map for New Readers of the Internal Specs

This document captures what a new person is likely to misunderstand when reading the internal Polsia specs, why that confusion happens, which documents create the confusion, and the guideline to fix it.

It is not an implementation spec. It is a cleanup map for making the real specs legible, internally consistent, and safe to implement.

## How to use this document

For each confusion area:

- treat the **Question a new reader will ask** as the test
- if the spec family cannot answer it in one clear sentence, the area is still ambiguous
- apply the **Fix guideline** before adding more detail to surrounding specs

---

## 1) What does `lane` mean?

### Question a new reader will ask
Is a lane the worker family, the execution source, the billing class, or an entitlement flag?

### Why the reader gets confused
Different specs use `lane` for different concepts:
- specialist worker family (`engineering`, `browser`, `research`, etc.)
- execution source (`manual`, `recurring`, `night_shift`, `remediation`)
- spend / billing distinction
- entitlement phrasing like `night_shift_lane_enabled`

So a new reader cannot tell whether `lane` answers **who does the work**, **how it started**, **how it is charged**, or **whether it is allowed**.

### Where the confusion comes from
- `control-plane-runtime-and-task-agents.md`
- `control-plane/lane-and-agent-responsibility-model.md`
- `control-plane/scheduler-queue-night-shift-and-recurring.md`
- `billing-credits-and-subscription-state.md`

### What goes wrong if this stays unclear
- schema/API fields will be overloaded
- queue logic and analytics will drift
- billing and entitlement logic will be attached to the wrong field
- future readers will keep inventing more `lane` meanings

### Fix guideline
Create a canonical vocabulary section and never reuse `lane` across meanings.

Recommended split:
- `worker_lane` = which specialist executes the work
- `run_channel` or `execution_channel` = how the work entered execution (`manual`, `recurring`, `night_shift`, `remediation`)
- `billing_lane` = which economic lane pays for it (`task_credit`, `ad_spend`, etc.)
- entitlement = its own object or boolean fields, never called a lane

### Acceptance test
A new reader should be able to answer “what is this field deciding?” in one sentence for every use of lane-like terminology.

---

## 2) What is a `Task` vs a `Run` vs a `Session` vs a `Repair`?

### Question a new reader will ask
What is the durable founder-visible object, what is one execution attempt, and what is the scope of a session?

### Why the reader gets confused
The specs sometimes imply:
- a task is the durable founder-visible card
- a run is one attempt
- a session is the runtime context
- repair is either another run on the same task, a hidden child task, or a separate remediation identity

Also, `Session` is sometimes stretched to include founder chat, planning, verification, and onboarding bootstrap.

### Where the confusion comes from
- `control-plane/runtime-entities-and-task-lifecycle.md`
- `control-plane/verification-remediation-and-actual-cost-accounting.md`
- `control-plane-runtime-and-task-agents.md`
- `founder-dashboard-and-taskboard.md`
- `control-plane/control-plane-overview.md`

### What goes wrong if this stays unclear
- repair history becomes impossible to model consistently
- cost accounting cannot be trusted
- founder-visible task history drifts from execution history
- chat/planning/bootstrap may get stored in the wrong runtime entity

### Fix guideline
Define the object model in one canonical table-like section.

Recommended minimum contract:
- `Task` = durable founder-visible unit of work
- `Run` = one concrete execution attempt for a task
- `Session` = runtime container for a specific execution context only
- `Repair` = explicitly defined as either:
  - another `Run` on the original `Task`, or
  - a hidden child `Task`

Do not allow both repair models to coexist.
Do not use `Session` as a catch-all for chat, planning, bootstrap, and worker execution.

### Acceptance test
A new reader should be able to draw the lifecycle of one failed task and its repair on paper without making assumptions.

---

## 3) What does `blocked` mean?

### Question a new reader will ask
Is a blocked task blocked before it started, or paused during execution?

### Why the reader gets confused
The specs use `blocked` for multiple situations:
- waiting for approval
- waiting for credits
- waiting for connectors
- waiting for dependencies
- blocked while already in progress

But some transitions allow `blocked -> in_progress`, which only makes sense for an active paused run, not for a task that never started.

### Where the confusion comes from
- `control-plane/runtime-entities-and-task-lifecycle.md`
- `control-plane-runtime-and-task-agents.md`
- `control-plane/scheduler-queue-night-shift-and-recurring.md`
- `control-plane/control-plane-overview.md`

### What goes wrong if this stays unclear
- tasks can “resume” without ever having started
- queue fairness and credit admission can be bypassed on unblock
- founders will see unclear board states

### Fix guideline
Split blocked into at least two cases:
- `blocked_pre_start`
- `blocked_in_run`

Or keep a single founder-visible label, but define hidden runtime semantics:
- if no active run/session exists, unblocking returns to `todo` and re-enters scheduler admission
- only an active paused run may go directly back to `in_progress`

### Acceptance test
A reader should know exactly what happens when approval arrives for a task that has never executed before.

---

## 4) What does `completed` mean?

### Question a new reader will ask
Does completed mean the worker stopped, verification passed, or the founder-visible task is truly done?

### Why the reader gets confused
Completion appears at multiple layers:
- run/execution layer
- verification layer
- founder-visible task layer
- remediation/fix narrative

Without layer-specific naming, readers will naturally collapse them into one event.

### Where the confusion comes from
- task lifecycle specs
- verification/remediation specs
- founder dashboard specs
- control-plane umbrella specs

### What goes wrong if this stays unclear
- product can show “done” before verification truth is known
- reporting and analytics will double-count terminal events
- engineering teams will wire incorrect webhooks and UI states

### Fix guideline
Reserve separate terms:
- `run_completed` = worker finished executing
- `verified_passed` / `verified_failed` = verification result
- `task_completed` = founder-visible outcome after final authority is known

Never use bare “completed” in a spec section unless the layer is explicitly named.

### Acceptance test
A new reader should be able to explain when the UI shows a task as done after a run completes but before verification finishes.

---

## 5) What is the real company state?

### Question a new reader will ask
Which state field actually controls what the company can do?

### Why the reader gets confused
The spec family uses overlapping state concepts such as:
- onboarding state
- trial state
- paid/subscription state
- lifecycle
- execution unlocked
- hosting state
- pause/delete state
- night shift eligibility

But there is no one authority map that says which field controls which subsystem.

### Where the confusion comes from
- `billing-credits-and-subscription-state.md`
- billing child specs
- `onboarding-bootstrap.md`
- scheduler/control-plane specs
- dashboard spec

### What goes wrong if this stays unclear
- one engineer checks billing state while another checks lifecycle
- UI and backend disagree on whether execution is allowed
- trial founders may lose or gain entitlements incorrectly

### Fix guideline
Publish one canonical state authority map with columns:
- field name
- allowed values
- owner
- what it gates
- what it must not gate
- whether it is canonical or derived

Recommended rule: never say “company status” without naming the exact field.

### Acceptance test
A reader should know exactly which state gates manual execution, night shifts, hosting, upgrade CTA posture, and public visibility.

---

## 6) What does `Pause Company` actually do?

### Question a new reader will ask
When I pause the company, what exactly stops and what keeps running?

### Why the reader gets confused
The founder-facing promise is strong (“pause company”), but the control-plane and scheduler layers do not define matching semantics for:
- active runs
- recurring generation
- night shifts
- remediation
- queue admission
- public surfaces

### Where the confusion comes from
- `founder-dashboard-and-taskboard.md`
- `control-plane/scheduler-queue-night-shift-and-recurring.md`
- `billing-credits-and-subscription-state.md`
- task lifecycle specs

### What goes wrong if this stays unclear
- paused companies may still execute work
- founders lose trust because pause does not mean stop
- implementations will vary by subsystem

### Fix guideline
Define pause as a real system state with explicit effects on:
- active runs: drain, cancel, or hard-stop
- manual queue admission
- recurring generation
- night-shift selection
- remediation
- public availability

Also define unpause semantics.

### Acceptance test
A new reader should know whether a paused company can still receive night-shift work or finish an in-progress run.

---

## 7) What does delete mean operationally?

### Question a new reader will ask
When a company is deleted, what happens to running work and queued work?

### Why the reader gets confused
The dashboard describes delete from a founder perspective, but the runtime/scheduler/billing specs do not define system effects across in-flight work.

### Where the confusion comes from
- `founder-dashboard-and-taskboard.md`
- task lifecycle specs
- scheduler specs
- subscription continuity / hosting specs

### What goes wrong if this stays unclear
- deleted companies may still have active runs or future scheduler work
- route removal may happen before backend work is drained
- clean deletion and soft deletion semantics get mixed up

### Fix guideline
Add explicit company-level transitions:
- `delete_requested`
- `deleting`
- `deleted`

Define required behavior for:
- active runs
- queued tasks
- recurring definitions
- night shifts
- remediation
- route invalidation
- public artifacts

### Acceptance test
A reader should know exactly whether deletion waits for drains or force-stops all work.

---

## 8) What is allowed before trial starts?

### Question a new reader will ask
What real-world side effects can happen before the founder starts the trial or adds payment?

### Why the reader gets confused
Bootstrap specs promise meaningful artifacts before execution unlock, such as:
- public site/shell
- inbox identity
- welcome email
- launch artifact / tweet-like output
- visible starter tasks

But the economics and abuse boundaries are not clearly defined.

### Where the confusion comes from
- `onboarding-bootstrap.md`
- `billing-credits-and-subscription-state.md`
- billing child specs
- control-plane runtime specs

### What goes wrong if this stays unclear
- free-hosting/free-brand-shell loopholes
- unclear infra cost exposure
- trust gaps if pre-trial output appears more complete than it really is

### Fix guideline
Define a strict pre-trial bootstrap policy:
- allowed side effects
- disallowed side effects
- retry caps
- public-surface TTL
- connector restrictions
- send/post limitations
- cost budget

### Acceptance test
A new reader should be able to answer whether a never-activated company can keep a live public shell after abandoning onboarding.

---

## 9) What does trial actually unlock?

### Question a new reader will ask
After starting trial, what becomes runnable immediately, and what still needs prerequisites?

### Why the reader gets confused
The specs say trial unlocks execution, but do not consistently define:
- which task classes become runnable
- whether channel actions become live
- how connector readiness affects starter tasks
- whether ads require extra spend approval
- whether night shifts are included during trial in all layers

### Where the confusion comes from
- `billing-credits-and-subscription-state.md`
- `onboarding-bootstrap.md`
- dashboard spec
- connector/control-plane specs
- scheduler specs

### What goes wrong if this stays unclear
- founders start trial and hit immediate blocked states
- teams implement different unlock rules in different surfaces
- promised trial benefits may silently disappear in runtime defaults

### Fix guideline
Define trial unlock as a matrix, not a slogan.

Recommended matrix columns:
- surface (`taskboard`, `twitter`, `email`, `ads`, `night shift`, etc.)
- unlocked at trial? yes/no
- extra prerequisites
- founder-visible fallback if not ready
- approval needed? yes/no

### Acceptance test
A new reader should know which starter tasks can actually run on the first minute of trial.

---

## 10) How are night shifts different from recurring tasks and autopilot?

### Question a new reader will ask
Which automation is included, which consumes credits, and which one the founder can steer?

### Why the reader gets confused
Night shifts, recurring work, and broader “autopilot” language are all automation-like, but they have different triggers and economics.

### Where the confusion comes from
- dashboard spec
- control-plane runtime umbrella
- scheduler specs
- billing specs

### What goes wrong if this stays unclear
- founders misunderstand what is included vs paid
- implementations reuse the wrong quota rules
- night shifts can accidentally become a substitute for manual paid execution

### Fix guideline
Reserve terms sharply:
- `night shift` = included scheduler-driven capacity
- `recurring task` = founder-configured repeated work that consumes credits per occurrence
- `autopilot` = high-level marketing umbrella only, not a runtime term

### Acceptance test
A new reader should be able to explain whether zero manual credits still allow any execution, and why.

---

## 11) How does approval actually work?

### Question a new reader will ask
Is approval per task, per connector, per action family, per spend amount, or per revision?

### Why the reader gets confused
Approval appears as:
- requirement flags
- gate states
- approval records
- scope refs
- payloads

But there is no single request -> grant -> expiry -> invalidation model.

### Where the confusion comes from
- `control-plane/control-plane-overview.md`
- `control-plane/runtime-entities-and-task-lifecycle.md`
- `control-plane/memory-context-tools-and-connectors.md`
- dashboard spec

### What goes wrong if this stays unclear
- stale approvals may survive edits or repairs
- approval spam or overbroad approval may happen
- auditability becomes weak

### Fix guideline
Create a single approval model with:
- `ApprovalRequest`
- `ApprovalGrant` / `ApprovalRecord`
- scope definition
- expiry rules
- invalidation triggers
- derived task projection field(s)

Also bind approval to task revision + scope hash.

### Acceptance test
A reader should know whether editing a task after approval forces a fresh approval.

---

## 12) When does recurring due work become a real task?

### Question a new reader will ask
If a recurring occurrence is due but credits are zero, is it already a task or just scheduler intent?

### Why the reader gets confused
Scheduler defines due recurring records with their own states, while runtime and dashboard assume founder-visible work maps to durable tasks.

### Where the confusion comes from
- `control-plane/scheduler-queue-night-shift-and-recurring.md`
- `control-plane/runtime-entities-and-task-lifecycle.md`
- `founder-dashboard-and-taskboard.md`

### What goes wrong if this stays unclear
- recurring work can appear on the board twice
- or disappear until credits return
- or exist in scheduler truth but not founder-visible truth

### Fix guideline
Choose one canonical rule:
- every due occurrence becomes a `Task` immediately with a stable dedupe key
- or it remains invisible scheduler intent until materialization

Do not mix both.

### Acceptance test
A new reader should know whether a zero-credit recurring occurrence appears on the founder board.

---

## 13) What happens to queued work when the milestone changes?

### Question a new reader will ask
If the roadmap changes or the active milestone advances, what happens to existing queued tasks?

### Why the reader gets confused
Roadmap/current-focus truth changes, but no mandatory reconciliation step is defined for queued tasks created under the old milestone.

### Where the confusion comes from
- `roadmap-and-documents.md`
- dashboard spec
- scheduler/control-plane specs

### What goes wrong if this stays unclear
- stale tasks remain runnable under a no-longer-canonical strategy
- dashboard shows one direction while queue still executes another

### Fix guideline
Add a required reconciliation step on milestone change.
Each existing queued task must be marked as one of:
- retained
- reprioritized
- blocked
- superseded
- rejected

### Acceptance test
A reader should know whether old milestone tasks can remain night-shift eligible after a strategic shift.

---

## 14) Does `/live` mean currently active or historically active?

### Question a new reader will ask
Is the live wall showing current runtime truth or just recent event history?

### Why the reader gets confused
The live wall is event-driven, but there is no strong freshness boundary or hosting-state rule in the live projection itself.

### Where the confusion comes from
- `live-wall-and-projections.md`
- billing continuity / hosting specs
- dashboard/public-surface assumptions

### What goes wrong if this stays unclear
- offline or suspended companies can still look live
- public proof gets mistaken for current activity

### Fix guideline
Separate:
- historical proof events
- current live-status projection

Add TTL/freshness fields and hard hosting-state gating.

### Acceptance test
A reader should know whether a company suspended yesterday can still appear live today and under what label.

---

## 15) How do founders actually control document evolution?

### Question a new reader will ask
Where do document suggestions appear, and where does accept/edit/skip happen?

### Why the reader gets confused
Roadmap/docs specs promise founder-controlled living documents, but the dashboard mostly defines read-only doc viewing and not a concrete review surface.

### Where the confusion comes from
- `roadmap-and-documents.md`
- `founder-dashboard-and-taskboard.md`

### What goes wrong if this stays unclear
- founder-control promise becomes hollow
- teams may silently mutate docs despite the specs forbidding that
- document governance becomes UI-less

### Fix guideline
Define one explicit review surface for document suggestions:
- in chat
- in a docs queue
- or in task/report detail

Then define where `accept`, `edit`, and `skip` are recorded.

### Acceptance test
A new reader should know exactly where the founder sees and resolves a suggested roadmap/document update.

---

## 16) Are starter tasks fixed, milestone-derived, or connector-aware?

### Question a new reader will ask
What logic actually decides the first tasks the founder sees?

### Why the reader gets confused
Different parts of the spec imply starter tasks are:
- a fixed trio
- milestone-derived
- roadmap-derived
- capability-bounded
- connector-sensitive

### Where the confusion comes from
- `onboarding-bootstrap.md`
- `roadmap-and-documents.md`
- dashboard spec
- connector/control-plane specs

### What goes wrong if this stays unclear
- onboarding can promise tasks that are not honest or runnable
- early trial experience can immediately block

### Fix guideline
Define a starter-task generation algorithm with priority order, for example:
1. must fit active milestone
2. must be executable with current connectors
3. must respect trial/pre-trial rules
4. may use a default trio pattern only when the above conditions pass

### Acceptance test
A reader should know whether a founder without email connectors can still receive an outreach starter task.

---

## 17) What are the limits on retries and same-scope repairs?

### Question a new reader will ask
How many free retries/repairs are allowed before a new charge or re-scope is required?

### Why the reader gets confused
The specs make same-scope repair founder-free and track remediation costs internally, but they do not define hard stop-loss boundaries.

### Where the confusion comes from
- billing charging specs
- verification/remediation specs
- control-plane runtime umbrella

### What goes wrong if this stays unclear
- infinite hidden subsidy
- duplicate external actions
- margin sink and exploitability

### Fix guideline
Add hard remediation/retry limits:
- max attempts
- max elapsed time
- max internal cost
- lane-specific retry/idempotency rules
- mandatory re-scope threshold

### Acceptance test
A reader should know exactly when a failed task stops being a free same-scope repair and becomes new work.

---

## 18) Can the CEO bootstrap summary be trusted as current truth?

### Question a new reader will ask
If the first CEO message says things are set up, are they actually confirmed or just expected?

### Why the reader gets confused
Bootstrap allows progressive/partial completion, but the founder handoff narrative can sound like a finished checklist.

### Where the confusion comes from
- `onboarding-bootstrap.md`
- dashboard first-load/readiness sections

### What goes wrong if this stays unclear
- the founder receives overclaimed readiness
- trust is broken on the very first product moment

### Fix guideline
Make bootstrap summary proof-backed:
- only confirmed artifacts can be described as done
- pending items must be labeled `pending`, `retrying`, or `still setting up`
- define partial readiness states for modules/docs/links

### Acceptance test
A reader should know whether “welcome email sent” can appear in the CEO summary if sending is still retrying.

---

# Cross-cutting guideline for fixing the specs

These problems should not be fixed one sentence at a time. Fix them in this order.

## Phase 1 — Define canonical nouns
Create one short glossary/authority doc and make every internal spec inherit from it.

Must define at minimum:
- lane
- task
- run
- session
- repair
- approval
- recurring occurrence
- milestone
- company state fields
- live status

## Phase 2 — Define authority boundaries
For each important concept, state:
- canonical owner
- derived projections
- allowed transitions
- who mutates it
- who only reads it

Do this especially for:
- company state
- task lifecycle
- approval lifecycle
- recurring occurrences
- live/public projections

## Phase 3 — Define founder contract vs hidden system contract explicitly
Every spec already says it should have both.
Apply that rigor consistently.

For every founder-facing promise, add:
- hidden prerequisites
- fallback state if prerequisites fail
- what the founder sees before readiness
- what is guaranteed vs best-effort

## Phase 4 — Remove overloaded words
Do a cleanup pass that bans ambiguous shorthand such as:
- `lane`
- `status`
- `completed`
- `blocked`
- `live`
- `ready`

unless the spec names the exact layer or field.

## Phase 5 — Add transition tables
For the most confusing systems, add explicit tables:
- from state
- to state
- trigger
- owner
- side effects
- re-entry rule

Must exist for:
- task lifecycle
- approval lifecycle
- pause/delete lifecycle
- trial/entitlement lifecycle
- recurring occurrence materialization

## Phase 6 — Add “new reader tests” to every affected spec
At the end of each major section, add 2-3 plain-language checks like:
- “Can a paused company still run night shifts?”
- “When does a recurring due occurrence become a task?”
- “Does editing after approval invalidate approval?”

If the section does not answer the question directly, it is still unclear.

---

# Highest-priority fixes

If only a few things are fixed first, do these:

1. Canonical meaning of `lane`
2. Canonical model for task/run/session/repair
3. Company state authority map
4. Approval lifecycle and revision binding
5. Pause/delete semantics
6. Trial unlock matrix
7. Recurring occurrence materialization rule
8. Night shift vs recurring vs manual execution distinction
9. Milestone-change reconciliation for queued work
10. Proof-backed bootstrap readiness / CEO summary

---

# Definition of done for spec cleanup

These specs are clear enough for a new person only when:

- two different readers derive the same lifecycle model
- founder-facing promises map cleanly to backend states
- every derived projection has a named canonical source of truth
- overloaded terms are eliminated or tightly scoped
- re-entry rules are explicit for pause, unblock, retry, repair, delete, and milestone change

Until then, the main risk is not missing detail. The main risk is that readers will confidently build different systems from the same spec family.
