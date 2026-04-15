# Baljia AI: Spec-to-Code Audit & Implementation Plan

## Context

The Baljia AI platform has **23 internal specs** defining the architecture across control-plane (6 children), billing (5 children), and 8 core product specs. The codebase has substantial implementation (37 DB tables, 40 services, 48 API routes, 9 agents) but **diverges from specs in 15 critical areas**. This plan addresses every gap, ordered by severity and dependency.

### Codebase Inventory

| Area | Count | Details |
|------|-------|---------|
| DB Tables | 37 | `src/lib/db/schema.ts` (679 LOC) |
| Services | 40 | `src/lib/services/*.service.ts` |
| API Routes | 48 | `src/app/api/` |
| Pages/Layouts | 14 | Auth, Dashboard, Admin, Public, Live |
| Agent Files | 17 | Factory, CEO (5 files), 8 tool files, watchdog, worker-launcher |
| Types | 562 LOC | `src/types/index.ts` |
| Specs | 23 | `specs/internal/` (8 core + 6 control-plane + 5 billing + 4 meta) |

---

## Audit Findings: 15 Gaps

### GAP 1: Task Status Model Mismatch
- **Spec (SPEC-CTRL-102):** `todo -> in_progress -> verifying -> completed` + `failed -> repair -> verifying` + `failed_permanent` + `rejected`
- **Code (`src/types/index.ts:17`):** `created | todo | in_progress | completed_verified | completed_unverified | failed | rejected | blocked | partial`
- **Impact:** The whole lifecycle is different. Spec has `verifying` as a real status. Code has `completed_verified`/`completed_unverified` but no `verifying`. Code has `blocked`/`partial`/`created` which don't exist in spec. Spec has `failed_permanent` which code lacks.

### GAP 2: Verification Authority Violation (CRITICAL BUG)
- **Spec (SPEC-CTRL-106):** "Worker is NOT the final authority. Verifier sets final task status."
- **Code (`src/lib/agents/worker-launcher.ts:202`):** `await taskService.completeTask(taskId, false)` runs BEFORE verification at line 217. The worker marks the task complete, then verification runs as an afterthought in a try/catch.
- **Impact:** Core architectural invariant violated. Task can show as "completed" even if verification fails.

### GAP 3: Run/Session/Artifact Entities Missing
- **Spec (SPEC-CTRL-102):** Defines 5 entities: Task, Run, Session, Artifact, ApprovalRecord. Run = one execution attempt. Session = execution context. Task can have multiple Runs.
- **Code:** Only has `task_executions` table. No Session, Artifact, or ApprovalRecord tables. No concept of multiple Runs per Task with proper repair lineage.

### GAP 4: Execution Mode Not Wired to Dispatch
- **Spec (SPEC-CTRL-101):** 3 modes: `deterministic` (no LLM), `template_plus_params` (smaller model fills template), `full_agent` (full agent loop). Selected by governance BEFORE dispatch.
- **Code (`src/lib/agents/worker-launcher.ts:179`):** Always calls `executeAgent()` regardless of execution_mode. Governance classifies the mode but worker-launcher ignores it.

### GAP 5: ContextPacket Not Formalized
- **Spec (SPEC-CTRL-105):** Defines `ContextPacket` as bounded execution context with memory layers + prior reports + failure fingerprints + company state + compiled briefing. Also defines `PermissionSnapshot` as run-level permission envelope.
- **Code (`src/lib/agents/agent-factory.ts`):** Ad-hoc context injection. Some memory injection via `memoryService.assembleWorkerPacket()`, some report injection, but no formal ContextPacket shape. No PermissionSnapshot at all.

### GAP 6: Memory Token Budgets Not Enforced
- **Spec (SPEC-CTRL-105):** L1=15K tokens, L2=3K tokens, L3=15K tokens. Eviction policies defined. L2 autosaves every ~20 messages.
- **Code (`src/lib/services/memory.service.ts`):** `memory_layers` table has `max_tokens` column but no token counting, no eviction logic, no autosave trigger in chat flow.

### GAP 7: CEO Credit Quoting Not Wired Through Governance
- **Spec (SPEC-CEO-001):** CEO asks hidden governance for 5-field quote: `credits_required`, `task_split`, `founder_safe_reason`, `included_scope`, `blockers`.
- **Code (`src/lib/services/governance.service.ts`):** Returns `GovernanceDecision` with different fields. CEO prompt doesn't have explicit governance handoff tools.

