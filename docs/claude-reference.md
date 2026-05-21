# CLAUDE.md Reference Material

Reference tables extracted from `CLAUDE.md` to keep the active guide under the harness size limit. Read `CLAUDE.md` first; come here when you need historical context (which spec covers what) or a current spec-vs-code map.

## Architecture Reference (archived — NOT actively followed)

The internal specs were the original architecture plan. We are **not** actively following them as source of truth anymore — the code has diverged in places, and many specs describe future state rather than current behavior. Treat them as historical reference only.

When making architecture decisions, **read the actual code first.** If you need historical context, the specs are still on disk:

**Archived location:** `excluded/specs/internal/` (moved out of the active tree to keep focus on shipping code)

### Core specs (8)

| Spec ID | File | Subsystem |
|---------|------|-----------|
| SPEC-CTRL-001 | `control-plane-runtime-and-task-agents.md` | Control plane umbrella — runtime vocabulary, execution chain, cross-child invariants |
| SPEC-BILL-001 | `billing-credits-and-subscription-state.md` | Billing umbrella — 4-lane model, credit lifecycle, subscription state |
| SPEC-ONB-001 | `onboarding-bootstrap.md` | Onboarding — 19-step pipeline, 3 journeys, enrichment tiers |
| SPEC-DASH-001 | `founder-dashboard-and-taskboard.md` | Dashboard — task board, metrics, document surfaces |
| SPEC-ROAD-001 | `roadmap-and-documents.md` | Roadmap — company documents, milestones, document suggestions |
| SPEC-LIVE-001 | `live-wall-and-projections.md` | Live wall — public operations projection |
| SPEC-CEO-001 | `ceo-chat-and-founder-conversation.md` | CEO/chat — 10-step decision flow, credit quoting, rate limiting |
| SPEC-OPS-001 | `platform-ops-and-self-healing.md` | Platform ops — 9 hidden agents, self-healing loop |

### Control-plane children (6)

| Spec ID | File | Owns |
|---------|------|------|
| SPEC-CTRL-101 | `control-plane/control-plane-overview.md` | Orchestration chain, execution_mode selection |
| SPEC-CTRL-102 | `control-plane/runtime-entities-and-task-lifecycle.md` | Task, Run, Session, Repair entities and state machines |
| SPEC-CTRL-103 | `control-plane/scheduler-queue-night-shift-and-recurring.md` | Queue ordering, night shift orchestration, recurring materialization |
| SPEC-CTRL-104 | `control-plane/lane-and-agent-responsibility-model.md` | 8 worker lanes, working_pattern_id, tool mount resolution |
| SPEC-CTRL-105 | `control-plane/memory-context-tools-and-connectors.md` | 3-layer memory, ContextPacket, PermissionSnapshot, learnings |
| SPEC-CTRL-106 | `control-plane/verification-remediation-and-actual-cost-accounting.md` | 5 verification levels, remediation loop, actual cost tracking |

### Billing children (5)

| Spec ID | File | Owns |
|---------|------|------|
| SPEC-BILL-101 | `billing/trial-and-execution-unlock.md` | Trial flow, execution unlock conditions |
| SPEC-BILL-102 | `billing/purchase-surfaces-and-expansion.md` | Upgrade prompts, credit purchase UX |
| SPEC-BILL-103 | `billing/credits-and-task-charging.md` | 1 credit = 1 task, deduction timing, refund rules |
| SPEC-BILL-104 | `billing/subscription-continuity-and-hosting-state.md` | Subscription lifecycle, hosting state machine |
| SPEC-BILL-105 | `billing/internal-ledgers-and-unit-economics.md` | Revenue ledger, ad spend ledger, cost accounting |

### Supporting files

- `claude_spec_workflow.md` — 24-step process for creating/auditing specs
- `decide-later.md` — deferred decisions (stop-loss thresholds, ad billing, credit expiration, etc.)
- `confuse.md` — common misunderstandings for new readers
- `spec-fix-order.md` — audit fix priority guide

### Supplementary docs (in this repo)

