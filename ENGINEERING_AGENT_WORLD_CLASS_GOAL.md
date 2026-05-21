# Goal: Make Baljia Engineering Agent A World-Class, Category-Neutral Full-Stack App Builder

## Mission

Upgrade the existing Baljia Engineering agent without replacing its current working core.

The agent must become a generic, category-neutral full-stack app builder. It should not drift toward one app family such as SaaS dashboards, marketplaces, vendor portals, booking apps, or AI document tools. The final app must be determined by:

```text
CEO task
company context
domain match
technical capability match
domain packs
capability packs
frontend UI plan
GitHub/reference patterns
existing codebase map / Graphify
vertical slice architecture
real verification evidence
```

The existing template is only the chassis. The app itself comes from the CEO task and planning evidence.

## Confidence Standard

Use this benchmark:

```text
7/7 core canaries passed = 95% core confidence
7/7 core + 10/12 extended passed = broad full-stack confidence
7/7 core + 12/12 extended passed = world-class confidence
```

Do not claim world-class confidence unless all 19 canaries pass with live Render evidence, DB proof, browser UI proof, design proof, static/security proof, and final reports.

## Non-Negotiable Preservation Rules

Do not remove or weaken the existing Engineering agent spine.

Preserve these existing systems:

```text
match_capabilities
get_capability_pack
compose_app_architecture
match_reference_repos
get_reference_repo_patterns
retrieve_component_examples
match_design_system
get_design_system
verify_user_journey
verify_db_state
verify_browser_ui
design_audit
design_critique
Render deploy / repair loop
codebase map / Graphify flow
current 7-canary runner
engineeringPreToolGate
engineeringCompletionGate
```

Compatibility requirements:

```text
Existing tool names remain valid.
Existing evidence markers remain valid.
Existing capability IDs remain valid.
Existing 7 canaries must keep passing.
New tools are additive.
Old execution logs must still parse.
No current deployment or verification gate is weakened.
```

## Implementation Plan

### 1. Add Domain Intelligence

Create a domain registry beside the current capability registry.

Add domain packs for:

```text
ecommerce_store
business_website_crm
local_service_booking
inventory_operations
construction_operations
finance_crypto
social_community
education_content
health_fitness_food
media_creator
real_estate_property
advanced_ai_mixed
```

Each domain pack must define:

```text
id
title
signals
typical actors
typical entities
expected pages
expected API routes
expected DB tables
frontend patterns
backend/API patterns
required capabilities
reference patterns
verification journeys
common failures
anti-generic warnings
```

Add Engineering tools:

```text
list_domain_packs()
match_domain_app({ title, description, company_context, existing_codebase_map? })
get_domain_pack({ id })
```

Add deterministic evidence markers:

```text
DOMAIN_MATCH_EVIDENCE selected=...
DOMAIN_PACK_EVIDENCE id=...
```

Behavior:

```text
Domain matching answers: what kind of product is this?
Capability matching answers: what must it do?
Architecture must use both.
```

### 2. Add Anti-Category-Bias Gates

Add category-neutrality checking to planning evidence.

Block or warn when:

```text
CEO task has clear domain signals
but architecture only selects crud/dashboard/deployment_render
```

Add config:

```text
ENGINEERING_DOMAIN_GATE_MODE=off|warn|hard
```

Default rollout:

```text
Initial default: warn
Canary/test default: hard
World-class final default: hard
```

Gate message:

```text
DOMAIN_GENERIC_FALLBACK_GATE: this task has domain signals but the plan collapsed to generic CRUD/dashboard. Call match_domain_app, get_domain_pack, re-run match_capabilities, load all packs, retrieve domain references, and re-run compose_app_architecture.
```

Rollout order:

```text
Phase A: add domain tools and tests; no production blocking.
Phase B: add warn-mode in architecture output.
Phase C: hard-block in canary/test mode.
Phase D: hard-block production Engineering build/extend tasks after old 7/7 core canaries remain green.
```

