# Spec: Verification, Remediation, and Actual-Cost Accounting

- `Spec ID`: `SPEC-CTRL-106`
- `Status`: rebuilt
- `Subsystem`: verification, remediation, and actual-cost accounting
- `Classification`: internal system
- `Sensitivity`: internal only
- `Parent spec`: [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
- `Parent build spec`: [specs/build/control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/build/control-plane/verification-remediation-and-actual-cost-accounting.md)

## Purpose

Define how the system decides whether work truly succeeded, how same-scope misses are repaired, and how real post-run economics are recorded.

This child spec owns:

- verification as the final authority on founder-visible completion when verification is required
- remediation classification
- same-scope repair boundaries
- remediation stop-loss rules
- post-run actual-cost record shape
- margin feedback loop inputs

## Founder-Visible Contract

The founder should experience this subsystem like this:

- engineering and other substantive work include real verification rather than blind trust in worker claims
- a task is only truly done when the system has enough evidence to accept it
- same-scope platform-caused misses should not silently burn a fresh founder manual credit
- `Fixed` reflects recovery on the original task after a miss
- founders still hear `1 task = 1 credit`, while internal cost truth is recorded after the run
- CEO may use bounded-task language when scoping, but the hidden formula is not raw-hours based

## Hidden-System Contract

The hidden system must preserve four distinct layers:

1. `Run` outcome
   - what the worker attempt says happened
2. verification result
   - whether evidence actually supports success, block, failure, or repair-needed posture
3. remediation classification
   - whether the miss is same-scope repairable, externally blocked, or truly new work
4. actual-cost accounting
   - what the platform really spent to attempt or deliver the task

The worker is not the final authority on founder-visible task completion.

## In Scope

- verification authority model
- verification evidence model
- remediation classification
- same-scope repair handling
- remediation stop-loss boundaries
- actual-cost capture
- margin feedback loop

## Out of Scope

- pricing-page copy
- subscription-state matrix
- scheduler ownership of queue order
- founder UI layout

## Canonical Noun Imports

### `Run`

- **Imported meaning:** one concrete execution attempt for a task
- **Owned elsewhere:** [runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md)
- **Used here for:** evidence source and attempt-cost lineage

### `Task`

- **Imported meaning:** durable founder-visible work unit
- **Owned elsewhere:** runtime child
- **Used here for:** final accepted outcome, repair lineage, and cost record linkage

### `Repair`

- **Imported meaning:** same-scope remediation through additional run(s) on the original task
- **Shared ownership with runtime child**
- **Must not be reinterpreted as:** a second purchased task

### `billing_lane`

- **Imported meaning:** economic lane funding or accounting for work
- **Owned elsewhere:** billing umbrella
- **Used here for:** no-rebill and accounting interpretation only

## State Authority Section

| State / seam | Canonical or derived | Owner | Used by this spec | Must not be done in this spec |
|---|---|---|---|---|
| verification result | Canonical | this spec | decide whether evidence supports completion, block, failure, or repair-needed posture | replaced by worker self-report |
| repair classification | Canonical | this spec | decide whether same-scope repair remains founder-free | replaced by scheduler guesswork |
| stop-loss threshold state | Canonical | this spec | stop unbounded remediation | treated as raw founder-visible credit rule |
| post-run actual-cost record | Canonical | this spec | capture hidden economic truth | exposed directly as founder pricing copy |
| `Task.status` final state | Canonical elsewhere | runtime child | updated using results from this spec | re-owned here as runtime lifecycle authority |
| founder `Fixed` / `Couldn't Complete` copy | Derived elsewhere | dashboard child | projected from canonical verification and repair results | used as hidden canonical state names |

## Structural Model

### Verification authority chain

Completion must pass through this authority chain:

1. `worker claim`
   - the lane reports what it believes happened
2. `evidence collection`
   - artifacts
   - screenshots
   - logs
   - receipts
   - service checks
   - structured outputs
3. `verification result`
   - `verification_passed`
   - `verification_blocked`
   - `verification_failed`
   - `repair_required`
4. `task outcome update`
   - founder-visible done state changes only after verification truth is written when verification is required

### Remediation classification

Every miss must be classified as one of:

- `same_scope_platform_miss`
  - repair inside existing founder scope
  - no fresh manual credit
- `external_dependency_miss`
  - block and wait for founder approval, credentials, or external resolution
- `out_of_scope_follow_up`
  - requires a new founder-approved task because the ask expanded beyond original scope

### Remediation stop-loss model

Same-scope repair must not run forever.

Stop-loss must consider at least:

- max repair attempts: `100` (locked)
- max elapsed repair time: TBD — see `decide-later.md`
- max internal remediation cost: TBD — see `decide-later.md`
- repeated non-idempotent side-effect risk: TBD — see `decide-later.md`

When stop-loss is exceeded:

- remediation stops being silent founder-free repair
- task moves to founder-decision or re-scope posture
- any further work must be blocked for founder decision or created as new work

### Failure classification taxonomy

Every failed run must be classified using one of these canonical failure classes:

- `infra_error`: platform infrastructure failure (timeout, OOM, provider outage)
- `capability_miss`: worker attempted work outside its real capability envelope
- `external_block`: external dependency unavailable (API down, rate limited, auth expired)
- `verification_reject`: work completed but verification determined the output was incorrect or insufficient
- `timeout`: execution exceeded the allowed time window
- `scope_overflow`: task was too large for one bounded execution attempt
- `policy_violation`: worker attempted a forbidden or unapproved action
- `connector_failure`: required connector/integration failed during execution

### Failure-to-remediation mapping

| Failure class | Typically repairable? | Repair approach |
|---|---|---|
| `infra_error` | Yes | automatic retry or night-shift repair |
| `capability_miss` | No | reroute to different lane or reframe |
| `external_block` | After resolution | block until dependency resolves, then retry |
| `verification_reject` | Yes | same-scope repair with verification feedback |
| `timeout` | Maybe | retry with tighter scope or decompose |
| `scope_overflow` | No | decompose into multiple tasks |
| `policy_violation` | No | investigate, do not auto-retry |
| `connector_failure` | After resolution | block until connector restored |

### Actual-cost feedback loop

After every executed task or terminated run:

1. collect variable cost components
2. compute total variable cost
3. compare against effective credit revenue and task-family expectations
4. feed result back into:
   - task splitting policy
   - execution mode selection
   - verification policy
   - remediation policy
   - likely credit forecasting

This is hidden internal truth and must not leak raw provider math into founder credit language.

## Layered Completion Rules

Use these terms distinctly:

- `run_completed`
  - worker stopped and the run ended
- `verification_passed` / `verification_failed`
  - evidence review result
- `task_completed`
  - founder-visible task is truly done after verification authority accepts it when required

Bare `completed` is forbidden unless the layer is named.

## Verification Flow

1. a run ends with artifacts and evidence
2. verification policy determines whether verification is required
3. verification checks expected outcomes using:
   - lane success contract
   - artifact receipts
   - screenshots
   - staging or service checks
   - logs
   - structured outputs
4. verification writes one result:
   - `verification_passed`
   - `verification_blocked`
   - `verification_failed`
   - `repair_required`

### Verification-to-task mapping

- `verification_passed`
  - allow original task to become `completed`
- `verification_blocked`
  - task remains or becomes blocked according to runtime child semantics
- `verification_failed`
  - task remains or becomes failed
- `repair_required`
  - original task stays unresolved/failed until repair evidence is accepted
  - when same-scope repair succeeds, original task becomes `repaired`

## Remediation Flow

1. verification or policy identifies a miss
2. classify the miss
3. if same-scope platform miss:
   - create remediation path on the original task
   - prefer remediation capacity or night-shift repair path
   - do not consume a fresh founder manual credit
4. if external dependency miss:
   - block and explain dependency
5. if out-of-scope expansion:
   - stop silent remediation
   - require founder decision or new task
6. apply stop-loss continuously while remediation is active

## Actual-Cost Accounting

Track post-run variable cost including:

- model tokens
- search usage
- browser/runtime minutes
- verification cost
- retry cost
- remediation cost
- media-generation cost if used
- human-review cost if triggered

Use this for:

- task-family margin tracking
- pricing calibration
- likely credit forecasting
- governance and scoping feedback

Do not treat the founder-safe `~4 hour` language as the hidden cost formula.

## Transition Table

| From | To | Trigger | Owner | Preconditions | Side effects | Re-entry rule |
|---|---|---|---|---|---|---|
| run ended | verification review | evidence exists and policy requires review | this spec | run has produced evidence | verification record created | if evidence is insufficient, task remains unresolved |
| verification review | `verification_passed` | evidence supports success | this spec | success contract satisfied | task may become completed | terminal unless later superseded by new work |
| verification review | `verification_blocked` | evidence shows unmet dependency/external prerequisite | this spec | block reason is real | task remains blocked by runtime rules | may later resume after dependency resolves |
| verification review | `verification_failed` | evidence shows miss with no accepted repair yet | this spec | failure established | task remains/turns failed | may later move to repair path |
| verification review | `repair_required` | same-scope miss is repairable | this spec | repair still inside original scope | remediation path created on original task | repair attempts may continue until success or stop-loss |
| active remediation | `repaired` | repair evidence accepted | this spec + runtime child | same-scope repair succeeded | original task outcome updated to `repaired` | terminal for original task unless later superseded |
| active remediation | founder-decision or re-scope posture | stop-loss exceeded | this spec | attempts/time/cost threshold exceeded | silent repair stops; further work requires founder decision or new task | new work only after explicit decision or re-scope |
| any terminated run | actual-cost recorded | run completes or terminates | this spec | cost components available enough to record | task-cost record written | may append later adjustments if delayed component arrives |

## Founder Promise Table

| Founder-visible statement | Hidden prerequisites | If prerequisites fail | Guaranteed vs best-effort |
|---|---|---|---|
| “This is done.” | verification authority accepted the result when required | founder sees unresolved, blocked, or failed posture instead | Guaranteed only after verification-backed finality |
| “This is fixed.” | same-scope repair on the original task succeeded and evidence was accepted | founder sees failed or blocked posture instead | Best-effort trust recovery |
| “We won’t charge you again for our miss.” | miss is same-scope and inside repair stop-loss limits | work blocks for founder decision or becomes new task if it exceeds stop-loss or scope | Guaranteed same-scope no-rebill rule, not unlimited free work |
| “Internal cost is tracked.” | post-run evidence and cost components exist | later delayed components may fill in after first record | Guaranteed hidden accounting intent |

## Data and Interface Contract

### VerificationRecord

- `verification_id`
- `task_id`
- `run_id`
- `working_pattern_id`
- `lane_success_contract_ref`
- `verification_policy`
- `evidence_refs`
- `verification_result`
- `resulting_task_outcome_ref`
- `summary`
- `verified_at`

### RemediationRecord

- `remediation_id`
- `original_task_id`
- `same_scope`
- `repair_channel_ref`
- `credit_policy_ref`
- `trigger_reason`
- `repair_attempt_count`
- `repair_elapsed_time`
- `repair_internal_cost`
- `stop_loss_state`
- `created_at`

### TaskCostRecord

- `task_id`
- `run_id`
- `task_family`
- `execution_mode`
- `worker_lane_ref`
- `model_cost`
- `search_cost`
- `browser_runtime_cost`
- `verification_cost`
- `retry_cost`
- `remediation_cost`
- `media_generation_cost`
- `human_review_cost`
- `total_variable_cost`
- `effective_credit_revenue`
- `margin_snapshot`
- `costed_at`

## Edge Cases and Failure Handling

- verification must not be skipped for engineering deploy claims that require real evidence
- a run can stop cleanly while still failing verification
- same-scope repair must not loop forever on impossible external blocks
- repeated non-idempotent side effects should accelerate stop-loss rather than be retried silently
- cost tracking must include retries and repair or margins become falsely optimistic

## Implementation Trap Notes

### Trap 1: trusting the worker as final authority

- **Wrong assumption:** if the worker says it succeeded, the task is done.
- **Why it is wrong:** evidence review may still reject the result.
- **Correct interpretation:** verification is the final authority for founder-visible completion when verification is required.

### Trap 2: creating a second purchased task for same-scope repair

- **Wrong assumption:** repair should become a new normal task.
- **Why it is wrong:** it breaks trust and contradicts the same-scope repair rule.
- **Correct interpretation:** repair remains on the original task until stop-loss or scope expansion forces a new decision.

### Trap 3: allowing unlimited silent remediation

- **Wrong assumption:** if the founder should not be charged again, remediation can continue forever.
- **Why it is wrong:** it creates margin sink and repeated side-effect risk.
- **Correct interpretation:** apply explicit stop-loss boundaries.

### Trap 4: exposing actual cost as founder pricing logic

- **Wrong assumption:** post-run actual cost should change the founder-visible pricing model directly.
- **Why it is wrong:** the founder-visible story stays `1 task = 1 credit`.
- **Correct interpretation:** actual-cost truth remains hidden and improves governance/calibration later.

## Shared Contracts and Sibling Reconciliation

### Shared contracts

- runtime provides run history, artifacts, and raw outcomes that verification consumes
- lane working patterns define lane-specific success artifact expectations that verification must respect
- scheduler uses remediation classification to decide when same-scope repair may preempt ordinary work
- billing keeps `1 task = 1 credit` founder-simple while actual-cost accounting stays hidden and componentized
- CEO explains scoping and credits in founder-safe language but must not expose post-run internal economics
- dashboard may surface repaired or failed outcomes only after this subsystem writes the canonical result

### Owning spec rule

- this spec owns:
  - verification authority model
  - remediation classification
  - same-scope repair rule
  - remediation stop-loss model
  - post-run actual-cost record
  - margin feedback loop
- [runtime-entities-and-task-lifecycle.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/runtime-entities-and-task-lifecycle.md) owns:
  - raw runtime entity/state model
- [scheduler-queue-night-shift-and-recurring.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/scheduler-queue-night-shift-and-recurring.md) owns:
  - queue selection and remediation preemption timing
- [billing-credits-and-subscription-state.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing-credits-and-subscription-state.md) owns:
  - founder-visible credit rule and billing-lane boundaries
- [credits-and-task-charging.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/credits-and-task-charging.md) owns:
  - charge-on-start founder rule
- [internal-ledgers-and-unit-economics.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/billing/internal-ledgers-and-unit-economics.md) owns:
  - ledger families and deeper hidden money-bucket separation

### Reconciliation notes

- this rebuilt child now treats verification as final authority over founder-visible completion
- this rebuilt child now keeps repair on the original task with explicit stop-loss boundaries
- this rebuilt child now separates actual-cost truth from founder-visible charging
- sibling cleanup completed: all billing and continuity children are now rebuilt and aligned

## Acceptance Criteria

- verification is the final authority for founder-visible completion when required
- failed and repaired outcomes are explicit and evidence-backed
- same-scope misses are repaired without silently burning a new founder credit
- same-scope repair has explicit stop-loss boundaries
- every executed or terminated task writes a post-run actual-cost record
- historical actual-cost data can later support likely credit forecasting
- lane-specific verification evidence must honor lane-owned success artifact expectations

## Plain-Language New-Reader Tests

- If the worker says “done,” is the task automatically done?
- When does a repaired task become `Fixed` to the founder?
- What stops same-scope repair from running forever?
- Does post-run cost accounting change the founder-visible `1 task = 1 credit` rule?
- If a miss grows beyond original scope, is it still silent repair or new work?

If a new reader cannot answer these directly from this file, the subsystem is still ambiguous.

## Implementation Freedom

- exact verification engine implementation
- exact cost table schema
- exact internal margin dashboard implementation
- exact thresholds for mandatory verification by lane family

## Traceability

### Source topics

- [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
- [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
- [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
- [knowledge/topics/channels-and-growth-surfaces.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/channels-and-growth-surfaces.md)

### Source facts

- `FACT-EXEC-007`
- `FACT-EXEC-008`
- `FACT-EXEC-012F`
- `FACT-EXEC-012G`
- `FACT-EXEC-026`
- `FACT-MON-016`

### Source decisions

- `DEC-EXEC-001`
- `DEC-EXEC-004`
- `DEC-EXEC-005`
- `DEC-EXEC-006`
- `DEC-NIGHT-002`
- `DEC-CEO-003`
- `DEC-CRED-001`

### Claim-to-anchor audit

- verification is the final authority for founder-visible task completion:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-EXEC-012F`
  - decisions:
    - `DEC-EXEC-005`

- same-scope platform misses should be repaired through remediation capacity instead of silently burning a fresh manual credit:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-EXEC-007`
    - `FACT-MON-016`
  - decisions:
    - `DEC-NIGHT-002`
    - `DEC-CRED-001`

- same-scope repair must stop at explicit stop-loss boundaries rather than running forever:
  - topics:
    - [knowledge/topics/night-shifts-and-scheduler.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/night-shifts-and-scheduler.md)
  - facts:
    - `FACT-EXEC-012G`
  - decisions:
    - `DEC-EXEC-006`

- founder-safe credit language stays separate from internal post-run cost truth:
  - topics:
    - [knowledge/topics/ceo-and-founder-chat.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/ceo-and-founder-chat.md)
    - [knowledge/topics/credits-trial-and-billing.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/knowledge/topics/credits-trial-and-billing.md)
  - facts:
    - `FACT-MON-016`
    - `FACT-EXEC-026`
  - decisions:
    - `DEC-CEO-003`
    - `DEC-CRED-001`
    - `DEC-EXEC-004`

## Change Log

- `2026-04-06`: seeded initial verification and actual-cost packet
- `2026-04-12`: rebuilt the spec to lock verification as final authority, keep same-scope repair on the original task with explicit stop-loss limits, and separate founder-visible charging from hidden post-run actual-cost truth