### GAP 8: Rate Limiting Escalation Incomplete
- **Spec (SPEC-CEO-001):** 6-step escalation: observe -> soft-limit -> degrade -> cooldown -> flag -> suspend
- **Code (`src/lib/services/guardrail.service.ts`):** 4-level: observe -> degrade -> cooldown -> suspend. Missing `soft-limit` and `flag` steps.

### GAP 9: Platform Ops Agents (7 of 9 not implemented)
- **Spec (SPEC-OPS-001):** 9 hidden agents: infra_watchdog, failure_fingerprinter, known_issue_registry, regression_guard, platform_support_triage, bug_reproducer, prompt_policy_improver, routing_orchestration_analyst, billing_credit_auditor
- **Code:** Only has: watchdog (basic), failure fingerprinting (basic). Missing 7 agents.

### GAP 10: Cross-Company Memory (L3) Not Active
- **Spec:** L3 should aggregate anonymized patterns across companies with quality gating.
- **Code:** Table exists but no aggregation pipeline, no quality gating, no anonymization logic.

### GAP 11: Learnings System Incomplete
- **Spec:** Full CRUD: create_learning, search_learnings, read_learning, update_learning, delete_learning. Learning shape includes `learning_type`, `usage_count`, `last_referenced_at`, `status`.
- **Code (`src/lib/services/memory.service.ts`):** Has `extractLearnings` and `storeLearnings` but missing: update, delete, search by tags, usage_count tracking, status management.

### GAP 12: Night Shift Gap-Based Planning
- **Spec (SPEC-CTRL-103):** "Next task = strongest gap between ideal stage progression and current state." Stage-aware, archetype-specific.
- **Code (`src/lib/services/night-shift.service.ts`):** Has stage-based objectives but no actual gap analysis comparing ideal vs. current state.

### GAP 13: One-Slot Concurrency Enforcement
- **Spec:** Night shift and manual execution share ONE slot per company. No parallel runs.
- **Code (`src/lib/agents/worker-launcher.ts`):** Has double-execution prevention for same task, but does NOT prevent night-shift + manual running simultaneously for the same company.

### GAP 14: Founder App Provisioning Incomplete
- **Spec:** Neon DB + GitHub repo + Render deploy per founder company.
- **Code:** `neon.service.ts` exists for DB. No GitHub repo creation or Render deploy automation.

### GAP 15: CEO 10-Step Decision Flow Implicit
- **Spec (SPEC-CEO-001):** Explicit 10-step flow: interpret -> classify -> check state -> check credits -> check feasibility -> decide path -> estimate credits -> choose agent -> write brief -> queue/defer/refuse
- **Code (`src/lib/agents/ceo/ceo.prompt.ts`):** Flow is encoded in prompts, not structured code paths. Works for LLM-driven behavior but not verifiable/testable.

---

## Implementation Plan

### Phase 1: Task Lifecycle & Verification Authority (Gaps 1, 2, 3)

**Why first:** GAP 2 is a live data-integrity bug. Worker marks tasks complete BEFORE verification runs, violating the spec's core invariant. Everything downstream depends on the lifecycle being correct.

**Risk if skipped:** Data corruption, false task completions

**Effort:** 2-3 weeks

#### 1a. Fix Task Status Enum

**File:** `src/types/index.ts`

Change:
```typescript
// OLD
export type TaskStatus = 'created' | 'todo' | 'in_progress' | 'completed_verified' | 'completed_unverified' | 'failed' | 'rejected' | 'blocked' | 'partial';

// NEW (per SPEC-CTRL-102)
export type TaskStatus = 'todo' | 'in_progress' | 'verifying' | 'completed' | 'failed' | 'failed_permanent' | 'rejected' | 'blocked_pre_start' | 'blocked_in_run' | 'repair';
```

**Downstream files requiring status string updates:**

