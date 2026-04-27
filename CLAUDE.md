# CLAUDE.md — Baljia AI Build Guide

## What Is This Project

Baljia AI is a SaaS platform that autonomously runs companies using AI agents. Tagline: "Your AI Angel — runs your company while you enjoy life." Baljia = AI Angel.

Founders sign up, get an AI team (CEO + 8 specialist agents), and the platform builds, operates, and grows their company autonomously — handling tasks, planning, execution, and reporting.

## Core Build Principle

**Copy the Polsia founder experience. Improve the internal machinery.**

- If a Polsia behavior is strong for founder experience → preserve it
- If the underlying Polsia machinery is weak → redesign it rather than cloning it

## Architecture Reference (archived — NOT actively followed)

The internal specs were the original architecture plan. We are **not** actively following them as source of truth anymore — the code has diverged in places, and many specs describe future state rather than current behavior. Treat them as historical reference only.

When making architecture decisions, **read the actual code first.** If you need historical context, the specs are still on disk:

**Archived location:** `excluded/specs/internal/` (moved out of the active tree to keep focus on shipping code)

The tables below remain as a map of what reference material exists.

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

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) + TypeScript | SSR for public pages, API routes, single deployment |
| Platform DB | Neon PostgreSQL + Drizzle ORM | Serverless Postgres, code-first schema, type-safe queries |
| Founder Company DBs | Neon (1 per company) | Programmatic provisioning via API, scale-to-zero |
| Auth (founder) | Custom JWT (jose) + magic link + Google OAuth | Full control over session management |
| Auth (LLM provider) | **Claude Code OAuth** (`~/.claude/.credentials.json`) → ANTHROPIC_API_KEY → Bedrock | Piggybacks on operator's Pro/Max subscription; no extra creds. See `src/lib/anthropic-oauth.ts`. |
| Hosting | Cloudflare Workers (primary) + Render (legacy fallback) | See ADR-002. CF Workers serve API + agent execution + scheduled tasks; Render kept for environments without CF creds |
| Cache + ephemeral counters | Redis Cloud (via `ioredis` TCP, not Upstash REST) | Rate-limit counters (`rl:chat:<ip>`), Tavily search cache, fire-and-forget pub/sub on `events:<companyId>`. Falls back gracefully if `REDIS_URL` unset. NOTE: the **task queue is in Postgres** (`tasks.status='todo'` + atomic claim under `WHERE status='todo'`), not Redis. Pub/sub channel is published-to but not yet consumed client-side; dashboard refresh uses 30s poll + on-action hook. |
| Task queue | Postgres (`tasks` table) | Atomic claim via `WHERE status='todo'` in `claimSlotAndCharge`. Render BG worker (`scripts/worker-boot.ts`) polls + claims; web process can also `launchTask` directly. One slot per company. |
| LLM (CEO chat) | **Claude Opus 4.6** (`claude-opus-4-6`) | Strategic, multi-tool orchestration, founder-facing. Override via `CEO_CLAUDE_MODEL`. |
| LLM (Worker agents) | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | Engineering / Research / Data / Browser / etc. Strong on code + tool use, cheaper than Opus. Override via `WORKER_CLAUDE_MODEL`. |
| LLM (Governance) | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Fast/cheap for routing, classification, credit quoting |
| LLM provider chain (per call) | OpenAI Codex JWT → Claude (OAuth/API/Bedrock) → OpenRouter → Gemini Flash | Each fails over to the next. See `src/lib/agents/agent-factory.ts` and `ceo.agent.ts` |
| Payments | Stripe | Subscriptions, credit purchases, billing portal |
| Code Hosting | GitHub (platform-owned org) | Platform code; per-founder repos used only by Render legacy deploy path (CF deploys static landing directly to R2) |
| Browser Automation | Browserbase | Cloud Playwright for Browser agent |
| Email | Postmark (transactional) | SPF/DKIM/DMARC, deliverability |
| Email Verification | Hunter.io | find_email, verify_email |
| Research | Tavily | Read-only web search for Research agent (Baljia improvement) |
| Ad Creative | Sora 2 (OpenAI) | 15-30s AI video ads |
| Object Storage | Cloudflare R2 (via AWS S3 SDK) | Asset storage for generated content |
| Monitoring | Sentry | Error tracking, performance monitoring |
| Validation | Zod | Runtime input validation on all API boundaries |
| Testing | Vitest | Unit and integration tests |