### 3. Expand Technical Capability Packs

Keep all existing capability packs.

Add deeper full-stack packs:

```text
cart_orders_checkout
coupons_tax_shipping
payment_lifecycle
stripe_webhooks
teams_workspaces
oauth_password_reset
multi_tenant_isolation
rich_text_cms
import_export_csv
audit_logs
soft_delete_restore
file_privacy_validation
notification_preferences
realtime_collaboration
queue_workers
long_running_ai_jobs
ai_safety_cost_controls
seo_public_pages
security_ops
rollback_backup_ops
```

Each pack must include:

```text
whenNeeded
signals
requiredSkills
requiredFiles
envVars
schemaPatterns
apiPatterns
uiPatterns
verificationRequirements
commonFailures
verticalSlice
```

Update `match_capabilities` to optionally accept domain context:

```text
match_capabilities({
  title,
  description,
  company_context,
  domains?: DomainId[]
})
```

Fallback rule:

```text
No clear domain signals -> crud + deployment_render fallback allowed.
Clear domain signals -> generic fallback blocked.
```

### 4. Make Frontend First-Class

Add a frontend UI pattern registry.

UI pattern IDs:

```text
landing_site
dashboard
marketplace_listing
ecommerce_storefront
booking_calendar
admin_portal
crm_pipeline
inventory_table
ai_workspace
document_portal
social_feed
real_estate_listing
media_creator_gallery
education_lms
health_plan_tracker
construction_ops_board
finance_dashboard
```

Add Engineering tool:

```text
compose_frontend_plan({
  domain_ids,
  capabilities,
  design_system,
  reference_patterns,
  product_context,
  pages,
  actors
})
```

Add evidence marker:

```text
FRONTEND_PLAN_EVIDENCE ui_type=... pages=... required_controls=...
```

Frontend plan must include:

```text
page map
navigation
primary UI flows
shadcn/ui components
lucide-react icons
forms
tables/cards/calendars/charts
loading states
empty states
error states
mobile expectations
accessibility smoke expectations
browser UI required_text
browser UI required_buttons
browser UI form-submission checks
```

Completion must block if:

```text
homepage is only API docs
UI is generic SaaS dashboard for unrelated domain
buttons/forms do not call backend
submitted data does not reappear in UI
mobile viewport is unusable
design_audit has HIGH findings
design_critique has BLOCKER findings
verify_browser_ui is missing or stale
```

### 5. Expand GitHub / Reference Pattern Retrieval

Extend the reference registry with domain-specific pattern groups:

```text
ecommerce cart/orders
business website + lead CRM
inventory/warehouse
construction project operations
social/community/forum
real estate listings
health/fitness/meal planning
education/LMS/content
media/creator portfolios
finance dashboards
CMS/blog/wiki editing
advanced AI/RAG workflows
```

Update `match_reference_repos` input:

```text
match_reference_repos({
  capabilities,
  domains?: DomainId[],
  design_system?,
  task_context?,
  company_context?
})
```

Rules:

```text
References are patterns only.
Do not copy whole apps.
Respect licenses.
References must influence architecture or frontend plan.
```

Completion gate must continue requiring these for user-facing or architecture-heavy apps:

```text
REFERENCE_MATCH_EVIDENCE
REFERENCE_PATTERN_EVIDENCE
COMPONENT_EXAMPLE_EVIDENCE
```

### 6. Strengthen API, Backend, And Data Planning

Extend `compose_app_architecture` output to include:

```text
domains
capabilities
actors
entities
pages
api_contracts
db_tables
vertical_slices
frontend_plan_summary
verification_journeys
db_state_checks
browser_ui_checks
```

Each API contract must include:

```text
method
path
purpose
request body shape
response body shape
expected status codes
auth/role requirement
DB write/read expectation
failure cases
```

Backend rules:

