# Goal: Complete The 13 Remaining World-Class Engineering Agent Canaries

## Mission

Run and complete the 13 remaining Baljia Engineering Agent canaries so the agent can prove category-neutral, world-class full-stack app building beyond the already-covered canaries.

Already covered app families are treated as done unless local evidence proves otherwise:

- AI course marketplace
- vendor compliance portal
- SaaS billing dashboard
- booking/scheduling app
- AI document analyzer
- existing app extension

Remaining canaries to complete:

1. `adversarial-booking-marketplace`
2. `ecommerce-store`
3. `business-website-crm`
4. `local-service-booking`
5. `inventory-operations`
6. `construction-operations`
7. `finance-crypto-dashboard`
8. `social-community`
9. `education-content-platform`
10. `health-fitness-meal-planner`
11. `media-creator-platform`
12. `real-estate-property`
13. `advanced-mixed-ai-workflow`

Do not stop until all 13 are complete, or until an unavoidable external blocker prevents progress after all reasonable system repairs have been attempted and documented.

## Core Principle

The goal is not to manually fix 13 generated apps.

The goal is to observe how the Engineering Agent performs, identify where the agent/build process/verifier/gates/prompts/tools fail, patch the generic system, then make the Engineering Agent repair or rerun the canary until the official deterministic canary report passes.

## Non-Negotiable Rules

- Do not fake success.
- Do not claim world-class confidence unless all 13 remaining canaries pass.
- Do not manually patch generated canary repos as the primary solution.
- If a generated app has a product bug but the Engineering Agent produced enough orchestration evidence, create a CEO-style Engineering repair task for that same app and same Render service.
- If a generated app failed because the Engineering Agent skipped planning, skipped verification, used wrong tools, got generic, or failed orchestration, patch the Engineering Agent system and rerun the canary or a focused reproduction.
- If the canary/verifier is wrong, patch the canary/verifier and rerun focused tests before replaying.
- Preserve existing app/company/repo/service during repair tasks.
- Do not weaken gates just to pass.
- Keep `.onrender.com` URLs canonical unless custom domains are already working.
- Record every failure class and fix in known issues/learnings.
- Do not run canaries in parallel by default. Use sequential execution unless the system is explicitly stable and quotas are verified.

## Preflight

Before running any canary:

1. Inspect worktree status.
2. Do not revert unrelated user changes.
3. Confirm no Engineering/canary task is already running.
4. Confirm `.env.local` is available.
5. Confirm Anthropic OAuth/provider routing is working.
6. Confirm Render account/quota is usable with a tiny health check if there is any doubt.

Run:

```bash
npx tsc --noEmit --pretty false
npx vitest run src/lib/agents/domain-registry.test.ts src/lib/agents/frontend-pattern-registry.test.ts src/lib/agents/anti-generic-gate.test.ts src/lib/agents/capability-registry.test.ts src/lib/agents/reference-pattern-registry.test.ts src/lib/agents/agent-factory.planning-gate.test.ts src/lib/services/verification.service.test.ts src/scripts/canary-render-engineering.test.ts src/scripts/canary-extended-scenarios.test.ts src/scripts/canary-confidence-report.test.ts --testTimeout=30000 --maxWorkers=1
```

If preflight fails, fix the system first and rerun the same tests.

## Run ID

Create one runway id:

```bash
$RUN_ID = "remaining-13-world-class-<YYYYMMDD-HHMM>"
```

Use the actual timestamp.

Reports should land under the existing measurement output folders, usually:

```text
measurement-output/engineering-95/<run-id>/
measurement-output/engineering-world-class/<run-id>/
```

## Execution Command

Run each scenario individually:

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario <scenario-id> --run-id "<run-id>-<scenario-id>"
```

Do not use a huge `--all` run if it makes failure diagnosis noisy. Sequential single-scenario runs are preferred.

## Required Scenarios

### 1. Adversarial Booking Marketplace

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario adversarial-booking-marketplace --run-id "$RUN_ID-adversarial-booking-marketplace"
```

Must prove:

