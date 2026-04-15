# Baljia AI Audit Report

## Executive summary
The main risks are:

1. billing policy drift — failed tasks can be auto-refunded even though execution should require credits and refund behavior should be tightly controlled.
2. execution authorization is implicit, not explicit — task rows may intentionally exist before approval, but the code does not clearly persist why a task was allowed to run.
3. security gaps — magic-link tokens are stored unhashed, and company DB connection strings are stored plaintext.
4. deployment/ops drift — cron auth naming is inconsistent, and the lint/CI setup is not reliable.
5. frontend correctness bugs — duplicate approve/reject requests, broken retry flow, and optimistic UI drift.

## Validation snapshot
- `npx tsc --noEmit` — passed
- `npm test` — passed
- `npm run build` — passed, but with warnings including unresolved `pg` import paths in agent tool code
- `npm run lint` — not automation-safe; `next lint` launches interactive setup (`package.json:9`)

## Confirmed controls that are present
- Dashboard ownership check exists  
  `src/app/(dashboard)/dashboard/[companyId]/page.tsx:16` and `src/app/(dashboard)/dashboard/[companyId]/page.tsx:45`
- Founder-triggered execution does check credits before continuing  
  `src/lib/agents/worker-launcher.ts:136`
- Atomic task claim exists  
  `src/lib/services/task.service.ts:110`
- Task launch checks lifecycle / execution state before running  
  `src/lib/agents/worker-launcher.ts:58`

## Critical findings

### 1) Failed-task auto-refund logic conflicts with the intended billing model
**Evidence**
- `src/lib/agents/worker-launcher.ts:344`
- `src/lib/services/credit.service.ts:196`
- `src/lib/services/governance.service.ts:329`

**What’s happening**
- The runtime will auto-refund failed tasks when `refund_policy === 'auto_eligible'`.
- Governance actively classifies many tasks as `auto_eligible`.

**Why it matters**
- This directly changes credit economics and founder balances.
- It conflicts with the intended rule that execution requires credits and failed runs should not silently reverse that policy.

**Impact**
- Incorrect balances
- inconsistent founder experience
- billing/support disputes

**Fix direction**
- Make refund policy explicit and aligned to the product rule.
- If refunds are exceptional, they should be manual or policy-gated, not default runtime behavior.

### 2) Execution authorization is not explicit enough to audit confidently
**Evidence**
- `src/app/api/tasks/[taskId]/approve/route.ts:19`
- `src/lib/services/task.service.ts:97`
- `src/lib/services/approval.service.ts:31`
- `src/lib/db/schema.ts:754`
- `src/lib/agents/worker-launcher.ts:410`
- `src/lib/agents/ceo/ceo.tool-handlers.ts:433`

**What’s happening**
- A task can exist before founder approval, which is intentional.
- But the code does not clearly persist why execution was allowed:
  - founder approval
  - night shift
  - recurring
  - remediation
- `approveTask()` writes `todo` to `todo` (`task.service.ts:97`), so approval is not represented as a meaningful state transition.
- `approval_records` exists in schema, but the active approval logic uses in-memory cache + `platform_events`, not the dedicated table.

**Why it matters**
- The core risk is not pre-created tasks.
- The risk is that queue eligibility and execution authorization are implicit, so it’s hard to prove whether a run was valid.

**Impact**
- weak auditability
- harder debugging of "why did this run?"
- possible policy drift across founder vs night-shift paths

**Fix direction**
- Persist execution authorization lineage durably.
- Make it queryable why a task ran, not just what status it had.

### 3) Magic-link tokens are stored unhashed
**Evidence**
- `src/lib/services/auth.service.ts:37`
- `src/lib/services/auth.service.ts:74`
- `src/lib/db/schema.ts:39`

**What’s happening**
- Raw tokens are stored in DB and later matched directly.

**Why it matters**
- Anyone with DB read access can use still-valid login links.

**Impact**
- account takeover risk

**Fix direction**
- Store a hash of the token, compare hashes on verify, keep raw token only in the emailed URL.

### 4) Company database connection strings are stored plaintext
**Evidence**
- `src/lib/db/schema.ts:87`
- `src/types/index.ts:75`

**What’s happening**
- `companies.neon_connection_string` is stored directly and exposed in the typed model.

**Why it matters**
- This is a high-value secret.
- Plaintext storage expands blast radius of any DB or app read leak.

**Impact**
- direct DB compromise risk for founder company environments

**Fix direction**
- Encrypt at rest or store via secret manager / indirection, not raw DB column access.

## High findings

### 5) Night-shift eligibility does not match the latest rule
**Evidence**
- `src/app/api/cron/night-shift/route.ts:30`
- `src/lib/agents/worker-launcher.ts:43`