| File | What changes |
|------|-------------|
| `src/lib/services/task.service.ts` | Rewrite `completeTask` -> transition to `verifying`; add `finalizeTask(taskId, passed)` for verifier; update `CreateTaskInput.status` type |
| `src/lib/agents/worker-launcher.ts` | Update all status checks and transitions |
| `src/lib/services/verification.service.ts` | Becomes sole authority for `completed` or `failed` final state |
| `src/lib/services/stage.service.ts:38` | Change `['completed_verified', 'completed_unverified']` to `['completed']` |
| `src/lib/services/memory.service.ts:34,61` | Change `completed_verified` to `completed` |
| `src/lib/services/mascot.service.ts:190` | Change `['completed_verified', 'completed_unverified']` to `['completed']` |
| `src/lib/agents/ceo/ceo.tool-handlers.ts:262` | Update status checks |
| `src/app/company/[slug]/page.tsx:37` | Change `['completed_verified', 'completed_unverified']` to `['completed']` |
| `src/app/(admin)/ops/page.tsx:38-39` | Update status color map |
| `src/components/dashboard/TaskBoard.tsx:20,29` | Change tab value from `completed_verified` to `completed` |
| `src/components/dashboard/TaskCard.tsx:26-31` | Update status variant map |
| `src/components/dashboard/TaskDetailDialog.tsx:29-52` | Update status variant map and step definitions |
| `src/lib/services/night-shift.service.ts` | Update status queries |

#### 1b. Fix Verification Authority (Critical Bug)

**File:** `src/lib/agents/worker-launcher.ts` (lines 194-222)

Current broken flow:
```
executeAgent() -> completeTask(taskId, false) -> verifyAndUpdate() [try/catch, non-blocking]
```

Corrected flow:
```
executeAgent() -> updateTask(taskId, {status: 'verifying'}) -> verifyAndUpdate() -> finalizeTask(passed/failed)
```

Specific changes:
1. Line 202: Replace `await taskService.completeTask(taskId, false)` with `await taskService.updateTask(taskId, { status: 'verifying' })`
2. Lines 216-222: Remove try/catch around verification. Make it mandatory. If verification throws, task stays in `verifying` and gets flagged for review.
3. Verification service becomes sole authority for setting final task status.

**File:** `src/lib/services/task.service.ts`

Add new function:
```typescript
export async function finalizeTask(taskId: string, passed: boolean): Promise<Task> {
  return updateTask(taskId, {
    status: passed ? 'completed' : 'failed',
    completed_at: new Date().toISOString(),
  });
}
```

Modify `completeTask` to transition to `verifying`:
```typescript
export async function completeTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: 'verifying' });
}
```

**File:** `src/lib/services/verification.service.ts`
- Change line 318: `completeTask(taskId, true)` -> `finalizeTask(taskId, true)`
- Change line 320 comment: remove "leave as completed_unverified" -> call `finalizeTask(taskId, false)` on verification failure

#### 1c. Add Run/Session/Artifact/ApprovalRecord Entities

**File:** `src/lib/db/schema.ts` -- Add 4 new tables:

```typescript
// Session — runtime container for one execution context
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  session_type: varchar('session_type', { length: 50 }).notNull(), // execution | verification | remediation
  status: varchar('status', { length: 50 }).default('active').notNull(),
  context_packet_version: integer('context_packet_version').default(1),
  permission_snapshot: jsonb('permission_snapshot'),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
});

// Run — one concrete execution attempt within a session
export const runs = pgTable('runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  session_id: uuid('session_id').notNull().references(() => sessions.id),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  attempt_number: integer('attempt_number').notNull().default(1),
  status: varchar('status', { length: 50 }).default('running').notNull(),
  agent_id: integer('agent_id').references(() => agents.id),
  execution_mode: varchar('execution_mode', { length: 50 }).notNull(),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
  failure_class: varchar('failure_class', { length: 50 }),
  turn_count: integer('turn_count').default(0),
  token_usage: jsonb('token_usage'),
  wall_clock_seconds: integer('wall_clock_seconds'),
  error_summary: text('error_summary'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Artifact — durable output or evidence linked to a run
export const artifacts = pgTable('artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  run_id: uuid('run_id').notNull().references(() => runs.id),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  artifact_type: varchar('artifact_type', { length: 50 }).notNull(), // report | screenshot | log | receipt | code
  content_ref: text('content_ref'), // URL or storage path
  evidence: jsonb('evidence'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ApprovalRecord — stored approval lineage for risky work
export const approvalRecords = pgTable('approval_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  risk_class: varchar('risk_class', { length: 50 }).notNull(),
  approved_by: varchar('approved_by', { length: 50 }).notNull(), // founder | auto | governance
  approved_at: timestamp('approved_at', { withTimezone: true }).defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  status: varchar('status', { length: 50 }).default('active').notNull(),
});
```