```text
Every write flow must have server-side validation.
Every DB-writing canary must include verify_db_state.
Payment flows must persist payment-ready or Stripe state.
Upload flows must persist file metadata even when storage credentials are absent.
External integrations must have credential-missing behavior.
RAG/AI flows must persist useful output when user-visible.
```

### 7. Extend Canary Scenario System

Keep the current 7 core canaries.

Add 12 extended canaries:

```text
1. ecommerce-store
2. business-website-crm
3. local-service-booking
4. inventory-operations
5. construction-operations
6. finance-crypto-dashboard
7. social-community
8. education-content-platform
9. health-fitness-meal-planner
10. media-creator-platform
11. real-estate-property
12. advanced-mixed-ai-workflow
```

Each scenario must define:

```text
id
title
originalIdea
domains
capabilities
requiredRoutes
requiredTables
surfaceRequirements
apiContracts/liveChecks
browserUiChecks
dbChecks
requiredEvidence
expectedFailureClasses
```

Add CLI support:

```text
--scenario <id>
--core
--extended
--all
--confidence-run
```

Reports must be stored under:

```text
measurement-output/engineering-world-class/<run-id>/
```

Final confidence report must include:

```text
core pass count
extended pass count
live URLs
capability matrix
domain matrix
verification evidence
failure classes
known unresolved gaps
confidence label
```

## Core Canary Requirements

Core canaries:

```text
ai-course-marketplace
vendor-compliance-portal
booking-scheduling-app
saas-billing-dashboard
ai-document-analyzer
adversarial-booking-marketplace
existing-app-extension
```

Each must pass:

```text
task completed autonomously
Render live deploy
homepage 200
clean Render logs
app-specific verify_user_journey
verify_db_state for at least one write
verify_browser_ui
static_code_scan high=0
review_pushed_code no high findings
design_audit clean
design_critique 0 blockers
codebase map updated
final report created
```

## Extended Canary Requirements

### 1. Ecommerce Store

Must verify:

```text
product browse
product detail
cart add
coupon/payment-ready checkout
order persistence
order history or status fetch
```

### 2. Business Website + CRM

Must verify:

```text
public marketing page
lead form submission
admin CRM table
notification-ready record
DB proof for captured lead
```

### 3. Local Service Booking

Must verify:

```text
availability creation
booking creation
double-book rejection
customer/admin views
DB has only one booking for same slot
```

### 4. Inventory Operations

Must verify:

```text
item create
stock movement
low-stock state
CSV import/export or export-ready flow
audit row
```

### 5. Construction Operations

Must verify:

```text
project create
bid or estimate record
schedule entry
safety log
equipment tracking
dashboard proof
```

### 6. Finance / Crypto Dashboard

Must verify:

```text
portfolio record
price alert
transaction history
external API fallback
security-safe UI boundaries
```

### 7. Social / Community

Must verify:

```text
profile
post
comment
moderation
notification or notification-ready record
search or feed retrieval
```

### 8. Education / Content Platform

Must verify:

```text
course creation
lesson creation
progress tracking
rich content or publish-ready editing
admin publish flow
```

### 9. Health / Fitness / Meal Planner

Must verify:

```text
plan creation
recipe or workout schedule
progress tracking
preferences/goals
user dashboard
```

### 10. Media / Creator Platform

Must verify:

```text
media upload metadata
gallery/portfolio
gated or payment-ready content
creator/admin management
```

### 11. Real Estate / Property

Must verify:

```text
listing create
filters/search
inquiry
saved property
admin approval
```

### 12. Advanced Mixed AI Workflow

Must verify:

```text
uploads
AI/RAG result
stored output
background job or job-ready state
dashboard
external API fallback
```

## Test Plan

Run before canaries:

```bash
npx tsc --noEmit --pretty false
npx vitest run src/lib/agents/capability-registry.test.ts
npx vitest run src/lib/agents/reference-pattern-registry.test.ts
npx vitest run src/lib/agents/agent-factory.planning-gate.test.ts
npx vitest run src/lib/agents/tools/engineering.design-systems.test.ts
npx vitest run src/scripts/canary-render-engineering.test.ts
```

