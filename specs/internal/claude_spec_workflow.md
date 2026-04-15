# Claude Spec Workflow

The exact process from knowledge universe to finalized internal spec, then to build spec, then to implementation tasks.

## 0. Lock the meaning of "final spec"

There are two different outputs. They must not be mixed:

**Final internal spec**

- the full product-truth packet
- what is true
- what the founder sees
- what the hidden system does
- ownership, state, transitions, contracts, edge cases

**Build spec**

- derived from the finalized internal spec
- implementation-facing
- how engineering should build the already-locked truth

The sequence is always:

> knowledge universe -> finalized internal spec -> build spec -> implementation tasks

Never collapse these into one step.

## 1. Define the subsystem boundary first

Before reading sources, define exactly:

- which subsystem/spec is being built
- what it owns
- what it does not own
- which sibling specs share contracts with it

Examples:

- onboarding owns bootstrap and initial handoff
- billing owns trial/credits/hosting rules
- dashboard owns projection of those rules into founder surfaces
- control plane owns runtime truth and orchestration

**Purpose:** stop cross-spec mixing, stop one file from silently owning everything, create a clear target for the pass.

**Output:**

- one named target spec
- one boundary statement
- initial sibling list

## 2. Collect the full subsystem knowledge universe

The full knowledge universe includes all of these layers:

### A. Root raw architecture source

`Polsia_Exact_Architecture_Details.md`

This is the deep architecture source from which the structured knowledge was derived. It is not optional background. It is part of the universe from the start.

### B. Structured reading layers

- `Polsia_Topic_Book.md`
- owning topic docs in `knowledge/topics`
- related facts in `knowledge/facts`

### C. Conflict-resolving rule layer

- `decision_registry.yaml`

### D. Evidence layers

- UI evidence if the subsystem has founder-visible behavior
- preserved chats and current-thread clarifications as the final nuance layer only

### E. Audit/feedback layers

These are useful as feedback but not source-of-truth specs:

- `confuse.md`
- `spec-fix-order.md`

**Purpose:** gather all relevant truth before excluding anything, prevent missing real details, prevent over-reliance on chat memory or one narrow file.

**Important clarification:** the architecture-details doc is part of the universe from the beginning, but the structured topic/fact layers are usually read first for speed. The architecture doc must always be checked directly when the subsystem is thin, ambiguous, or during the residual sweep.

**Output:** complete source set for the subsystem.

## 3. Read for full coverage

Read whatever gives the strongest coverage for this subsystem. The goal is full coverage, not a fixed reading order.

**If topics/facts are rich for this subsystem:**

1. Topic Book
2. owning topic doc
3. related facts
4. decision registry
5. UI evidence if needed
6. deep architecture source
7. chat residuals

**If topics/facts are thin, missing, or ambiguous:**

Go to the architecture source directly. Do not wait for residual sweeps. The architecture source is a primary input when structured layers have not been built for the subsystem yet.

**Purpose:** keep broad coverage, keep reading practical, still preserve the root architecture source.

**Output:**

- working notes for the subsystem
- list of relevant source anchors

## 4. Classify every important statement before drafting

Before writing the spec, classify each important rule as one of:

| Classification | Meaning |
|---|---|
| Exact observed Polsia truth | Current/observed behavior from evidence or recovered source truth |
| Founder-locked rebuild addition | A deliberate replacement or addition that is now active truth |
| Implementation freedom | Engineering can choose, as long as it does not break the locked contract |

**Purpose:** stop accidental mixing of observed truth and rebuild additions, make the spec honest, stop implementation choices from pretending to be product truth.

**Output:** truth classification per major rule.

## 5. Resolve conflicts through the decision registry

When sources disagree, the decision registry wins.

**Authority order:**

1. `decision_registry.yaml`
2. related fact files
3. owning topic docs
4. Topic Book
5. architecture-details source
6. preserved chats/current thread as residual nuance only

**Important distinction:** the decision registry is the highest authority for conflicts. It is not the only allowed source of content. So:

- if a detail is relevant
- supported by topics/facts/master/chat
- and not contradicted by the decision registry
- then it should still be included in the internal spec

**Purpose:** remove stale active rules, keep non-conflicting useful detail, stop "not in decision registry = leave it out" mistakes.

**Output:**

- clean active rule baseline
- stale/conflicting items flagged

## 6. Run semantic normalization explicitly

This step must happen before serious drafting.

### 6.1 Identify high-risk words

List all risky nouns and state words in the subsystem, such as:

- lane, task, run, session, repair, approval, status, blocked, completed, live, ready

### 6.2 Check for overloaded meaning

For each term, ask:

- does it mean one thing only?
- or is it being used across multiple meanings in sibling specs?

### 6.3 Split meanings where needed

Examples:

- `worker_lane` / `run_channel` / `billing_lane`
- `run_completed` / `verified_passed` / `task_completed`
- `blocked_pre_start` / `blocked_in_run`

### 6.4 Assign one canonical owner

For each major term/state:

- which spec owns the meaning?
- which specs may reference it?
- which specs must not redefine it?

### 6.5 Define authority/transition model

