# Goal: Complete The 19-Canary World-Class Engineering Agent Runway

## Mission

Make the Baljia Engineering Agent a world-class, category-neutral full-stack web app builder by completing the full 19-canary runway:

- 7/7 core canaries for 95% core confidence.
- 12/12 extended canaries for broad category-neutral confidence.
- 19/19 total canaries for world-class confidence.

The goal is not to manually fix one generated app. The goal is to improve the Engineering Agent system so it can autonomously build, deploy, verify, and report across many product categories without collapsing into one generic SaaS/dashboard/marketplace shape.

Do not stop until one of these is true:

- 19/19 canaries pass final deterministic verification.
- An unavoidable external blocker prevents completion after all feasible platform/agent fixes have been attempted and documented.

External blockers include missing credentials, provider quota, Render/GitHub/Neon outage, unsupported third-party API credentials, or account limits. Do not treat agent bugs, generated app bugs, verifier bugs, prompt gaps, capability gaps, or UI failures as external blockers.

## Non-Negotiable Rules

- Do not fake success.
- Do not claim 95% or world-class confidence from prompts, unit tests, or one canary.
- Do not manually patch a generated canary app as the final answer unless the patch is also converted into an Engineering Agent/tool/prompt/verifier improvement.
- If a canary fails, classify the failure, patch the system, rerun focused tests, then rerun the failed canary or a smaller reproduction.
- Preserve the existing Engineering Agent spine:
  - CEO task allocation.
  - capability registry and packs.
  - domain registry and domain packs.
  - frontend pattern registry.
  - GitHub/reference pattern retrieval.
  - codebase map and Graphify/code graph support.
  - Render deployment/repair loop.
  - verification gates.
  - design audit and design critique.
  - static scan and code review.
- Do not weaken existing gates to make canaries pass.
- Do not skip `verify_user_journey`, `verify_db_state`, `verify_browser_ui`, `design_audit`, `static_code_scan`, `write_codebase_map`, or `create_report`.
- Do not run canaries in parallel unless there is explicit evidence that shared Render/GitHub/Neon/API quota will not create noisy failures. Default to sequential execution.

## Required Preflight

Before running canaries:

1. Inspect the current worktree.
2. Do not revert unrelated user changes.
3. Confirm no real canary execution is already running.
4. Run TypeScript and focused tests.

Required commands:

```bash
npx tsc --noEmit --pretty false
npx vitest run src/lib/agents/domain-registry.test.ts src/lib/agents/frontend-pattern-registry.test.ts src/lib/agents/anti-generic-gate.test.ts src/lib/agents/capability-registry.test.ts src/lib/agents/reference-pattern-registry.test.ts src/lib/agents/agent-factory.planning-gate.test.ts src/lib/agents/tools/engineering.design-systems.test.ts --testTimeout=30000 --maxWorkers=1
npx vitest run src/scripts/canary-render-engineering.test.ts src/scripts/canary-extended-scenarios.test.ts src/scripts/canary-confidence-report.test.ts src/scripts/canary-render-engineering.dispatcher.test.ts --testTimeout=30000 --maxWorkers=1
```

If preflight fails, fix the system and rerun preflight before any canary.

## Core Canary Runway: 7 Required Canaries

Run each core canary in isolation. Use a single shared run id for the overall runway.

Suggested run id:

```bash
set RUN_ID=world-class-19-YYYYMMDD-HHMM
```

Use the actual current date/time in the run id.

### 1. AI Course Marketplace

Scenario id:

```text
ai-course-marketplace
```

Required proof:

- marketplace
- auth/roles
- uploads or upload-ready storage flow
- payment-ready Stripe flow
- AI summary
- admin approval
- dashboard
- DB write proof
- browser UI proof
- Render live URL

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario ai-course-marketplace --run-id %RUN_ID%
```

### 2. Vendor Compliance Portal

Scenario id:

```text
vendor-compliance-portal
```

Required proof:

- onboarding CRUD
- document upload/upload-ready flow
- admin approval
- notification-ready flow
- dashboard
- exact API payload contract
- browser UI journey
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario vendor-compliance-portal --run-id %RUN_ID%
```

### 3. Booking/Scheduling App

Scenario id:

```text
booking-scheduling-app
```

Required proof:

- availability slots
- booking creation
- double-book prevention
- customer/admin views
- DB state for slots/bookings
- browser UI proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario booking-scheduling-app --run-id %RUN_ID%
```

### 4. SaaS Billing Dashboard

Scenario id:

```text
saas-billing-dashboard
```

Required proof:

- auth/account UI
- pricing UI
- Stripe checkout/payment-link or payment-ready fallback
- billing status persistence
- account/billing dashboard

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario saas-billing-dashboard --run-id %RUN_ID%
```