- AI-powered booking marketplace
- vendor onboarding
- listings
- availability
- booking
- payment/subscription-ready flow
- uploads if required by scenario
- admin approval or moderation
- analytics/dashboard
- DB writes for at least three vertical slices

### 2. Ecommerce Store

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario ecommerce-store --run-id "$RUN_ID-ecommerce-store"
```

Must prove:

- products
- cart
- checkout/order-ready flow
- order persistence
- inventory/order DB proof
- storefront UI

### 3. Business Website + CRM

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario business-website-crm --run-id "$RUN_ID-business-website-crm"
```

Must prove:

- public business website
- lead/contact capture
- internal CRM/dashboard
- lead status persistence
- visible business-specific UI, not generic SaaS copy

### 4. Local Service Booking

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario local-service-booking --run-id "$RUN_ID-local-service-booking"
```

Must prove:

- services
- availability slots
- booking creation
- double-book prevention
- customer/admin views
- DB proof

### 5. Inventory Operations

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario inventory-operations --run-id "$RUN_ID-inventory-operations"
```

Must prove:

- inventory items
- stock movement
- stock control dashboard
- movement DB proof
- operational UI, not marketing UI

### 6. Construction Operations

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario construction-operations --run-id "$RUN_ID-construction-operations"
```

Must prove:

- construction project records
- scheduling/daily operations
- equipment or safety/project management flow
- DB proof
- construction-specific UI

### 7. Finance / Crypto Dashboard

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario finance-crypto-dashboard --run-id "$RUN_ID-finance-crypto-dashboard"
```

Must prove:

- portfolio
- transaction persistence
- alert persistence
- dashboard/chart/table UI
- safe financial disclaimers where appropriate
- no real trading or unsupported wallet claims

### 8. Social Community

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario social-community --run-id "$RUN_ID-social-community"
```

Must prove:

- user/community posting
- comments or interactions
- moderation/report flow
- DB proof
- community UI, not generic admin-only UI

### 9. Education Content Platform

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario education-content-platform --run-id "$RUN_ID-education-content-platform"
```

Must prove:

- course creation
- lesson creation
- enrollment
- progress tracking
- dashboard/student or instructor UI
- DB proof

### 10. Health / Fitness / Meal Planner

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario health-fitness-meal-planner --run-id "$RUN_ID-health-fitness-meal-planner"
```

Must prove:

- plan creation
- workout log
- meal log
- progress/dashboard UI
- DB proof
- no medical diagnosis claims

### 11. Media / Creator Platform

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario media-creator-platform --run-id "$RUN_ID-media-creator-platform"
```

Must prove:

- creator profile or channel
- media record/upload-ready flow
- gated or visibility-aware content
- DB proof
- media/creator-specific UI

### 12. Real Estate Property

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario real-estate-property --run-id "$RUN_ID-real-estate-property"
```

Must prove:

- property listings
- inquiry flow
- saved listing flow
- search/filter/listing UI
- DB proof
- real-estate-specific UI

### 13. Advanced Mixed AI Workflow

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario advanced-mixed-ai-workflow --run-id "$RUN_ID-advanced-mixed-ai-workflow"
```

Must prove:

- upload/input
- AI job or run
- persisted AI result
- status/history/search or dashboard
- deterministic fallback if external AI quota is unavailable
- DB proof

## Required Pass Criteria For Every Canary

Each scenario must end with:

```text
ok: true
terminalState: PASS
productReady: true
missingCriticalTools: []
```

Each canary must also prove:

- live Render URL works
- homepage returns 200
- required API live checks pass
- required files/routes exist
- required DB tables have rows where scenario requires rows
- at least one `verify_user_journey` passes
- `verify_db_state` or runner-side DB table checks prove writes
- `verify_browser_ui` passes
- `verify_interaction_contract` passes when frontend plan declares interactions
- `static_code_scan` has high=0
- `review_pushed_code` clean if it runs
- Render logs clean after final deploy
- `design_audit` clean
- `design_critique` clean when configured
- `write_codebase_map` after final app-changing commit
- `create_report` after final verification evidence
- report includes live URL, repo, Render service id, capabilities, verification evidence, and remaining non-blocking advisories