If the term is stateful, define:

- allowed values
- owner
- what it gates
- what it must not gate
- how it changes

**Purpose:** prevent words from carrying unstable meaning, stop architecture drift before drafting, make sibling reconciliation possible.

**Output:**

- canonical term map
- ownership map
- state/transition definitions for risky terms

## 7. Flag undecided values

If a required value is not yet decided (pricing threshold, timing, policy), do not guess.

- add it to `decide-later.md` with the owning spec reference
- mark the spec field as TBD with a cross-reference
- do not let undecided values silently become "whatever the implementer picks"

**Purpose:** prevent specs from either guessing at undecided values or leaving silent blanks.

**Output:** updated `decide-later.md` if needed.

## 8. Patch the knowledge layer first if reusable truth is missing

If you discover a reusable missing rule during reading or semantic normalization, do not let the spec become the only home for it.

Patch the knowledge layer first when the missing item is:

- a reusable subsystem fact
- a conflict-resolving ruling
- a cross-spec ownership rule
- a rebuild replacement of older behavior
- a founder-facing simplification that differs from hidden truth

**Pattern:**

1. patch topic/fact/decision as appropriate
2. re-run decision-resolution
3. then patch the internal spec draft

**Purpose:** keep the knowledge layer canonical, prevent specs from becoming shadow knowledge stores.

**Output:**

- updated knowledge layer if needed
- updated ruling baseline

## 9. Draft the internal spec first

Now write the internal spec in `specs/internal`.

The internal spec must include, when relevant:

- purpose
- founder-visible contract
- hidden/system contract
- in scope
- out of scope
- canonical noun imports
- state authority section
- surfaces and flows
- data/interface contract
- edge cases
- failure handling
- founder promise table
- transition table
- acceptance criteria
- implementation freedom
- implementation trap notes
- plain-language new-reader tests
- traceability
- change log

**Purpose:** create the full-fidelity truth packet, lock product/system truth before implementation planning.

**Output:** first internal spec draft.

## 10. Make structural truth explicit

Do not stop with correct facts. The internal spec must show the actual system shape.

Make explicit:

- hierarchy
- modes
- state machine shape
- branch structure
- terminal vs non-terminal paths
- ownership boundaries
- handoff points
- founder-visible vs hidden layers
- what each stage consumes
- what each stage produces
- what later stages depend on

**Purpose:** facts without graph/structure still mislead implementers.

**Output:** structurally explicit draft.

## 11. Unpack all named stages semantically

If a spec contains stage labels or system labels, explain them.

For each meaningful stage/state:

- purpose
- inputs/signals consumed
- outputs/state changes produced
- why the next stage depends on it
- whether it is founder-visible or hidden

**Bad pattern:** stage name exists, nobody knows what it means.

**Required pattern:** stage name + semantic meaning + causal role.

**Purpose:** stop opaque labels from surviving into implementation.

**Output:** semantically unpacked stage flow.

## 12. Run the story pass

Read the draft as an operating story.

For every important section ask:

- after this, what happens next?
- because of what output?
- for what purpose?
- what changes in system state?
- what does the founder see before and after?

**Purpose:** the spec must read as a real system, not disconnected bullets.

**Output:** causally readable internal draft.

## 13. Run the internal quality gate

Before treating the draft as real, run these checks:

### 13.1 No implied meaning

If it matters, it must be written explicitly.

### 13.2 Stage semantics required

Every important stage must have: purpose, inputs, outputs, dependency meaning, founder-visible effect if any.

### 13.3 Story pass required

The subsystem must read as a causal story.

### 13.4 State and artifact pass

For each major step:

- what state changes?
- what gets stored?
- what artifact is created/updated?
- what remains delayed or progressive?
- what partial failure is allowed?

### 13.5 Path-by-path matrix for branching systems

If the subsystem branches, explain each path separately.

### 13.6 Shared-contract audit

Identify shared truths and owning specs.

### 13.7 Implementation sufficiency test

An implementer should be able to answer:

- what enters this subsystem?
- what gets stored?
- what gets generated?
- what APIs/events/state changes happen?
- what happens on partial failure?
- what does the founder see before/after each major step?

**Purpose:** ensure the draft is not still fuzzy.

**Output:** quality-gated internal draft.

## 14. Run the master-source residual sweep

After the draft exists, check `Polsia_Exact_Architecture_Details.md`.

**Purpose:** recover missed nuance, catch details not yet fully promoted into topics/facts/decisions, improve coverage.

**Important:** this is always part of the process. If the subsystem was already ambiguous and the architecture source was used as a primary input in step 3, still do the final residual check again — the draft may have missed details that only become visible after the spec structure exists.

**Output:**

- recovered residual details
- list of new or clarified points

## 15. Run the chat residual sweep

After the master sweep, check:

- preserved chats
- current thread clarifications

**Purpose:** recover founder clarifications, recover wording nuance, catch missing splits between founder-visible truth, CEO explanation, and internal truth.

**Important:** chat is residual nuance, not top authority. If chat introduces a reusable rule, promote it into the knowledge layer first.

**Output:**

- recovered chat-derived nuances
- promoted knowledge updates if needed