### 5. AI Document Analyzer

Scenario id:

```text
ai-document-analyzer
```

Required proof:

- upload or document input
- AI extraction/summarization
- stored results
- searchable history or RAG/search
- no fake fallback-only AI success

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario ai-document-analyzer --run-id %RUN_ID%
```

### 6. Adversarial Mixed App

Scenario id:

```text
adversarial-booking-marketplace
```

Required proof:

- AI-powered booking marketplace
- vendor onboarding
- subscriptions/payment-ready flow
- uploads
- admin approval
- analytics dashboard
- at least three vertical slices verified

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario adversarial-booking-marketplace --run-id %RUN_ID%
```

### 7. Existing App Extension Canary

Scenario id:

```text
existing-app-extension
```

Required proof:

- starts from an already deployed baseline app
- reads codebase map
- uses build/query code graph when available
- existing route still works
- adds billing
- adds RAG document search
- adds admin dashboard
- does not replace the existing app with a generic new app

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario existing-app-extension --run-id %RUN_ID%
```

## Extended Canary Runway: 12 Category-Neutral Canaries

These prove the agent is not biased toward marketplace/dashboard apps.

Each extended canary must include:

- `DOMAIN_MATCH_EVIDENCE`
- `DOMAIN_PACK_EVIDENCE` or valid ad-hoc domain evidence where applicable
- `FRONTEND_PLAN_EVIDENCE`
- capability plan evidence
- reference pattern evidence when useful
- architecture plan evidence
- Render live URL
- homepage 200
- app-specific user journey
- DB proof for writes
- browser UI proof
- static scan high=0
- design audit clean
- design critique clean when configured
- codebase map
- final report

### 8. Ecommerce Store

Scenario id:

```text
ecommerce-store
```

Domain:

```text
ecommerce_store
```

Required proof:

- storefront UI
- product catalog
- cart
- checkout/payment-ready order
- order persistence
- admin/order status path

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario ecommerce-store --run-id %RUN_ID%
```

### 9. Business Website + CRM

Scenario id:

```text
business-website-crm
```

Domain:

```text
business_website_crm
```

Required proof:

- public marketing page
- lead capture
- internal/admin CRM
- lead stages/notes
- DB proof for lead and note

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario business-website-crm --run-id %RUN_ID%
```

### 10. Local Service Booking

Scenario id:

```text
local-service-booking
```

Domain:

```text
local_service_booking
```

Required proof:

- service booking UI
- slot picker/calendar pattern
- booking create
- double-book prevention
- admin availability view

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario local-service-booking --run-id %RUN_ID%
```

### 11. Inventory Operations

Scenario id:

```text
inventory-operations
```

Domain:

```text
inventory_operations
```

Required proof:

- inventory table
- item create/update
- stock movement
- low-stock/status dashboard
- DB proof for item and movement

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario inventory-operations --run-id %RUN_ID%
```

### 12. Construction Operations

Scenario id:

```text
construction-operations
```

Domain:

```text
construction_operations
```

Required proof:

- construction ops board
- project/job tracking
- daily logs or safety records
- equipment/workforce/status view
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario construction-operations --run-id %RUN_ID%
```

### 13. Finance/Crypto

Scenario id:

```text
finance-crypto
```

Domain:

```text
finance_crypto
```

Required proof:

- finance dashboard UI
- account/portfolio/watchlist data
- price/status/alert-ready flow
- no fake unsupported external API dependency
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario finance-crypto --run-id %RUN_ID%
```

### 14. Social Community

Scenario id:

```text
social-community
```

Domain:

```text
social_community
```

Required proof:

- community/feed UI
- post/create flow
- comments or reactions
- moderation/admin path
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario social-community --run-id %RUN_ID%
```

### 15. Education Content

Scenario id:

```text
education-content
```

Domain:

```text
education_content
```

Required proof:

- LMS/content UI
- lessons/modules
- student progress or enrollment
- admin/content management
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario education-content --run-id %RUN_ID%
```

### 16. Health/Fitness/Food

Scenario id:

```text
health-fitness-food
```

Domain:

```text
health_fitness_food
```

Required proof:

- health/fitness/meal planning UI
- plan or workout/meal CRUD
- progress/history view
- safe non-medical positioning
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario health-fitness-food --run-id %RUN_ID%
```

### 17. Media/Creator

Scenario id:

```text
media-creator
```

Domain:

```text
media_creator
```

Required proof:

- creator/gallery/portfolio UI
- media item or content CRUD
- upload-ready flow
- public profile/gallery
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario media-creator --run-id %RUN_ID%
```

### 18. Real Estate/Property

Scenario id:

```text
real-estate-property
```

Domain:

```text
real_estate_property
```

Required proof:

- listing/search UI
- property create/list/fetch
- inquiry or saved listing flow
- admin/property management
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario real-estate-property --run-id %RUN_ID%
```

