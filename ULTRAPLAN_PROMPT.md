Fix P0 and P1 findings from adversarial review + existing audits (docs/AUDIT_REPORT.md, docs/SPEC_AUDIT_REPORT.md). Specs are in specs/internal/. CLAUDE.md has full architecture context.

## Phase 1: Atomic credit/task/slot lifecycle (P0 — money + concurrency)

The core problem: credit deduction, task claiming, slot enforcement, and event emission are all separate operations that can independently fail. Need ONE atomic "claim-and-charge" primitive.

Specific fixes needed:
1. credit.service.ts: Daily spend cap check is outside the CTE insert — make atomic (Lua script or single SQL transaction)
2. task.service.ts: startTask() only updates task state, doesn't deduct credits — tie them transactionally
3. task.service.ts: One-slot check is per-task not per-company — add company-scoped WHERE for in_progress tasks
4. night-shift.service.ts: Slot check is TOCTOU — use Postgres advisory lock
5. credit.service.ts: getBalance() sums all time — scope to current billing period
6. credit.service.ts: addCredit() has no idempotency key — add Stripe event ID / period key
7. credit.service.ts: refundCredit() race condition — add duplicate check inside transaction
8. task.service.ts: queue_order race on concurrent createTask — use DB sequence or SELECT FOR UPDATE

## Phase 2: Security (P0)

1. middleware.ts: Cron routes exempted from all auth — require x-cron-key validation AT middleware level, not per-route
2. rate-limiter.ts: INCR/EX race — replace with Lua script (INCR + EXPIRE atomic)
3. auth.ts: 30-day non-revocable JWT — add session table + token revocation check on each request
4. auth.service.ts: Magic-link tokens stored unhashed — hash before storage, compare hashes
5. schema.ts: neon_connection_string plaintext — encrypt at rest or use secret manager indirection
6. browser.tools.ts: browser_evaluate passes raw JS — add allowlist or sandboxing
7. browser.tools.ts: Math.random() for passwords — use crypto.getRandomValues()

## Phase 3: Failure taxonomy unification (P1 — 3 incompatible sets)

Three files define completely different failure class enums:
- failure.service.ts: timeout, tool_failure, external, scope, routing
- remediation.service.ts: worker_failure, external_dependency, platform_scoping, founder_ambiguity, missing_prerequisite
- types/index.ts: same as remediation

Fix: Create ONE canonical enum matching spec's 8 classes (infra_error, capability_miss, external_block, verification_reject, timeout, scope_overflow, policy_violation, connector_failure). Import everywhere. Update classifier and remediation strategy mapping.

## Phase 4: Information leakage to founders (P1 — 7 locations)

1. types/index.ts:648-654 — strip execution_mode and verification_level from TaskProposal before sending to client
2. ceo.tool-defs.ts + ceo.tool-handlers.ts — remove list_available_agents or filter internal fields
3. TaskDetailDialog.tsx:219 — translate failure_class to founder-safe language
4. TaskDetailDialog.tsx:208 — translate task.source to founder-safe language
5. TaskCard.tsx:83 — hide turn count/max turns from founders
6. TaskCard.tsx:9-13 — rename agent labels to business terms (ColdOutreach -> Sales Outreach, MetaAds -> Ad Management)
7. onboarding/page.tsx — use stage labels not internal stage names

## Phase 5: Verification + remediation alignment (P1)

1. verification.service.ts:326 — emit task_failed not task_completed when verification fails
2. verification.service.ts:172 — browser_flow verification needs real browser check, not HEAD request
3. governance.service.ts:405 — add hybrid verification level to classifier
4. remediation.service.ts — add persistent attempt counter, enforce max 100 per scope (spec: SPEC-CTRL-106)
5. remediation.service.ts — check credits before creating retry tasks
6. remediation.service.ts — implement as new Run on original Task, not new Task (per SPEC_AUDIT_REPORT finding #16)

## Phase 6: Missing schema + spec alignment (P1-P2)

1. Add runtime_ai_costs table (Lane 4 billing)
2. Add known_issue_registry table (SPEC-OPS-001)
3. Add CHECK constraints on memory.max_tokens
4. TaskBoard.tsx — add Recurring and Rejected tabs per spec
5. Onboarding idempotency guard (prevent double-pipeline)
6. Watchdog: add active health check (not just callback-driven)
7. Loop detection: detect alternating tool patterns, not just consecutive same-tool

## Constraints
- Do NOT change specs — they are correct, code needs to match them
- Existing audit fix order (docs/AUDIT_REPORT.md) is still valid — this plan extends it
- One atomic claimAndCharge() is the highest leverage fix — everything else depends on billing being correct
- Test each phase before moving to next