**What’s happening**
- Code treats `trial_active`, `full_active`, and `keep_live_active` as execution-eligible.
- The intended rule is: night shift should run only if an active plan is there.

**Why it matters**
- Current code still allows night-shift execution for trial lifecycle states.

**Impact**
- unauthorized night-shift execution
- incorrect credit/value delivery behavior

**Fix direction**
- Align night-shift gating with the real subscription/plan rule, not broad lifecycle assumptions.

### 6) Task detail dialog can send duplicate approve/reject requests
**Evidence**
- `src/components/dashboard/TaskDetailDialog.tsx:67`
- `src/components/dashboard/TaskDetailDialog.tsx:83`
- `src/components/dashboard/DashboardShell.tsx:65`
- `src/components/dashboard/DashboardShell.tsx:81`

**What’s happening**
- Dialog posts directly to approve/reject API.
- On success it also calls parent callbacks.
- Parent callbacks post again.

**Why it matters**
- Same action can fire twice.

**Impact**
- duplicated events
- racey UI state
- confusing failure/success handling

**Fix direction**
- Pick one owner for the network mutation: dialog or parent, not both.

### 7) Optimistic task UI rollback is incorrect
**Evidence**
- `src/components/dashboard/DashboardShell.tsx:67`
- `src/components/dashboard/DashboardShell.tsx:74`
- `src/components/dashboard/DashboardShell.tsx:83`
- `src/components/dashboard/DashboardShell.tsx:88`

**What’s happening**
- Approve revert writes `todo` again instead of restoring prior state.
- Reject revert also hardcodes `todo`.
- Code only reverts on thrown fetch failure, not non-OK HTTP responses.

**Why it matters**
- The UI can show a state that the backend rejected.

**Impact**
- dashboard drift
- misleading founder actions

**Fix direction**
- Preserve previous state and handle `res.ok` explicitly.

### 8) Founder UI leaks internal execution mechanics
**Evidence**
- `src/components/dashboard/TaskCard.tsx:15`
- `src/components/dashboard/TaskCard.tsx:117`
- `src/components/dashboard/TaskDetailDialog.tsx:188`
- `src/components/dashboard/TaskDetailDialog.tsx:189`

**What’s happening**
- UI displays `execution_mode` and `verification_level`.

**Why it matters**
- The product model says internal machinery should stay hidden from founders.

**Impact**
- spec drift
- worse founder-facing abstraction

**Fix direction**
- Translate these into founder-safe language or remove them from founder UI.

### 9) Cron secret naming is inconsistent across code and deployment
**Evidence**
- `src/app/api/cron/night-shift/route.ts:23`
- `render.yaml:41`
- `render.yaml:68`
- `render.yaml:75`

**What’s happening**
- Route expects `CRON_KEY`.
- Render config provides `CRON_SECRET`.

**Why it matters**
- Scheduled jobs may fail silently depending on environment.

**Impact**
- cron outages
- missed night shifts / recurring processing

**Fix direction**
- Standardize one env var name everywhere.

### 10) Linting is not currently reliable for CI or local automation
**Evidence**
- `package.json:9`
- `.github/workflows/ci.yml:27`

**What’s happening**
- `lint` uses deprecated `next lint`.
- Running it launches interactive ESLint setup.
- CI does not run lint at all.

**Why it matters**
- Lint is effectively absent from the quality gate.

**Impact**
- style/static regressions can slip through
- no non-interactive lint command for automation

**Fix direction**
- Move to ESLint CLI and add it to CI.

## Medium findings

### 11) Queue/top-of-queue execution behavior is too implicit
**Evidence**
- `src/lib/agents/worker-launcher.ts:410`
- `src/lib/agents/ceo/ceo.tool-handlers.ts:433`
- `src/lib/services/task.service.ts:49`

**What’s happening**
- Queue processor launches `todo` tasks in queue order.
- "Move to top" just changes `queue_order`.
- There is no explicit executable/approved marker distinct from `exists in queue`.

**Why it matters**
- With the clarified model, this needs to be crystal clear:
  - founder-driven runs need credits
  - night shift needs eligible plan state
  - top-of-queue alone should not be mistaken for authorization

**Impact**
- hard-to-audit queue semantics
- ambiguous run eligibility

**Fix direction**
- Separate `queued` from `authorized to execute`, or persist the execution reason clearly.

### 12) Failed task retry path looks broken
**Evidence**
- `src/components/dashboard/TaskDetailDialog.tsx:93`
- `src/app/api/tasks/[taskId]/approve/route.ts:19`