## 16. Re-run decision and stale filtering

After residual sweeps:

- run newly recovered detail through the decision registry again
- remove stale items
- downgrade historical items
- keep only relevant non-conflicting detail

**Stale means:** a detail is stale if:

- contradicted by a higher-authority decision
- superseded by stronger newer evidence
- describes older behavior intentionally replaced
- depends on architecture no longer active
- survives only as historical context

**Not stale means:** a detail is still allowed if:

- relevant
- supported by approved layers
- not contradicted by higher authority
- useful for product truth, system truth, or edge-case coverage

**Purpose:** prevent late-found details from bypassing the conflict resolver.

**Output:** final active rule set for the subsystem.

## 17. Run claim-to-anchor

For every nontrivial claim, ask:

- is it descriptive, normative, or both?
- which topic supports it?
- which fact supports it?
- if it is normative, gating-related, ownership-defining, asymmetrical, or conflict-resolving, which decision governs it?

**Especially do this for:**

- ownership boundaries
- CEO vs worker asymmetry
- gating rules
- override rules
- hidden vs founder-visible truth splits
- rebuild replacements
- any sentence with: `must`, `only`, `owns`, `should not`, `instead of`, `rather than`, `wins`

If a claim cannot be fully anchored:

- weaken it
- split descriptive vs normative parts
- or promote missing fact/decision first

**Purpose:** remove "probably true" architecture.

**Output:** anchored internal draft.

## 18. Run sibling reconciliation and shared-contract check

Compare the draft against sibling specs that touch the same rule.

Examples:

- onboarding, billing, dashboard share trial semantics
- roadmap, onboarding, dashboard share starter-task and milestone truth
- billing, dashboard, live wall share hosting/public visibility truth
- control-plane, billing, dashboard share execution state and gating truth

Do this:

- identify the owning spec for each shared rule
- normalize wording
- remove local redefinitions
- resolve conflicts through the decision registry
- patch sibling drift where needed

**Purpose:** stop one rule from being described differently in different files.

**Output:**

- reconciled internal draft
- sibling consistency notes

## 19. Finalize the internal spec

Only now does the internal spec become final.

A finalized internal spec must have:

- correct facts
- correct semantics
- correct structure
- correct causal story
- explicit founder-visible vs hidden-system split
- explicit ownership and transitions
- explicit acceptance criteria
- traceability
- no stale active rules
- anchored nontrivial claims
- reconciled sibling contracts

**Purpose:** this is the subsystem truth packet.

**Output:** finalized internal spec.

## 20. Freeze "internal spec first" discipline

After the internal spec is finalized:

- do not co-develop internal and build specs together
- do not let the build spec invent structural truth
- if a new ambiguity appears during build-spec writing, stop and come back to the internal spec first

**Purpose:** protect the truth hierarchy.

**Output:** stable handoff point into build derivation.

## 21. Derive the build spec

Now write the build spec in `specs/build`.

The build spec should include:

- goal
- user-facing behavior
- system behavior
- components and boundaries
- contracts
- acceptance criteria
- dependencies
- explicit non-goals
- traceability to internal spec and locked decisions

**Build spec invention test:** after drafting the build spec, check every statement. If any statement is not traceable to the finalized internal spec, it is inventing truth. Stop and go back to the internal spec first. The build spec translates truth into engineering guidance — it does not create truth.

**Purpose:** turn internal truth into engineering guidance.

**Output:** build spec draft.

## 22. Run the cross-spec build-spec check

Compare the build spec against sibling build specs for shared contracts.

**Purpose:** keep engineering-facing packets aligned, stop implementation-facing drift.

**Output:** stable build spec family.

## 23. Split implementation tasks only after the build spec is stable

Only now do tasks get created.

**Sequence:** internal spec -> build spec -> implementation tasks

**Purpose:** avoid jumping from notes or half-formed truth into execution.

**Output:** implementation task breakdown.

## 24. Retirement

When a subsystem is merged, killed, or fully superseded:

- move its specs to `specs/archived/` with a `Retired` status header and one-line reason
- remove from sibling reconciliation lists
- do not silently delete — archived specs are useful for "why did we stop doing X" questions

**Purpose:** close the lifecycle cleanly.

**Output:** archived spec with retirement reason.

## Minor Amendment Path

The full 24-step process is for new specs and significant rewrites. For small changes (fixing a value, adding a field, correcting a state):

1. check decision registry for conflicts
2. update the internal spec
3. update sibling specs if a shared contract changed
4. update the build spec
5. done

**Use the full process for:** new specs, significant rewrites, or any change that touches ownership, state machines, or sibling contracts.

## Compact Chain

> subsystem boundary -> knowledge universe -> coverage reading -> truth classification -> decision resolution -> semantic normalization -> flag undecided values -> patch knowledge first if needed -> internal spec draft -> structural pass -> semantic stage unpacking -> story pass -> quality gate -> architecture residual sweep -> chat residual sweep -> stale filter -> claim-to-anchor -> sibling reconciliation -> finalize internal spec -> derive build spec -> build-spec reconciliation -> implementation tasks -> retirement when needed
