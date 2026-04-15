# Spec: Platform Ops and Self-Healing

- `Spec ID`: `SPEC-OPS-001`
- `Status`: new
- `Subsystem`: platform operations, self-healing, anomaly detection
- `Classification`: internal system
- `Sensitivity`: internal only
- `Related specs`:
  - [specs/internal/control-plane-runtime-and-task-agents.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane-runtime-and-task-agents.md)
  - [specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/control-plane/verification-remediation-and-actual-cost-accounting.md)
  - [specs/internal/ceo-chat-and-founder-conversation.md](C:/Users/Vaishnavi/My_Projects/baljia-ai/specs/internal/ceo-chat-and-founder-conversation.md)

## Purpose

Define the hidden platform-side operations layer that sits above the founder-facing 9-agent company system. This spec owns:

- the 9 internal platform-side agents/processes
- the detect → cluster → fix → verify → prevent-recurrence loop
- anomaly detection and cost baselines
- failure fingerprinting and known-issue registry
- regression guarding
- escalation paths from automated to human
- the boundary between platform ops and founder-visible agents

This layer is never visible to founders. It protects the platform backend itself while the visible company agents run founder work.

## Hidden-System Contract

- platform ops agents are not founder-facing business agents — they are hidden backend supervisors
- founders never see platform ops agent names, logs, or decision surfaces
- platform ops consumes internal platform budget, not founder credits
- platform ops can observe, diagnose, and fix issues across all companies on the platform
- platform ops must not modify founder-visible state without going through normal governance
- the system is not just detect → monitor → escalate; it is also cluster → fix → verify → prevent recurrence

## In Scope

- 9 platform-side agent/process definitions
- failure fingerprinting and clustering
- known-issue registry
- regression guarding
- cost and usage anomaly detection
- escalation from automated to human handoff
- self-healing loop mechanics
- platform ops budget and cost accounting

## Out of Scope

- founder-visible agent behavior (owned by lane spec)
- task-level remediation logic (owned by verification-remediation spec)
- exact prompt wording for platform ops agents
- infrastructure provisioning details (owned by onboarding/provisioning specs)
- rate limiting on founder chat (owned by CEO/chat spec)

## 9 Platform-Side Agents/Processes

### 1. `infra_watchdog`

**Purpose:** Real-time health monitoring for platform infrastructure.

**Watches:**

- queue health and backlog
- worker heartbeats and stuck runs
- browser session leaks and uncleaned contexts
- provisioning failures
- deploy and runtime incidents
- database connection health

**Behavior:**

- reports elapsed time since last visible progress event per active run
- can see currently active internal tool or `none`
- stall detection: flags runs with no progress beyond configurable threshold
- sits beside the turn-budget limiter (`maxTurns` is the turn-based cap; watchdog is the time-based cap)

**After detecting a bad run:**

- kill the stuck run
- mark task as failed with appropriate failure class
- trigger remediation evaluation
- alert platform ops if pattern repeats

### 2. `failure_fingerprinter`

**Purpose:** Normalize repeated failures into reusable issue signatures.

**Behavior:**

- receives failure events from verification and runtime
- extracts a canonical fingerprint from: error type, affected agent/tool, task shape, failure class
- clusters similar failures into failure families
- links retries to prior failures automatically with relevant context, logs, and reports
- updates the known-issue registry with new or recurring signatures

**Fingerprint shape:**

- `fingerprint_id`
- `failure_class` (from the 8-class taxonomy)
- `error_signature` (normalized error pattern)
- `affected_agent_lanes`
- `affected_tools`
- `affected_task_shapes`
- `occurrence_count`
- `first_seen_at`
- `last_seen_at`
- `current_status`: `new | investigating | fix_deployed | resolved | regression`

### 3. `known_issue_registry`

**Purpose:** Store clustered failure families, affected agents/tools, and current fix status.

**Behavior:**

- maintains a registry of known failure patterns
- each entry links to: fingerprint, affected companies, fix attempts, current status
- exposes known-issue context to CEO/chat before it scopes the next similar task
- penalizes known-bad routing paths or task shapes until evidence improves

**Registry entry shape:**

- `issue_id`
- `fingerprint_refs` (linked fingerprints)
- `affected_agent_lanes`
- `affected_task_families`
- `severity`: `low | medium | high | critical`
- `status`: `open | mitigating | resolved | regression`
- `fix_description`
- `regression_sensitive`: boolean
- `created_at`
- `resolved_at`

### 4. `regression_guard`

**Purpose:** Watch for reappearance of issues marked as fixed.

**Behavior:**

- monitors new failures against the known-issue registry
- if a new failure matches a fingerprint marked `resolved`, immediately escalates
- marks the known issue as `regression`
- notifies platform ops with full context
- can block the affected task shape from re-execution until reviewed

**Why this matters:** Without regression guarding, the same bug can silently recur after being "fixed," eroding platform reliability without anyone noticing until founders complain.

### 5. `platform_support_triage`

**Purpose:** Receive and classify escalations from founder-facing surfaces.

**Inputs:**