## Failure Loop

When a canary fails:

1. Read the report JSON.
2. Classify the failure:
   - product/app bug
   - API contract mismatch
   - DB/schema/persistence failure
   - UI/browser issue
   - interaction/button/form issue
   - design/static scan/code review issue
   - Engineering planning/gate failure
   - reference/RAG/domain/frontend planning gap
   - verifier/canary mismatch
   - Render/GitHub/Neon/tooling issue
   - LLM provider/quota/network issue
   - external blocker
3. Choose the recovery path:
   - If product/app bug with valid orchestration evidence: create a CEO-style Engineering repair task for the same company/repo/service, then replay the original canary.
   - If verifier/canary mismatch: patch the verifier/scenario, run focused tests, then replay.
   - If Engineering Agent behavior gap: patch prompt/tools/gates/registry, run focused tests, then rerun the failed canary or smaller reproduction.
   - If missing first-run critical orchestration evidence: patch system and run a fresh full canary again.
   - If external blocker: document exact service, endpoint/tool, error, and next required external action.
4. After every system patch, run relevant focused tests.
5. After every generated-app repair, replay the original canary.

## CEO-Style Repair Task Template

Use this shape when a generated app is close enough to repair:

```text
CEO repair task: Fix the <scenario-id> canary app.

Use the existing company repo and Render service. Do not create a new app.

The original canary failed because:
<exact report failure>

Required fixes:
<API/UI/DB/deploy/design/static-scan gaps>

Preserve:
- existing working routes
- existing schema/tables
- existing Render service
- existing verified behavior

After fixing:
- commit to the same repo
- deploy to the same Render service
- check Render deploy status and logs
- run health check
- run verify_user_journey for the scenario-specific flow
- run verify_db_state for required DB writes
- run verify_browser_ui
- run verify_interaction_contract when relevant
- run static_code_scan and review_pushed_code
- run design_audit and design_critique
- write_codebase_map
- create final report
- complete only after all gates pass
```

Then replay:

```bash
npx tsx --env-file=.env.local src/scripts/canary-render-engineering.ts --scenario <scenario-id> --replay-task <original-task-id> --run-id "$RUN_ID-<scenario-id>-after-repair-replay"
```

## Tracking Table

Maintain a table in your final progress notes:

| # | Scenario | Fresh Task ID | Repair Task IDs | Live URL | Report Path | Status | Failure Class / Fix |
|---|---|---|---|---|---|---|---|
| 1 | adversarial-booking-marketplace | | | | | pending | |
| 2 | ecommerce-store | | | | | pending | |
| 3 | business-website-crm | | | | | pending | |
| 4 | local-service-booking | | | | | pending | |
| 5 | inventory-operations | | | | | pending | |
| 6 | construction-operations | | | | | pending | |
| 7 | finance-crypto-dashboard | | | | | pending | |
| 8 | social-community | | | | | pending | |
| 9 | education-content-platform | | | | | pending | |
| 10 | health-fitness-meal-planner | | | | | pending | |
| 11 | media-creator-platform | | | | | pending | |
| 12 | real-estate-property | | | | | pending | |
| 13 | advanced-mixed-ai-workflow | | | | | pending | |

## Final Acceptance

This goal is complete only when:

- 13/13 remaining canaries have final `PASS` reports.
- Every report has live URL and verification evidence.
- No unresolved repeated failure class remains.
- TypeScript passes after system patches.
- Focused tests pass after system patches.
- Known issues/learnings include all significant failures and fixes.
- Final summary explains:
  - which 13 scenarios passed
  - live URLs
  - report paths
  - generic Engineering Agent fixes made
  - remaining non-blocking risks
  - approximate LLM cost from `task_executions.token_usage` where available

## External Blocker Rule

If blocked by Render quota, GitHub outage, Neon outage, Anthropic/provider quota, missing credentials, or unavailable third-party API:

- do not fake success
- write the exact blocker
- include failing command/tool
- include task id and report path if any
- include what was implemented versus what remains
- include the next concrete action needed

Only stop for an external blocker after confirming it is not an agent bug, verifier bug, generated app bug, or recoverable platform-code issue.