**What’s happening**
- Retry posts to `/approve`.
- Approve rejects anything not already in `todo`.
- Failed tasks will likely 400.

**Why it matters**
- Founders may see a retry button that does not actually retry.

**Impact**
- broken recovery UX

**Fix direction**
- Add a real retry path or remove the button until supported.

### 13) Chat persistence exists server-side, but not in the frontend UX
**Evidence**
- `src/app/api/chat/route.ts:35`
- `src/lib/services/chat.service.ts:38`
- `src/components/chat/ChatPanel.tsx:14`

**What’s happening**
- Backend persists chat sessions.
- Frontend always starts with empty local `messages`.

**Why it matters**
- Reload/remount loses visible history even though history exists.

**Impact**
- confusing chat UX
- inconsistent founder continuity

**Fix direction**
- Hydrate latest active session into `ChatPanel`.

### 14) Onboarding can redirect users into partially-ready dashboard states
**Evidence**
- `src/app/(auth)/onboarding/page.tsx:125`
- `src/app/(auth)/onboarding/page.tsx:133`

**What’s happening**
- On timeout or SSE error, onboarding navigates to dashboard anyway.

**Why it matters**
- This assumes the backend is ready enough, which may not be true.

**Impact**
- half-initialized dashboard states
- confusing onboarding failures

**Fix direction**
- Differentiate transient stream failure from setup completion.

### 15) Onboarding request shape is ambiguous
**Evidence**
- `src/app/(auth)/onboarding/page.tsx:148`

**What’s happening**
- The client sends both `idea` and `business_url` from the same input.

**Why it matters**
- This makes the route depend on implicit journey branching.

**Impact**
- subtle onboarding bugs
- poor payload clarity

**Fix direction**
- Send only the field relevant to the chosen journey.

### 16) Task board does not expose all important founder-visible states
**Evidence**
- `src/components/dashboard/TaskBoard.tsx:15`
- `src/types/index.ts:17`

**What’s happening**
- Task board tabs only show: `all`, `todo`, `in_progress`, `verifying`, `completed`, `failed`.
- Type model includes `rejected`, `failed_permanent`, `blocked_pre_start`, `blocked_in_run`, `repair`.

**Why it matters**
- Founders cannot fully inspect queue outcomes/states.

**Impact**
- incomplete dashboard visibility

**Fix direction**
- Align tabs with the intended visible state model.

### 17) Execution timeout appears misaligned with the intended runtime model
**Evidence**
- `src/lib/agents/worker-launcher.ts:37`

**What’s happening**
- Launcher hard-caps task execution at 10 minutes.

**Why it matters**
- If the intended runtime allows much longer bounded execution, this is a real behavior mismatch.

**Impact**
- false timeouts on legitimate work

**Fix direction**
- Align code timeout with the real runtime contract.

## Low findings

### 18) CI only runs on `main`
**Evidence**
- `.github/workflows/ci.yml:4`

**Why it matters**
- Current session started on `master`; that branch may not get CI by default.

### 19) Test coverage is narrow
**Evidence**
- `vitest.config.ts:8`
- `vitest.config.ts:11`

**What’s happening**
- Coverage is focused on `src/lib/**`.
- Only low-level coverage was found, not route/dashboard/runtime flow coverage.

**Why it matters**
- The highest-risk surfaces are mostly untested.

### 20) Build is green but not clean
**Evidence**
- Build warnings referenced `src/lib/agents/tools/data.tools.ts` and `src/lib/agents/tools/engineering.tools.ts`

**What’s happening**
- Production build reported unresolved `pg` warnings in execution-related import paths.

**Why it matters**
- Build success may hide runtime failures in agent execution code paths.

## Corrected execution / approval conclusion
Pre-created tasks are not a bug by themselves.

The actual issue is this:

> **Execution authorization is not explicit enough to audit confidently.**  
> Tasks may intentionally exist before approval, but the code should make it easy to verify why a task was allowed to run — founder-triggered execution with credits, night-shift execution with eligible plan state, recurring execution, or remediation. Today, that lineage is not clearly encoded in the runtime path or durable approval model.

## Recommended fix order
1. Align refund/credit policy with intended product behavior.
2. Make execution authorization lineage durable and explicit.
3. Hash magic-link tokens.
4. Remove plaintext company DB connection string exposure.
5. Fix night-shift eligibility to match the real plan rule.
6. Fix duplicate approve/reject and retry UI flows.
7. Replace interactive lint with non-interactive ESLint CLI and add it to CI.
8. Add tests for:
   - founder-run execution gating
   - night-shift eligibility
   - retry flow
   - dashboard action correctness
   - cron auth
   - auth token verification