- `report_bug` calls from CEO/chat
- `suggest_feature` calls from CEO/chat
- automated escalations from other platform ops agents
- founder support requests

**Behavior:**

- classifies escalation as: bug, feature request, billing issue, abuse case, or platform incident
- routes to the appropriate handler (bug_reproducer, billing_credit_auditor, human ops)
- tracks escalation lifecycle from receipt to resolution

### 6. `bug_reproducer`

**Purpose:** Recreate failures from logs and state to prepare fixes or human handoff.

**Behavior:**

- receives classified bug escalations from triage
- attempts to reproduce the failure using:
  - task execution logs
  - failure fingerprint context
  - company state at time of failure
  - relevant reports and artifacts
- prepares a reproduction report with:
  - steps to reproduce
  - root cause hypothesis
  - suggested fix approach
  - whether automated fix is feasible
- hands off to automated fix path or human engineering

### 7. `prompt_policy_improver`

**Purpose:** Propose guarded changes to prompts, policies, and instructions.

**Behavior:**

- analyzes patterns from failure fingerprints and known issues
- identifies prompt or policy changes that would prevent recurring failures
- proposes changes as suggestions, never auto-deploys to production
- all prompt/policy changes require human review before deployment
- tracks improvement proposals and their outcomes

**Guardrails:**

- never auto-modifies production prompts
- proposals include: current prompt/policy, proposed change, evidence, expected impact
- changes are staged and tested before deployment

### 8. `routing_orchestration_analyst`

**Purpose:** Review routing failures, queue problems, and task-fit issues.

**Behavior:**

- monitors routing decisions and their outcomes
- identifies systematic routing failures (e.g., Engineering recommended for content tasks)
- detects queue health issues (backlog growth, priority inversion, starvation)
- proposes routing rule adjustments
- tracks routing accuracy metrics over time

**Key metrics:**

- routing recommendation accuracy (did the recommended agent succeed?)
- task-to-agent fit scores
- queue depth and wait time trends
- agent utilization balance

### 9. `billing_credit_auditor`

**Purpose:** Check ledger anomalies, disputes, refunds, and burn accuracy.

**Behavior:**

- monitors credit ledger for anomalies:
  - credits consumed but no task execution recorded
  - task execution recorded but no credit deduction
  - unusual credit burn rate
  - refund patterns that suggest abuse
- validates that actual cost accounting matches expected patterns
- flags billing disputes for human review
- audits the 4-lane billing model for consistency:
  - subscription lane
  - task credit lane
  - ad spend lane
  - runtime AI lane

## Self-Healing Loop

The platform ops system operates a continuous loop:

### Phase 1: Detect

- `infra_watchdog` monitors runtime health
- `billing_credit_auditor` monitors billing health
- `routing_orchestration_analyst` monitors routing health
- anomaly detection flags cost and usage outliers

### Phase 2: Cluster

- `failure_fingerprinter` normalizes failures into reusable signatures
- `known_issue_registry` stores and links failure families
- related failures are grouped rather than treated as isolated incidents

### Phase 3: Fix

- `bug_reproducer` recreates and diagnoses issues
- `prompt_policy_improver` proposes prevention changes
- automated remediation handles known patterns (up to max 100 repair attempts per scope)
- novel issues escalate to human engineering

### Phase 4: Verify

- `regression_guard` watches for recurrence
- fixed issues are marked `regression_sensitive`
- post-fix monitoring confirms the fix holds

### Phase 5: Prevent recurrence

- known-issue context is exposed to CEO/chat before similar tasks are scoped
- known-bad routing paths are penalized
- prompt/policy improvements are deployed after human review
- the system gets more reliable over time rather than treating every failure as isolated

## Anomaly Detection

### Cost anomaly signals

- account consuming materially more LLM/search/runtime cost than expected for its plan
- unusually high model-token burn per company
- unusually high search/tool usage per company
- cost per task materially exceeding expected envelope

### Usage anomaly signals

- repeated long CEO chat sessions with low execution value
- bursty repeated task-scoping or quote requests
- repeated regeneration loops
- abnormal browser or tool usage relative to account history

### Cost baselines

The platform maintains:

- expected cost envelope by account type (paid, trial, planning-only)
- rolling usage baseline by company/account
- anomaly flags when actual usage exceeds expected behavior materially

Baselines are collected from real usage data:

- CEO chat tokens per day
- search calls per day
- browser/runtime minutes per day
- average cost per active company
- task conversion rate from chat into actual execution

Limits are set from real percentiles, not guesses:

- soft limit near the upper healthy usage band
- hard limit only for clear outliers or repeated abuse

## Escalation Paths

| Severity | Automated response | Human handoff |
|---|---|---|
| Low | Log and monitor, update known-issue registry | No handoff unless recurring |
| Medium | Attempt automated remediation, notify platform ops | Handoff if 2+ automated attempts fail |
| High | Immediate escalation, pause affected execution | Human review required before resuming |
| Critical | Emergency pause, all affected companies notified | Immediate human response required |

### Escalation from task-level to platform-level