**File:** `src/types/index.ts` -- Add TypeScript interfaces:

```typescript
export interface Session {
  id: string;
  company_id: string;
  task_id: string;
  session_type: 'execution' | 'verification' | 'remediation';
  status: string;
  context_packet_version: number;
  permission_snapshot: Record<string, unknown> | null;
  started_at: string;
  ended_at: string | null;
}

export interface Run {
  id: string;
  session_id: string;
  task_id: string;
  attempt_number: number;
  status: string;
  agent_id: number | null;
  execution_mode: ExecutionMode;
  started_at: string;
  ended_at: string | null;
  failure_class: FailureClass | null;
  turn_count: number;
  token_usage: Record<string, unknown> | null;
  wall_clock_seconds: number | null;
  error_summary: string | null;
  created_at: string;
}

export interface Artifact {
  id: string;
  run_id: string;
  task_id: string;
  artifact_type: 'report' | 'screenshot' | 'log' | 'receipt' | 'code';
  content_ref: string | null;
  evidence: Record<string, unknown> | null;
  created_at: string;
}

export interface ApprovalRecord {
  id: string;
  task_id: string;
  risk_class: string;
  approved_by: 'founder' | 'auto' | 'governance';
  approved_at: string;
  expires_at: string | null;
  status: string;
}
```

**Migration strategy:** Keep `task_executions` for backward compat. Write backfill script to create session+run records from existing task_executions rows.

#### Phase 1 Testing

- Unit: Exhaustive state machine tests for every valid/invalid status transition
- Integration: Task where verification fails must NOT end in `completed`
- Integration: Task where verification throws must stay in `verifying`
- Run `npm run build` to verify all type references compile

---

### Phase 2: Execution Mode Dispatch & Context Assembly (Gaps 4, 5)

**Why second:** With lifecycle corrected, the execution path must actually branch on mode. Currently every task pays full-agent cost even when deterministic would suffice.

**Risk if skipped:** Wasted compute, unbounded context

**Effort:** 1.5-2 weeks

**Dependencies:** Phase 1 (corrected lifecycle model)

#### 2a. Wire execution_mode to Dispatch

**File:** `src/lib/agents/worker-launcher.ts` (line 179)

Replace unconditional `executeAgent()` with 3-way switch:
```typescript
switch (task.execution_mode) {
  case 'deterministic':
    result = await executeDeterministic(task, session);
    break;
  case 'template_plus_params':
    result = await executeTemplate(task, session);
    break;
  case 'full_agent':
  default:
    result = await executeAgent({ task, agentId, agentName, watchdog, execution });
    break;
}
```

**New file:** `src/lib/agents/deterministic-executor.ts`
- Maps deterministic tags (from `governance.service.ts` lines 35-45: css, seo, domain, tracking, favicon, deploy, config, copy) to script functions
- No LLM calls -- direct code execution
- Returns same result shape as `executeAgent`

**New file:** `src/lib/agents/template-executor.ts`
- Uses Haiku/Gemini Flash (smaller, cheaper model) to fill template parameters
- Tags from `governance.service.ts` lines 48-73: landing-page, auth, billing, settings, legal, etc.
- Returns same result shape as `executeAgent`

#### 2b. Formalize ContextPacket & PermissionSnapshot

**File:** `src/types/index.ts` -- Add interfaces:

```typescript
export interface ContextPacket {
  memory_layers: {
    l1_domain_knowledge: string;
    l2_user_preferences: string;
    l3_cross_company: string;
  };
  prior_reports: Array<{ id: string; title: string; content: string; task_id: string }>;
  failure_fingerprints: Array<{ fingerprint: string; category: string; description: string }>;
  company_state: {
    stage: CompanyStage;
    lifecycle: Lifecycle;
    billing_state: BillingState;
  };
  compiled_briefing: string;
}

export interface PermissionSnapshot {
  tool_mount_profile: string[];
  allowed_tools: string[];
  forbidden_actions: string[];
  risk_ceiling: 'low' | 'medium' | 'high';
  max_turns: number;
}
```