Add tests for:

```text
domain registry contains all 12 domains
match_domain_app detects each domain
get_domain_pack returns implementation and verification guidance
mixed prompts select multiple domains/capabilities
clear domain task cannot collapse to crud/dashboard/deployment only
old capability-only evidence still parses
old 7 canary scenario definitions still pass
reference matching uses domains + capabilities
frontend plan selects domain-specific UI surfaces
compose_app_architecture includes domain, API contracts, DB tables, UI checks
pre-code gate blocks generic fallback in hard mode
pre-code gate only warns in warn mode
completion gate requires frontend/browser evidence for user-facing apps
canary matrix covers 7 core + 12 extended
confidence report labels 7/7, 7+10/12, and 7+12/12 correctly
```

Add category-neutrality tests:

```text
same stack + different CEO tasks produce different domains
different domains produce different schemas
different domains produce different UI surfaces
different domains produce different verification journeys
unrelated domains do not all select shadcn-dashboard-patterns
unknown mixed app composes multiple domains instead of defaulting to CRUD
```

## Failure Loop

Failure classes:

```text
domain matching gap
capability pack gap
reference/RAG gap
frontend pattern gap
API contract mismatch
generated app bug
deployment/tooling issue
verification false positive
verification false negative
external service blocker
```

After every failed canary:

```text
classify failure
patch system
rerun focused tests
rerun failed canary or smaller reproduction
record failure/fix in known issues/learnings
continue only after regression is clean
```

## Confidence Rules

```text
<7/7 core:
not 95%; report exact blockers.

7/7 core:
95% core confidence only.

7/7 core + 10/12 extended:
broad full-stack confidence; list remaining failed domains.

7/7 core + 12/12 extended:
world-class confidence.
```

Never claim world-class confidence from:

```text
prompts only
unit tests only
one canary
mock-only evidence
homepage-only checks
```

## Required Implementation Order

1. Add domain registry, domain types, and domain tools.
2. Add domain evidence parsing to planning evidence.
3. Add warn-mode anti-generic fallback detection.
4. Add frontend UI pattern registry and `compose_frontend_plan`.
5. Extend capability packs without removing existing IDs.
6. Extend reference registry with domain patterns.
7. Extend architecture output with domains, API contracts, frontend summary, and verification checks.
8. Add canary/test hard-mode for anti-generic gate.
9. Add extended 12 scenario definitions.
10. Add confidence report generation.
11. Run TypeScript and focused tests.
12. Rerun existing 7 core canaries.
13. Run 12 extended canaries.
14. Patch failures and rerun until criteria are met.
15. Switch `ENGINEERING_DOMAIN_GATE_MODE` default from `warn` to `hard` only after 7/7 core remains green.

## Final Acceptance Criteria

This goal is complete only when:

```text
TypeScript passes
focused tests pass
domain registry exists and is used
frontend UI pattern registry exists and is used
anti-generic fallback gate works
existing 7 core canaries still pass
12 extended canaries are implemented
confidence report generator works
canary reports include live URLs and verification evidence
known issues/learnings are updated after failures
no existing Engineering tools or evidence markers are broken
```

World-class status is achieved only when:

```text
7/7 core canaries pass
12/12 extended canaries pass
no repeated unresolved failure class remains
final matrix includes live URLs, logs, DB proof, UI proof, static scan, design evidence, and reports
```

## Assumptions

```text
Existing Engineering agent behavior is valuable and must be preserved.
Current 7 canaries remain the core confidence runway.
New domain/frontend tools are additive, not replacements.
Render, Neon, GitHub, Stripe, OpenAI/RAG, and Graphify remain the platform foundation.
Missing third-party credentials should produce explicit fallback/payment-ready/integration-ready behavior unless a scenario requires real credentials.
The goal is not to make one bigger template. The goal is domain-aware, capability-composed, verified full-stack generation.
```