### 19. Advanced AI Mixed

Scenario id:

```text
advanced-ai-mixed
```

Domain:

```text
advanced_ai_mixed
```

Required proof:

- AI workspace UI
- AI generation/extraction/summarization
- stored result
- history/search/RAG-ready flow
- deterministic fallback only when provider credentials are unavailable, and it must be documented
- DB write proof

Command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --scenario advanced-ai-mixed --run-id %RUN_ID%
```

## Pass Criteria For Every Canary

Each canary must:

- complete autonomously
- deploy live on Render
- return 200 on homepage
- pass at least one app-specific `verify_user_journey`
- pass `verify_db_state` for at least one DB-writing flow
- pass required route/file checks
- pass required live HTTP checks
- pass browser UI checks
- show clean Render logs after final deploy
- pass `static_code_scan` with no high findings
- pass code review with high=0 or pass marker
- pass `design_audit`
- pass `design_critique` when configured
- update codebase map
- create final report
- include live URL and verification evidence

## Failure Classification

When a canary fails, classify it as one or more of:

- planning/gate failure
- domain matching gap
- capability pack gap
- frontend pattern gap
- GitHub/reference retrieval gap
- RAG/reference retrieval gap
- generated app API bug
- generated app UI bug
- generated app DB/schema bug
- deployment/tooling issue
- Render configuration issue
- Neon/schema/migration issue
- verifier false positive
- verifier false negative
- browser UI checker gap
- design audit/design critique gap
- static scan/code review issue
- external service blocker

## Failure Loop

For every failed canary:

1. Read the canary JSON report.
2. Read the final task execution logs.
3. Identify the first real failure, not only the final symptom.
4. Decide whether this is an agent/system issue, generated app issue, verifier issue, or external blocker.
5. Patch the Engineering Agent system, tools, gates, registries, prompts, verifier, canary specs, or known-issues memory as needed.
6. Add or update a focused unit test for the failure class.
7. Run TypeScript and focused tests.
8. Rerun the failed canary or a smaller reproduction.
9. Record the failure and fix in known issues/learnings so future canaries retrieve it.
10. Continue the runway.

Do not proceed to the next canary while the current canary has an unresolved agent/system/verifier failure.

## Required Evidence After Each Fix

After any code/tool/prompt/verifier fix:

```bash
npx tsc --noEmit --pretty false
```

Then run the smallest relevant focused test suite. Examples:

```bash
npx vitest run src/lib/agents/agent-factory.planning-gate.test.ts --testTimeout=30000 --maxWorkers=1
npx vitest run src/scripts/canary-render-engineering.test.ts src/scripts/canary-extended-scenarios.test.ts src/scripts/canary-confidence-report.test.ts src/scripts/canary-render-engineering.dispatcher.test.ts --testTimeout=30000 --maxWorkers=1
npx vitest run src/lib/agents/domain-registry.test.ts src/lib/agents/frontend-pattern-registry.test.ts src/lib/agents/anti-generic-gate.test.ts --testTimeout=30000 --maxWorkers=1
```

Then rerun the failed canary.

## Final Confidence Run

After all 19 individual scenarios pass, run the final confidence/report command:

```bash
npx tsx src/scripts/canary-render-engineering.ts --all --confidence-run --run-id %RUN_ID%-final
```

The final report must include:

- all 19 scenario ids
- pass/fail status
- live URLs
- terminal state
- blocker field empty for passed scenarios
- capability matrix
- domain matrix
- verification evidence
- non-blocking risks
- confidence summary

## Confidence Rules

Use these confidence labels:

- `7/7 core`: 95% core confidence.
- `7/7 core + 10/12 extended`: broad full-stack confidence.
- `7/7 core + 12/12 extended`: world-class category-neutral confidence.
- `19/19 total`: world-class Engineering Agent evidence.

Do not claim world-class if fewer than 19/19 pass, unless the only failures are clearly external blockers and every agent/system/verifier issue has been fixed and rerun.

## Final Output Required

When complete, output:

- summary of files changed
- list of system fixes made during the runway
- commands run
- test results
- canary results table
- live URLs for all passed canaries
- failure classes encountered and fixed
- remaining external blockers, if any
- final confidence label
- path to the final confidence report JSON/Markdown

## Final Acceptance Criteria

This goal is complete only when:

- TypeScript passes.
- Focused tests pass.
- All 7 core canaries pass.
- All 12 extended canaries pass.
- Final confidence report is generated.
- No repeated unresolved failure class remains.
- No category bias is observed toward marketplace/dashboard/template apps.
- Every canary has live URL and verification evidence.
- The Engineering Agent, not manual app patching, is responsible for the improvements.