**File:** `src/lib/services/memory.service.ts`
- Refactor `assembleWorkerPacket()` to `buildContextPacket()` returning typed `ContextPacket`
- Current implementation already has the pieces (L1, L2, learnings, reports) but returns concatenated string

**File:** `src/lib/agents/agent-factory.ts`
- Consume typed `ContextPacket` in prompt assembly
- Add `PermissionSnapshot` construction based on agent role + task risk class

**File:** `src/lib/services/governance.service.ts`
- Extend `GovernanceDecision` to include `permission_snapshot` field

#### Phase 2 Testing

- Unit: Deterministic executor handles CSS/SEO tags without LLM calls
- Unit: Template executor uses Haiku model, not Sonnet
- Unit: ContextPacket includes all required sections and respects types

---

### Phase 3: Memory Token Enforcement & Learnings (Gaps 6, 11)

**Why third:** Without token budgets, context windows overflow silently. Without full learnings CRUD, the platform can't improve over time.

**Risk if skipped:** Context overflow, no improvement loop

**Effort:** 1 week

**Dependencies:** Phase 1 (schema stability)

#### 3a. Token Counting & Eviction

**File:** `src/lib/services/memory.service.ts`

Add:
- `countTokens(text: string): number` -- character-based approx (4 chars/token) or use `tiktoken`
- On every write to `memory_layers`, enforce: L1 max 15K, L2 max 3K, L3 max 15K tokens
- Eviction logic:
  - L1/L3: evict oldest content first
  - L2: summarize and compact (replace full content with condensed version)
- The `memory_layers` table already has `max_tokens` and `token_count` columns -- just needs enforcement

#### 3b. L2 Autosave in Chat Flow

**File:** `src/lib/services/chat.service.ts`
- Track message count per session
- Every 20 messages, trigger `memoryService.autosaveL2(companyId, recentMessages)`
- L2 autosave extracts founder preferences from recent conversation context and writes to memory layer 2

#### 3c. Complete Learnings CRUD

**File:** `src/lib/db/schema.ts` -- Add columns to `learnings` table:
- `learning_type` (varchar): success_pattern | failure_pattern | routing_insight | tool_insight | domain_knowledge
- `usage_count` (integer, default 0)
- `last_referenced_at` (timestamptz)
- `status` (varchar, default 'active'): active | superseded | archived

**File:** `src/lib/services/memory.service.ts` -- Add functions:
- `updateLearning(id, fields)` -- update content, tags, status
- `deleteLearning(id)` -- remove outdated learning
- `searchLearnings(companyId, query, tags)` -- search by content and tags
- `incrementUsageCount(id)` -- called automatically by `getRelevantLearnings`

#### Phase 3 Testing

- Unit: Write content exceeding L1 budget -> verify eviction occurs
- Unit: Full CRUD cycle for learnings with usage tracking
- Integration: 20-message chat session triggers L2 autosave

---

### Phase 4: Scheduling, Concurrency & CEO Flow (Gaps 7, 8, 12, 13, 15)

**Why fourth:** Operational correctness gaps. Not data-corrupting but affect credit accounting, race conditions, and product reliability.

**Risk if skipped:** Credit accounting errors, race conditions

**Effort:** 2 weeks

**Dependencies:** Phase 1 (corrected lifecycle model)

#### 4a. One-Slot Concurrency Enforcement (Gap 13)

**File:** `src/lib/agents/worker-launcher.ts`
- Before launching any task, query: `SELECT count(*) FROM tasks WHERE company_id = ? AND status = 'in_progress'`
- If count > 0, block launch regardless of source (manual or night-shift)

**File:** `src/lib/services/night-shift.service.ts`
- Add pre-check: if any manual task is `in_progress` for this company, skip this cycle

#### 4b. Night Shift Gap-Based Planning (Gap 12)

**File:** `src/lib/services/night-shift.service.ts`
- Add `computeStageGap(companyId, stage)`:
  1. Load archetype-specific ideal progression (tags/capabilities expected at this stage)
  2. Compare against actual completed tasks and active capabilities
  3. Return ranked gaps as candidate task descriptions
- Integrate with existing `STAGE_OBJECTIVES` map but make it data-driven

#### 4c. Rate Limiting Escalation (Gap 8)

**File:** `src/lib/services/guardrail.service.ts`
- Expand `GuardrailLevel` from 4 to 6:
  ```typescript
  export type GuardrailLevel = 'observe' | 'soft_limit' | 'degrade' | 'cooldown' | 'flag' | 'suspend';
  ```