- `/docs/Baljia_Knowledge_Graph_v2.md` — 13-domain structured knowledge graph
- `/docs/Baljia_Technical_Architecture_Spec_v2.md` — engineering blueprint

## Current Build Status (spec vs code)

The codebase has substantial implementation across all major areas. This section maps spec requirements to what exists and what still needs work.

### Infrastructure — BUILT

| Area | Status | Key files |
|------|--------|-----------|
| Database schema | 37 tables via Drizzle ORM | `src/lib/db/schema.ts` (679 LOC) |
| DB client | Neon HTTP + Drizzle | `src/lib/db/client.ts`, `drizzle.config.ts` |
| Auth | Custom JWT + magic link + Google OAuth | `src/lib/auth.ts`, `src/lib/services/auth.service.ts` |
| Middleware | CORS whitelist, route protection, session check | `src/middleware.ts` |
| Rate limiting | Redis-backed (Upstash) + in-memory fallback | `src/lib/rate-limiter.ts` |
| LLM safety | Timeout (60s), retry (backoff), circuit breaker | `src/lib/llm-safety.ts` |
| Content safety | Prompt injection defense, output moderation | `src/lib/content-safety.ts` |
| LLM provider | Anthropic primary, Gemini fallback | `src/lib/llm-provider.ts` |
| Validation | Zod schemas for all API inputs | `src/lib/validations/index.ts` |
| Deployment | Cloudflare Worker primary (`wrangler.toml`); Render legacy fallback with cron jobs (`render.yaml`) | See ADR-002 |
| Monitoring | Sentry integration | `src/instrumentation.ts` |

### Agent System — BUILT

| Area | Status | Key files |
|------|--------|-----------|
| Agent factory | Prompt assembly, LLM routing, tool loops | `src/lib/agents/agent-factory.ts` |
| CEO agent | Streaming chat, tool use, personality | `src/lib/agents/ceo/ceo.agent.ts`, `ceo.prompt.ts`, `ceo.tool-defs.ts`, `ceo.tool-handlers.ts` |
| Worker launcher | Task routing, credit deduction, double-execution prevention | `src/lib/agents/worker-launcher.ts` |
| Watchdog | Turn limit, 4hr max, idle detection, loop detection | `src/lib/agents/watchdog.ts` |
| Tool files (8) | Research, Engineering, Browser, Data, Support, Twitter, MetaAds, Outreach | `src/lib/agents/tools/*.tools.ts` |

### Services — BUILT (37 service files)

| Service | Status | Spec alignment |
|---------|--------|---------------|
| `governance.service.ts` | Built (660 LOC) | Evaluates execution_mode + verification_level |
| `credit.service.ts` | Built | Per-plan daily spend caps, ledger operations |
| `verification.service.ts` | Built | 5 verification levels implemented |
| `task.service.ts` | Built | CRUD, queue ordering, status transitions |
| `memory.service.ts` | Built (382 LOC) | Learning extraction, memory layer management |
| `failure.service.ts` | Built (173 LOC) | FNV-1a fingerprinting, 8-class taxonomy |
| `event.service.ts` | Built (136 LOC) | Writes to `platform_events` table (durable) + best-effort publish to Redis pub/sub channel `events:<companyId>` (no current consumer — dashboard uses 30s poll + on-action hook instead) |
| `onboarding.service.ts` | Built | 20-stage async pipeline |
| `chat.service.ts` | Built | Session management, safe JSONB parsing |
| `router.service.ts` | Built | 80+ tags mapped to 8 agent IDs |
| `night-shift.service.ts` | Built | Context-driven planner (no stage buckets), queue processing |
| `billing.service.ts` | Built | Stripe integration, subscription management |
| `approval.service.ts` | Built | Governance checks before task launch |
| `remediation.service.ts` | Built | Auto-remediation on task failure |
| `neon.service.ts` | Built | Neon DB provisioning + branching |

**Removed 2026-05-02:** `stage.service.ts` and the `company_stage` column. Night-shift planner is now context-driven (judgment from real signals), not stage-keyed.