## Hosting Architecture (ADR-002 Split Hosting)

Two-tier hosting: **Cloudflare Workers as primary, Render as legacy fallback**. Tier dispatch happens at runtime — services check `isCloudflareDeployConfigured()` and route accordingly. Lets dev/CI environments without CF creds keep working.

| Concern | Cloudflare path (primary) | Render path (legacy fallback) |
|---|---|---|
| API + Next.js app | CF Worker via `@opennextjs/cloudflare` (`wrangler.toml`) | Render web service (`render.yaml`) |
| Scheduled tasks | CF Cron Triggers / Workflows | Render cron jobs |
| Founder landing pages | R2 upload to `founder-apps/{slug}/index.html`, served by CF Worker via wildcard `*.baljia.app` route | GitHub repo + Render static site + per-subdomain DNS |
| Founder DBs | Neon (unchanged across both paths) | Neon (unchanged) |

### Founder landing page deploy flow (CF primary path)

1. `generateLandingPage(ctx)` produces structured 8-field JSON via LLM (design_intent + 7 content sections — see canonical format below)
2. Renderer turns JSON → HTML with design tokens (per-company palette / font / density)
3. `publishLandingToSubdomain(ctx, html)` calls `deployLandingPage()` which dispatches to CF
4. CF path uploads HTML to R2 at deterministic key `founder-apps/{slug}/index.html`
5. CF Worker on `*.baljia.app` wildcard route reads R2 by hostname slug, serves HTML
6. **HTML is NOT stored in `documents` table** — the deployed URL is the source of truth

### Landing page canonical format (7 sections)

After 32-Polsia-site research, the Day-0 landing page has exactly these sections — no FAQ, no waitlist, no SEO bloat, no city mentions:

```
brand header → hero (headline + subhead) → what it does (3-4 cards) →
how it works (3 steps) → what makes it different (3 bullets) →
closing (headline + body) → footer
```

Country may appear ONCE in closing or tagline as PROVENANCE only ("Built in India") — never as market scope ("for Indian businesses").

### Code locations

- `src/lib/services/landing-deploy.service.ts` — tier dispatcher (CF / Render)
- `src/lib/services/cf-deploy.service.ts` — R2 upload + idempotency
- `src/lib/services/onboarding/shared/landing.ts` — structured-JSON generator + renderer + `publishLandingToSubdomain`
- `src/lib/services/onboarding/shared/landing-design-tokens.ts` — palette × mood, font pairings, density resolver
- `src/lib/services/domain.service.ts` — `provisionWildcardSubdomain` (DB-only, no DNS call since `*.baljia.app` is wildcard)
- `founder-app-worker/` — CF Worker source serving `*.baljia.app`
- See `docs/adr-002-split-hosting-strategy.md` for the decision record and `docs/cf-founder-app-runbook.md` for ops

## 9 Agents

| ID | Name | Max Turns | Style | Key Tools |
|----|------|-----------|-------|-----------|
| 0 | CEO/Chat | 5 (reactive) | agentic | Task management, memory read/write, web search, credit quoting, document suggestions |
| 29 | Research | 200 | structured | Tavily web search, competitive analysis, source citing |
| 30 | Engineering | 200 | agentic | Infrastructure provisioning, code generation, deployment, GitHub |
| 32 | Support | 200 | structured | Company email, conditional Gmail, customer communications |
| 33 | Data | 200 | structured | SQL queries, analytics, business intelligence |
| 40 | Twitter | 200 | graph | Tweet composition, scheduling, engagement, documents |
| 41 | MetaAds | 100 | graph | Meta Marketing API (12 tools), campaign management |
| 42 | Browser | 200 | structured | Browserbase (9 tools), browser auth (11), form filling, scraping |
| 54 | ColdOutreach | 200 | graph | Company email, Hunter.io, personalized outreach sequences |

## The Hidden Execution Chain

This is what happens behind every founder interaction. Founders see a simple chat → task board. The system behind it:

```
Founder message
  → CEO/chat (10-step decision flow)
    → classify intent (chat vs task-like vs hybrid)
    → check company state + credits + feasibility
    → governance handoff (hidden): credit quote, execution_mode, verification_level
    → CEO presents quote to founder (founder-safe language only)
  → Founder approves
    → task created (status: todo)
    → credit deducted (todo → in_progress)
    → control-plane selects execution_mode:
        deterministic | template_plus_params | full_agent
    → ContextPacket assembled (memory layers + prior reports + failure context)
    → worker dispatched with compiled briefing
    → watchdog monitors (turn budget + time-based stall detection)
    → worker completes
    → verifier runs (5 levels: none → deterministic → browser → quality → hybrid)
    → verifier sets final status (NOT the worker)
    → if failed: remediation loop (up to 100 repair attempts per scope)
    → post-execution: actual-cost accounting, failure fingerprinting, memory writes
```