- `soft_limit`: reduce max_turns by 50%, add warning to execution logs
- `flag`: like cooldown but also creates platform event flagging company for ops review

#### 4d. CEO Credit Quoting via Governance (Gap 7)

**File:** `src/lib/services/governance.service.ts`
- Add `getCreditQuote(task)` returning spec's 5-field shape:
  ```typescript
  interface CreditQuote {
    credits_required: number;
    task_split: Array<{ title: string; description: string; tag: string }>;
    founder_safe_reason: string;
    included_scope: string;
    blockers: string[];
  }
  ```

**File:** `src/lib/agents/ceo/ceo.tool-defs.ts`
- Add `get_governance_quote` tool definition

**File:** `src/lib/agents/ceo/ceo.tool-handlers.ts`
- Handler calls `governanceService.getCreditQuote()`

#### 4e. CEO 10-Step Decision Flow (Gap 15)

**File:** `src/lib/agents/ceo/ceo.agent.ts`
- Add `CeoDecisionPipeline` class with explicit step methods:
  1. `interpret()` -- parse founder intent
  2. `classify()` -- chat-only | one task | multiple tasks | blocked | outside scope
  3. `checkState()` -- company phase, queue, completed/failed tasks
  4. `checkCredits()` -- balance vs required
  5. `checkFeasibility()` -- tools available, prerequisites met
  6. `decidePath()` -- create | decompose | block | narrow | refuse
  7. `estimateCredits()` -- call governance quote
  8. `chooseAgent()` -- find_best_agent / find_agent_for_task
  9. `writeBrief()` -- worker-facing task description
  10. `queueOrRefuse()` -- final action
- Each step emits structured telemetry (logged to platform_events)
- LLM still drives the conversation, but steps are verifiable/testable

#### Phase 4 Testing

- Integration: Launch manual task while night-shift runs -> second task blocked
- Unit: Guardrail escalation moves through all 6 levels in order
- Unit: CEO governance quote returns all 5 required fields
- Unit: `computeStageGap` returns ranked gaps for each company stage

---

### Phase 5: Platform Ops Agents (Gaps 9, 10)

**Why fifth:** New feature additions that enhance platform intelligence. Depend on corrected lifecycle and memory models.

**Risk if skipped:** No self-healing, no cross-company learning

**Effort:** 3-4 weeks

**Dependencies:** Phases 1-3

#### 5a. Implement 7 Missing Ops Agents

All in `src/lib/agents/ops/`:

| # | File | Agent | Purpose |
|---|------|-------|---------|
| 1 | `known-issue-registry.ts` | known_issue_registry | Maintains registry of known failure patterns. Exposes lookup to CEO before scoping similar tasks. |
| 2 | `regression-guard.ts` | regression_guard | Monitors new failures against resolved fingerprints. Escalates regressions immediately. |
| 3 | `platform-support-triage.ts` | platform_support_triage | Classifies escalations: bug, feature, billing, abuse, incident. |
| 4 | `bug-reproducer.ts` | bug_reproducer | Attempts to reproduce failures from logs in sandboxed environment. |
| 5 | `prompt-policy-improver.ts` | prompt_policy_improver | Analyzes task outcomes, suggests (never auto-deploys) prompt improvements. |
| 6 | `routing-orchestration-analyst.ts` | routing_orchestration_analyst | Monitors routing accuracy, identifies misroutes. |
| 7 | `billing-credit-auditor.ts` | billing_credit_auditor | Audits credit transactions for inconsistencies. |

**Architecture:** Run on scheduled crons, NOT per-task. Write findings to `platform_events`. Consume internal platform budget, not founder credits.

**New cron routes:**
- `src/app/api/cron/ops-health/route.ts` -- Runs infra_watchdog + regression_guard
- `src/app/api/cron/ops-analysis/route.ts` -- Runs routing analyst + billing auditor + prompt improver

#### 5b. Cross-Company Memory Pipeline (Gap 10)

**File:** `src/lib/services/memory.service.ts`
- Add `aggregateL3Patterns()`:
  1. Query high-confidence learnings across all companies
  2. Anonymize company-specific details (remove names, IDs, business secrets)
  3. Quality-gate (minimum usage_count, minimum confidence)
  4. Write to L3 memory layer