Plus 20+ more services (company, document, email, domain, storage, roadmap, recurring, guardrail, cycle-planning, live-stream, etc.)

### API Routes — BUILT (40 routes across 20 groups)

Auth (4), Tasks (6), Chat (1), Documents + Suggestions (6), Credits/Billing (4), Webhooks (2), Events (2), Cron (4), Worker (3), Onboarding (2), Ops (2), Companies (2), Users (1), Roadmap (1), Health (1)

### Frontend — BUILT

Dashboard (22 components), Chat (5 components), UI primitives (9 components), Mascot, LiveWall, Onboarding

### What Needs Spec-to-Code Alignment

These areas have code but may not fully match the depth of the finalized specs:

| Gap | Spec says | Code status | Work needed |
|-----|-----------|-------------|-------------|
| **CEO 10-step decision flow** | Explicit 10-step classify → check → quote → route flow (SPEC-CEO-001) | CEO prompt has rules but flow is implicit in LLM behavior | May need structured code path, not just prompt instructions |
| **Credit quoting via governance** | CEO asks hidden governance for 5-field quote object | Governance service exists but verify it returns the exact 5-field format | Align governance.service.ts output to spec contract |
| **Execution mode dispatch** | 3 modes (deterministic/template/full_agent) selected before dispatch | Governance classifies but verify worker-launcher actually dispatches differently per mode | Wire execution_mode into worker-launcher branching |
| **ContextPacket assembly** | Bounded context with memory layers + prior reports + failure fingerprints | Agent factory injects some context but verify it matches ContextPacket spec shape | Formalize ContextPacket construction |
| **PermissionSnapshot** | Run-level permission envelope locked at dispatch | Not visible as explicit concept in code | Implement as spec describes |
| **Memory token budgets** | Layer 1: 15K, Layer 2: 3K, Layer 3: 15K tokens | Memory service exists but verify token budget enforcement | Add token counting and eviction |
| **Memory autosave** | Layer 2 autosaves every ~20 messages | Not confirmed in chat flow | Wire counter-based autosave into CEO chat |
| **Cross-company memory** | Layer 3: anonymized, quality-gated, platform-only writes | Table exists but sharing logic likely not implemented | Build cross-company aggregation pipeline |
| **Learnings CRUD** | Full create/search/read/update/delete separate from memory layers | Table exists, memory.service.ts has extraction | Verify full CRUD API matches spec |
| **Platform ops 9 agents** | 9 hidden backend agents (SPEC-OPS-001) | Basic watchdog + failure fingerprinting exist | Most platform ops agents not yet implemented as distinct processes |
| **Self-healing loop** | 5-phase: detect → cluster → fix → verify → prevent | Failure fingerprinting exists, regression guard does not | Build clustering, known-issue registry, regression guard |
| **Known-issue registry** | Stores failure families, exposes to CEO before similar tasks | failure_fingerprints table exists but no registry logic | Implement registry service + CEO integration |
| **Regression guard** | Watches for recurrence of fixed issues | Not implemented | Build as spec describes |
| **Rate limiting escalation** | 6-step: observe → soft-limit → degrade → cooldown → flag → suspend | Rate limiter does basic throttling | Add escalation ladder logic |
| **One-slot concurrency** | Night shift and manual share one slot, no parallel runs | Worker launcher has double-execution prevention | Verify it blocks night-shift vs manual conflicts |
| **Founder app provisioning** | Neon DB + landing page deployed to Cloudflare R2 (or Render legacy) per founder company | Wired end-to-end: `neon.service.ts` (DB), `landing-deploy.service.ts` (tier-dispatching: CF R2 primary, Render legacy fallback). CF Worker serves `*.baljia.app` reading R2 at `founder-apps/{slug}/index.html`. Per-founder GitHub repos only created on Render path. | Verify production CF Worker deployed, R2 bucket configured, `*.baljia.app` wildcard DNS routed to Worker |
| **Live vendor integrations** | Browserbase, Meta Marketing API, Twitter API wired to real APIs | Tool files exist with API shapes defined | Verify credentials flow and live API connectivity |