**Key invariants from the control-plane umbrella spec:**

- One active execution slot per company (night shift and manual share the slot)
- Every run has bounded execution: `maxTurns` (turn budget) + watchdog (time-based stall detection)
- `execution_mode` is selected before runtime dispatch — it is NOT the same as `worker_lane`
- Worker is never the final authority on completion — verifier sets final status
- Rejected is a real terminal state, not just "failed differently"
- Free planning lane: chat/scoping/planning never costs credits

## CEO/Chat Decision Model

The CEO agent follows a 10-step decision flow (SPEC-CEO-001):

1. Interpret intent (chat vs task-like vs hybrid)
2. Classify shape (single task, decomposable bundle, not-a-task)
3. Check company state (lifecycle, stage, billing)
4. Check credits (balance vs required)
5. Check feasibility (tools available, prerequisites met)
6. Decide path (propose, decompose, defer, refuse)
7. Estimate credits (via hidden governance handoff)
8. Choose agent (find_best_agent routing)
9. Write brief (founder-safe task description)
10. Queue, defer, or refuse

**Credit quoting:** CEO asks hidden governance for a 5-field quote: `credits_required`, `task_split`, `founder_safe_reason`, `included_scope`, `blockers`. Governance returns a founder-safe response object — CEO never invents credit numbers.

**Rate limiting escalation:** observe → soft-limit → degrade → cooldown → flag → suspend (6 steps)

**What CEO must NOT reveal:** agent IDs, internal tool names, execution modes, verification levels, platform costs, infrastructure details. Answer at business level only.

## Task Lifecycle

From SPEC-CTRL-102:

```
todo → in_progress → verifying → completed
                  ↘ failed → repair → (back to verifying or failed_permanent)
                                    ↘ founder_decision (stop-loss exceeded)
todo/failed → rejected (founder rejects)
```

**Task status values:** `todo`, `in_progress`, `verifying`, `completed`, `failed`, `failed_permanent`, `rejected`

**Task sources:** `founder_requested`, `ceo_proposed`, `night_shift`, `recurring`, `system`

## 4-Lane Billing Model

From SPEC-BILL-001:

| Lane | What it tracks | Who pays |
|------|---------------|----------|
| Subscription | Monthly plan fee | Founder (Stripe) |
| Task Credits | 1 credit = 1 task execution | Founder (purchased or granted) |
| Ad Spend | Meta/Google ad budget pass-through | Founder (daily Stripe charges) |
| Runtime AI | LLM token costs, browser minutes, search calls | Platform absorbs (included in plan) |

**Credit rules:**
- 1 task = 1 credit always (deducted at todo → in_progress)
- Failed tasks consume credit (no auto-refund)
- Credits don't roll over between billing periods
- Night shifts use separate capacity, not manual credits
- Free planning lane: chat/planning/scoping never costs credits — platform absorbs LLM cost, bounded by rate limiting

## Verification and Remediation

From SPEC-CTRL-106:

**5 verification levels** (assigned by governance before execution):

| Level | Method | Used for |
|-------|--------|----------|
| `none` | Skip verification | Low-risk bookkeeping |
| `deterministic` | API, DB, log assertions | CRUD, data operations |
| `browser_flow` | Browser agent validates UI | Frontend changes |
| `quality_review` | LLM/rubric judgment | Subjective content |
| `hybrid` | deterministic + browser + quality | Complex multi-output tasks |

**Remediation loop:** failed → repair attempt → re-verify. Max 100 repair attempts per scope (DEC-REPAIR-001). Stop-loss: if repair cost exceeds threshold, escalate to founder decision rather than burning more resources.

**8 failure classes:** `infra_error`, `capability_miss`, `external_block`, `verification_reject`, `timeout`, `scope_overflow`, `policy_violation`, `connector_failure`

## Memory System

From SPEC-CTRL-105:

**3 layers with token budgets:**