- Schedule via cron (daily or weekly)

#### Phase 5 Testing

- Unit: Each ops agent's core logic in isolation
- Integration: Inject a regression fingerprint -> regression-guard creates alert event
- Unit: L3 aggregation anonymizes company-specific data

---

### Phase 6: Provisioning & Polish (Gap 14, cleanup)

**Why last:** Feature completeness, not correctness. Can run in parallel with Phases 2-5.

**Risk if skipped:** Manual setup required per company

**Effort:** 1.5-2 weeks

**Dependencies:** None (can run in parallel)

#### 6a. Complete Founder App Provisioning

**New files:**
- `src/lib/services/github.service.ts` -- GitHub repo creation via API (clone template repo, configure for founder project)
- `src/lib/services/render.service.ts` -- Render service deployment via API (create web service, link to GitHub repo)

**Existing file:** `src/lib/services/neon.service.ts` -- Already exists for DB provisioning. Verify full flow.

Wire all three into onboarding: `src/app/api/onboarding/route.ts`

#### 6b. Deprecate task_executions Table

After all phases complete:
- Add deprecation notice to `task_executions` in `src/lib/db/schema.ts`
- Write migration adding a view mapping old queries to new `sessions` + `runs` tables
- Update remaining references

#### Phase 6 Testing

- Integration: Full onboarding flow creates Neon DB + GitHub repo + Render service
- Smoke test: Existing task_executions queries still work via view

---

## Summary Table

| Phase | Gaps | Risk if Skipped | Effort | Dependencies |
|-------|------|-----------------|--------|-------------|
| **1: Lifecycle + Verification** | 1, 2, 3 | **Data corruption**, false completions | 2-3 weeks | None |
| **2: Execution + Context** | 4, 5 | Wasted compute, unbounded context | 1.5-2 weeks | Phase 1 |
| **3: Memory + Learnings** | 6, 11 | Context overflow, no improvement loop | 1 week | Phase 1 |
| **4: Scheduling + CEO** | 7, 8, 12, 13, 15 | Credit errors, race conditions | 2 weeks | Phase 1 |
| **5: Platform Ops** | 9, 10 | No self-healing, no cross-company learning | 3-4 weeks | Phases 1-3 |
| **6: Provisioning** | 14 | Manual setup per company | 1.5-2 weeks | None (parallel) |

**Total estimated effort:** 11-15 weeks

---

## Critical Files (most-modified across phases)

| File | Phases | Why |
|------|--------|-----|
| `src/lib/agents/worker-launcher.ts` | 1, 2, 4 | Verification bug, execution dispatch, concurrency |
| `src/lib/db/schema.ts` | 1, 3 | New entities, learnings columns |
| `src/types/index.ts` | 1, 2, 3 | Status enum, ContextPacket, PermissionSnapshot, new interfaces |
| `src/lib/services/verification.service.ts` | 1 | Becomes sole status authority |
| `src/lib/services/memory.service.ts` | 2, 3, 5 | ContextPacket, token enforcement, learnings CRUD, L3 pipeline |
| `src/lib/services/governance.service.ts` | 2, 4 | PermissionSnapshot, credit quote |
| `src/lib/services/guardrail.service.ts` | 4 | 6-level escalation |
| `src/lib/agents/ceo/ceo.tool-defs.ts` | 4 | Governance quote tool |
| `src/lib/services/night-shift.service.ts` | 4 | Gap planning, concurrency check |
| `src/lib/services/task.service.ts` | 1 | Status transitions, finalizeTask |

---

## Verification Plan

After each phase:
1. `npm run build` -- TypeScript compilation passes
2. `npm test` -- All existing tests pass (update as needed)
3. `npm run lint` -- No lint errors
4. Manual smoke test via `npm run dev`:
   - **Phase 1:** Create task -> approve -> verify task stays in `verifying` until verification completes
   - **Phase 2:** Create a CSS task -> verify it uses deterministic executor (no LLM calls in logs)
   - **Phase 3:** Send 20+ chat messages -> verify L2 autosave triggers
   - **Phase 4:** Try launching 2 tasks simultaneously for same company -> second blocked
   - **Phase 5:** Inject failure -> verify regression guard creates alert
   - **Phase 6:** Run onboarding -> verify GitHub + Render provisioning