- individual task failure → verification-remediation spec handles it
- repeated failures matching the same fingerprint → platform ops takes over
- failure affecting multiple companies → platform-level incident
- cost anomaly exceeding envelope → billing_credit_auditor + human review

## Platform Ops Budget

- platform ops agents consume internal platform budget, not founder credits
- platform ops cost is tracked in the runtime AI billing lane as platform overhead
- cost controls apply to platform ops agents just as they do to founder-facing agents
- platform ops should not become a hidden cost drain — budget envelope applies

## State Authority

| State / field | Owner | Used by |
|---|---|---|
| Failure fingerprints | `failure_fingerprinter` | known_issue_registry, regression_guard, CEO/chat |
| Known-issue registry | `known_issue_registry` | all platform ops agents, CEO/chat (read-only) |
| Regression status | `regression_guard` | known_issue_registry, platform_support_triage |
| Platform health metrics | `infra_watchdog` | anomaly detection, escalation |
| Routing accuracy metrics | `routing_orchestration_analyst` | CEO routing decisions |
| Billing anomaly flags | `billing_credit_auditor` | escalation, human review |

## Data and Interface Contract

### `FailureFingerprint`

- `fingerprint_id`
- `failure_class`
- `error_signature`
- `affected_agent_lanes`
- `affected_tools`
- `affected_task_shapes`
- `occurrence_count`
- `first_seen_at`
- `last_seen_at`
- `current_status`
- `linked_task_ids`
- `linked_report_ids`

### `KnownIssue`

- `issue_id`
- `fingerprint_refs`
- `affected_agent_lanes`
- `affected_task_families`
- `severity`
- `status`
- `fix_description`
- `regression_sensitive`
- `repair_attempt_count`
- `created_at`
- `resolved_at`

### `PlatformHealthSnapshot`

- `snapshot_id`
- `timestamp`
- `queue_depth`
- `active_runs`
- `stuck_runs`
- `worker_heartbeat_status`
- `browser_session_count`
- `provisioning_failures_last_hour`
- `anomaly_flags`

### `CostBaseline`

- `account_type`
- `metric_name`
- `p50_value`
- `p90_value`
- `p99_value`
- `soft_limit`
- `hard_limit`
- `last_updated_at`

## Implementation Trap Notes

### Trap 1: exposing platform ops to founders

- **Wrong assumption:** founders should see the self-healing loop or platform ops agent names.
- **Why it is wrong:** platform ops is hidden infrastructure; exposing it creates confusion and support burden.
- **Correct interpretation:** founders see improved reliability over time; platform ops is invisible.

### Trap 2: treating every failure as isolated

- **Wrong assumption:** each failed task is independent and needs its own investigation from scratch.
- **Why it is wrong:** repeated failures often share root causes; fingerprinting and clustering catch patterns.
- **Correct interpretation:** cluster, link, and learn from failures systematically.

### Trap 3: auto-deploying prompt/policy changes

- **Wrong assumption:** if the system detects a prompt problem, it should fix it automatically.
- **Why it is wrong:** auto-deployed prompt changes can cascade into unexpected behavior.
- **Correct interpretation:** `prompt_policy_improver` proposes changes; humans review and deploy.

### Trap 4: promising "one bug report fixes it forever"

- **Wrong assumption:** reporting a failure means the platform guarantees it never recurs.
- **Why it is wrong:** self-healing improves reliability over time; it does not guarantee perfection.
- **Correct interpretation:** reported failures improve future behavior; repeated issues become easier to detect, explain, route, and prevent. The system gets more reliable over time.

## Acceptance Criteria

- all 9 platform ops agents/processes are defined with clear responsibilities
- failure fingerprinting normalizes repeated failures into reusable signatures
- known-issue registry stores failure families with fix status
- regression guard detects recurrence of previously-fixed issues
- anomaly detection monitors cost and usage against baselines
- escalation paths are defined from automated response through human handoff
- platform ops agents consume internal budget, not founder credits
- platform ops is invisible to founders
- CEO/chat can access known-issue context (read-only) before scoping similar tasks
- self-healing loop covers all 5 phases: detect, cluster, fix, verify, prevent recurrence

## Plain-Language New-Reader Tests

- What are the 9 hidden platform agents and what does each do?
- When a task fails, what happens beyond just marking it failed?
- How does the platform know if the same bug is happening again after being fixed?
- Can platform ops auto-change prompts in production?
- Does the founder see or pay for platform ops?
- What is the difference between task-level remediation and platform-level self-healing?

If a new reader cannot answer these directly from this file, the platform ops model is still ambiguous.

## Traceability

### Source material

- Polsia_Exact_Architecture_Details.md §1 (Platform Ops OS, lines 178-281)
- Polsia_Exact_Architecture_Details.md §26.4.1 (Closed-loop failure learning, lines 11351-11399)
- Polsia_Exact_Architecture_Details.md §2.5F (Anomaly detection, lines 1289-1503)

### Related decisions

- `DEC-REPAIR-001` (max repair attempts: 100)
- `DEC-ABUSE-001` (anomaly detection)

## Change Log

- `2026-04-13`: created platform ops and self-healing spec from Polsia source material and audit findings