| Layer | Name | Budget | Access |
|-------|------|--------|--------|
| 1 | Domain Knowledge | 15K tokens | CEO: read/write, Workers: injected |
| 2 | User Preferences | 3K tokens | CEO: read/write (autosave every ~20 messages) |
| 3 | Cross-Company | 15K tokens | Platform-only writes, anonymized, quality-gated |

**Learnings:** Separate CRUD/search system. Shape: `learning_id`, `company_id`, `source_task_id`, `category`, `insight`, `confidence`, `tags`. Searchable by workers during execution.

**ContextPacket:** Bounded execution context assembled per-run. Includes: memory layers, prior reports, failure fingerprints, company state, compiled briefing.

**PermissionSnapshot:** Run-level permission envelope. Locks what the worker can access during execution.

**Baljia improvement:** Unified retrieval surface — workers can search memory and learnings, not just receive injected packets.

## Onboarding Pipeline

From SPEC-ONB-001:

- 19-step sequence running in isolated sandbox (NOT a visible agent)
- 3 journeys: Surprise Me, Build My Idea, Grow My Company
- Strategy selection happens BEFORE naming (step order matters)
- 3-tier enrichment: strong person → personalize around person; weak person + strong business → personalize around business; weak both → bounded bucket fallback
- Per-journey starter task templates with dependency chain: Research → Build → Growth
- Creates: company record, 5 core document slots, 3 memory layers, initial roadmap

## Night Shifts

From SPEC-CTRL-103:

- Scheduled platform process, not an agent
- Stage-aware: early/validation/monetization/retention/scale/compounding
- Trust-recovery priority: broken work → credit issues → repair → regression → roadmap
- Gap-based planning: next task = strongest gap between ideal stage progression and current state (Baljia improvement over Polsia's reactive planning)
- Trial gets 3 night shifts; full plan gets 30/month
- Night shift and manual execution share one slot per company (no parallel runs)

## Platform Ops (Hidden Layer)

From SPEC-OPS-001:

9 hidden platform-side agents/processes that founders never see:

| Agent | Purpose |
|-------|---------|
| `infra_watchdog` | Runtime health: queue backlogs, stuck runs, browser leaks, heartbeats |
| `failure_fingerprinter` | Normalize failures into reusable signatures (8-class taxonomy) |
| `known_issue_registry` | Store clustered failure families with fix status |
| `regression_guard` | Detect recurrence of previously-fixed issues |
| `platform_support_triage` | Classify escalations: bug, feature, billing, abuse, incident |
| `bug_reproducer` | Recreate failures from logs for diagnosis |
| `prompt_policy_improver` | Propose (never auto-deploy) prompt/policy changes |
| `routing_orchestration_analyst` | Monitor routing accuracy, queue health, task-fit |
| `billing_credit_auditor` | Ledger anomalies, disputes, burn accuracy |

**Self-healing loop:** detect → cluster → fix → verify → prevent recurrence

- Platform ops consumes internal budget, not founder credits
- Platform ops is invisible to founders
- Known-issue context is exposed to CEO/chat before scoping similar tasks (read-only)

## Execution Modes

From SPEC-CTRL-101:

| Mode | When | How |
|------|------|-----|
| `deterministic` | CRUD, admin tables, standard patterns | No LLM agent needed — direct code execution |
| `template_plus_params` | Familiar base + custom delta | Smaller model fills parameters into known template |
| `full_agent` | Novel/ambiguous work | Full agent loop with compiled briefing, tool access, watchdog |

Governance selects `execution_mode` before dispatch. This is NOT the same as `worker_lane` (which agent runs it).

## Watchdog

From SPEC-CTRL-001:

- Turn-based cap: `maxTurns` per agent (CEO: 5, most workers: 200, MetaAds: 100)
- Time-based stall detection: flags runs with no progress beyond configurable threshold
- Loop detection: same tool called N consecutive times → kill
- Absolute time limit: 4 hours max execution
- Watchdog sits beside the turn budget — they are complementary caps, not alternatives

## 11 Locked Build Decisions

These are NON-NEGOTIABLE architectural choices. Do not deviate:

1. Onboarding research depth = `balanced` (configurable per journey)
2. Mission generator = `approximate parity` (preserve feel, don't force exact template)
3. Different starter-task templates per journey
4. Core documents update via user-reviewed suggestions ONLY (no silent auto-update)
5. Public-surface visibility = configuration-driven
6. Single-domain deployment sufficient
7. Research = read-only web (Tavily); Browser = interactive web
8. Free planning, paid execution (credits consumed at worker start ONLY)
9. OAuth connections unlock with execution (not pre-trial)
10. Execution log transparency = first-class
11. Data-driven product improvement = explicit, policy-backed, bounded

## Design System

**Theme:** Dark-first, gold accent (`#F5A623`), warm/wise/dependable tone

**Fonts:**
- Display: Satoshi (bold headings, hero text)
- Body: General Sans (all body text)
- Mono: JetBrains Mono (terminal strips, code, logs)

**Colors:** Defined as CSS variables in `globals.css` under `@theme` block

**Mascot (Baljia Angel):** 7 states driven by real platform events: listening, planning, running, investigating, blocked, resolved, growth_mode. Size tokens from 40px (chat) to 220px (hero).

**Dashboard Layout:**
- Desktop: 3-column (left: mascot+metrics, center: tasks+docs, right: twitter+email+ads+chat)
- Mobile: single-column stacked with floating chat button
- Right-side chat panel is resizable/expandable
- Task board has 6 tabs: To Do, Recurring, In Progress, Completed, Rejected, Failed

## Claude Code OAuth Integration

The platform uses the operator's local Claude Code OAuth credentials (`~/.claude/.credentials.json`) as the **primary** Anthropic auth path. This means in dev — and any environment where the operator has run `claude login` — no `ANTHROPIC_API_KEY` env var is needed; calls go through their Pro/Max subscription.

**Key file:** `src/lib/anthropic-oauth.ts`
- `isAnthropicOAuthAvailable()` — sync check (file present + has token + has `user:inference` scope)
- `getAnthropicOAuthToken()` — async, refreshes via `pi-ai`'s `refreshAnthropicToken` when expiry < 5 min
- `createAnthropicWithOAuth()` — returns `{ client, isOAuth }` with the right SDK options (`apiKey: null`, `authToken: <token>`, `dangerouslyAllowBrowser: true`, full headers)
- `withClaudeCodeIdentity(prompt, isOAuth)` — wraps system prompt to satisfy server-side check (API rejects OAuth requests whose first system text block isn't `"You are Claude Code, Anthropic's official CLI for Claude."`)

**Provider chain (Anthropic):**
1. Claude Code OAuth — preferred
2. Direct `ANTHROPIC_API_KEY` (sk-ant-…)
3. Bedrock long-term API key (`ABSK…`)
4. Bedrock IAM (AWS env vars)

Wired into: `ceo.agent.ts` (CEO chat), `agent-factory.ts` (worker agents), `governance.service.ts` (Haiku classifier), `services/onboarding/llm/small-llm.ts`.

**Important: every callsite that builds a system prompt must call `withClaudeCodeIdentity(prompt, isOAuth)` — Anthropic rejects OAuth requests missing the identity prefix.**

Smoke test: `npx tsx --env-file=.env.local src/scripts/test-anthropic-oauth.ts`

## Founder UI parity (Tier 1 + Tier 2 shipped)

Anything Baljia can do via chat tools, the founder can now do via dashboard buttons (and vice versa). Both paths share the same APIs and DB writes.

| Action | Baljia (chat tool) | Founder (UI) |
|---|---|---|
| Create task | `create_task` | "+ New Task" button → `NewTaskDialog` |
| Edit task | `edit_task` | Pencil icon in `TaskDetailDialog` |
| Reject task | `reject_task` | Reject button on task card / dialog |
| Approve + run | `approve_task` | "▶ Run Now" / "Approve" button |
| Reorder / move-to-top | `reorder_task` / `move_task_to_top` | ▲ ↑ ↓ buttons on todo cards |
| Execution logs | `get_task_execution_logs` | Logs panel inside `TaskDetailDialog` |
| Recurring tasks (CRUD) | `get/create/update/delete_recurring_task` | "↻ Recurring" → `RecurringTasksDialog` |
| Edit document | `update_document` | Pencil in `DocumentDialog` |
| Add link | `update_link` | "+ Add link" → `AddLinkDialog` |
| All read-only tools | many | Chat panel responses |

**APIs added:** `POST/DELETE /api/links`, `PATCH/DELETE /api/recurring/[id]`, `GET /api/tasks/[taskId]/logs`. `updateTaskSchema` now also accepts `tag` + `queue_order`.

**Approve flow:** `/api/tasks/:id/approve` now calls `launchTask` directly (fire-and-forget) instead of relying on a separate Render BG worker process. This means tasks actually run in dev — and in prod both launch paths coexist safely (atomic `WHERE status='todo'` claim ensures only one wins).

## Chat → Dashboard refresh hook (the original "create task in chat" bug)

`DashboardShell` exposes `refreshDashboard()` and `handleChatAction(action)`. The chat (`FounderChatRail` / `ChatPanel`) accepts an `onAction` prop and fires it for every `task_proposal` / `task_approved` / `document_updated` / `credit_quote` action. This drops update latency from up-to-30s (poll fallback) to ~20ms (verified at 17–88ms).

**State-changing tools that don't yet emit ChatActions** (still rely on 30s poll OR page reload): `edit_task`, `reject_task`, `reorder_task`, `move_task_to_top`, `update_link`, recurring CRUD. Adding action emission to these = next "Tier 3" work.

## Tests

Three layers, all green as of this session:

| Layer | What it covers | Run command |
|---|---|---|
| Unit (Vitest, 96 tests) | All 40 CEO tool handlers, mocked services | `npm test` |
| Direct-API regression (Node script) | All 40 tools against real DB, fixture cleanup | `npx tsx --env-file=.env.local src/scripts/test-all-ceo-tools.ts` |
| Frontend E2E (Playwright) | Chat → LLM → tool → DB → frontend (12 tests) + founder UI parity (5 tests) | `npx playwright test ceo-tools` and `npx playwright test founder-ui-parity` |
| OAuth smoke test | Real Anthropic call via `~/.claude/.credentials.json` | `npx tsx --env-file=.env.local src/scripts/test-anthropic-oauth.ts` |
| 3-agent test runner | Creates + approves tasks tagged engineering/research/data, polls execution | `npx tsx --env-file=.env.local src/scripts/test-3-agent-tasks.ts` |

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
| `night-shift.service.ts` | Built | Stage-based objectives, queue processing |
| `billing.service.ts` | Built | Stripe integration, subscription management |
| `approval.service.ts` | Built | Governance checks before task launch |
| `remediation.service.ts` | Built | Auto-remediation on task failure |
| `stage.service.ts` | Built | Company stage progression |
| `neon.service.ts` | Built | Neon DB provisioning + branching |

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
| **Stage-aware gap planning** | Night shift picks strongest gap between ideal and current | Stage service exists, night-shift service exists | Verify gap analysis matches spec depth |
| **One-slot concurrency** | Night shift and manual share one slot, no parallel runs | Worker launcher has double-execution prevention | Verify it blocks night-shift vs manual conflicts |
| **Founder app provisioning** | Neon DB + landing page deployed to Cloudflare R2 (or Render legacy) per founder company | Wired end-to-end: `neon.service.ts` (DB), `landing-deploy.service.ts` (tier-dispatching: CF R2 primary, Render legacy fallback). CF Worker serves `*.baljia.app` reading R2 at `founder-apps/{slug}/index.html`. Per-founder GitHub repos only created on Render path. | Verify production CF Worker deployed, R2 bucket configured, `*.baljia.app` wildcard DNS routed to Worker |
| **Live vendor integrations** | Browserbase, Meta Marketing API, Twitter API wired to real APIs | Tool files exist with API shapes defined | Verify credentials flow and live API connectivity |

### Commands

```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm start            # Production server
npm run lint         # ESLint
npm test             # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
npm run db:push      # Push Drizzle schema to Neon (dev)
npm run db:generate  # Generate Drizzle migration files
npm run db:studio    # Open Drizzle Studio GUI
npx tsx src/scripts/seed-db.ts  # Seed 9 agents into DB
```

## Naming Conventions

- Database: snake_case (Postgres convention)
- TypeScript types: PascalCase
- Component files: PascalCase.tsx
- Service files: kebab-case.service.ts
- Utility files: camelCase.ts
- API routes: kebab-case directories
- CSS variables: kebab-case with prefix (`--color-`, `--size-baljia-`)

## Important Gotchas

1. **Phantom mounts:** `memory`, `skills`, `stripe`, `gmail` appear in agent configs but are NOT real MCP servers. Filter them out in tool mount resolution.

2. **Document access is NOT universal:** Only Twitter and Cold Outreach have the `documents` MCP. Engineering, Browser, Data, Research CANNOT access company documents directly — content must be injected via compiled briefing.

3. **Trial gets night shifts:** Don't check `billing_state === 'active'` only — trial companies also get 3 night shifts. Check `['active', 'trial'].includes(billing_state)`.

4. **Credits don't roll over.** No multi-tier feature gating — the product sells execution volume.

5. **`available_documents` only shows populated docs.** Empty document slots may not appear in dashboard/agent contexts.

6. **Task IDs are global** (platform-wide), but the visible queue is company-local.

7. **Worker lifecycle is overhead:** Each task currently wastes 4 API calls (find task, start task, write report, complete task). Move these into platform in our build.

8. **Trial credit budget is ambiguous:** Source says both "10 credits" and "5 base + 10 welcome = 15." We default to 10 until clarified. See `decide-later.md`.

9. **Complexity (1-10) is planning metadata only.** Does NOT change credit cost, agent selection, tools, or runtime cap.

10. **Worker is NOT the final authority.** Verifier sets final task status. Never let a worker mark its own task as completed.

11. **One slot per company.** Night shift and manual execution share a single active execution slot. No parallel runs per company.

12. **Governance is hidden.** Founders never see governance decisions, execution modes, or verification levels. CEO translates everything into founder-safe language.

13. **Platform ops is invisible.** The 9 platform-side agents are never exposed to founders. Founders see improved reliability, not the machinery.

14. **Claude OAuth requires identity prefix in system prompt.** Any code that constructs an Anthropic client with `authToken` (the OAuth path) MUST prepend the Claude Code identity block (`"You are Claude Code, Anthropic's official CLI for Claude."`) as the first system text block, otherwise the API rejects the request. Use `withClaudeCodeIdentity(prompt, isOAuth)` from `@/lib/anthropic-oauth`. Bedrock and direct-API-key paths skip this step.

15. **`update_link` and recurring task tools don't reflect in the UI yet for some surfaces.** `update_link` writes to `dashboard_links` but the dashboard's Links section also renders hardcoded company URLs (website / inbox / hosted-checkout). Recurring tasks are managed via `RecurringTasksDialog` but the main dashboard preview shows top-5 active tasks only — recurring lives on `/dashboard/[id]/tasks`. Both are existing product gaps, not regressions.

16. **Approve route launches synchronously (in-process).** `/api/tasks/:id/approve` calls `launchTask(taskId)` fire-and-forget. In production the Render BG worker (`scripts/worker-boot.ts`) ALSO polls; both paths use atomic `WHERE status='todo'` claim so only one wins. Don't add a third launcher without thinking through the race.

17. **CEO chat voice = Polsia-style terse.** The Communication Style section in `ceo.prompt.ts` enforces ≤ 2-sentence confirmations, no filler ("Here's…", "I'll go ahead and…"), no link summary in confirmations, no emoji default. If you find yourself writing a long reply: write it, then delete half. The chat rail renders markdown via `MarkdownBody` so `**bold**` formats correctly — don't over-bold.

18. **Daily spend cap is enforced per plan.** Trial = 10 credits/day. Hitting the cap throws `"Daily spend cap reached"` from `creditService.claimSlotAndCharge` — surfaced as a launch failure in the worker log. Use `ensureCredits()` in test fixtures, OR upgrade the company's plan during dev.

19. **Support agent inbound — split provider architecture.** Outbound mail uses **Postmark** (`POSTMARK_SERVER_TOKEN`) — domain-verified at `baljia.app`, no per-address signature needed. Inbound has TWO paths and the operator picks one:
    - **Cloudflare Email Routing** (legacy default): mail to `<slug>@baljia.app` is forwarded to the founder's personal email; the platform never sees it; `email_threads` stays empty; Support agent's `get_inbox` returns nothing useful.
    - **Postmark Inbound Stream** (recommended for Support agent): set MX records on baljia.app to Postmark, configure an Inbound Stream pointing at `/api/webhooks/email`, set Basic Auth password = `POSTMARK_WEBHOOK_SECRET`. The webhook writes to `email_threads` (Support agent reads from there), forwards a copy to the founder's personal email (preserves their UX), and dedupes Postmark retries via `external_id`. Run `npx tsx --env-file=.env.local src/scripts/test-support-inbound.ts` to verify end-to-end without real MX records.

    Fixed in this session: `get_inbox` now atomically marks emails `is_read=true` after returning them (was looping forever); `send_email` uses `companies.company_email` instead of hardcoded `support@baljia.app` (so replies thread correctly to the company identity); webhook is idempotent on `(company_id, external_id)`.
