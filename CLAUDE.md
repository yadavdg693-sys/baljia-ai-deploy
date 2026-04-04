# CLAUDE.md — Baljia AI Project Memory

## What Is This Project

Baljia AI is a SaaS platform that autonomously runs companies using AI agents. Competitor to Polsia. Tagline: "Your AI Angel — runs your company while you enjoy life." Baljia = AI Angel.

Founders sign up, get an AI team (CEO + 8 specialist agents), and the platform builds, operates, and grows their company autonomously — handling tasks, planning, execution, and reporting.

## Core Build Principle

**Copy the Polsia founder experience. Improve the internal machinery.**

- If a Polsia behavior is strong for founder experience → preserve it
- If the underlying Polsia machinery is weak → redesign it rather than cloning it

## Architecture Documents

These documents contain the COMPLETE architecture specification. Read them before making ANY architecture decision:

1. **`/docs/Baljia_Knowledge_Graph_v2.md`** — 13-domain structured knowledge graph covering every detail of the Polsia architecture + Baljia improvements. This is the "what and why."

2. **`/docs/Baljia_Technical_Architecture_Spec_v2.md`** — Engineering blueprint with database schemas, API contracts, service boundaries, event bus design, onboarding pipeline, agent factory, verification framework. This is the "how."

3. **`/docs/Baljia_Audit_Findings.md`** — 70 audit findings from 3 passes. All findings are applied in v2 documents. Reference this for edge cases and ambiguities.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) + TypeScript | SSR for public pages, API routes, WebSocket support, single deployment |
| Platform DB | Supabase (Postgres + Auth + RLS + Realtime + Storage) | Built-in magic link + Google OAuth, Row Level Security for multi-tenancy, real-time subscriptions |
| Founder Company DBs | Neon (1 per company) | Programmatic provisioning via API, scale-to-zero, branching, cheap at volume |
| Hosting (Platform) | Render | Long-running agent execution (4hr), persistent WebSocket, background workers, cron |
| Hosting (Founder Apps) | Render | Same — traditional server hosting for generated Express/Postgres apps |
| Queue/Events | Upstash Redis | Serverless pub/sub for event bus, BullMQ-compatible for task queue |
| LLM (Agents) | Claude Sonnet 4 (`claude-sonnet-4-20250514`) | Best cost/quality for agent execution |
| LLM (Governance) | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Fast/cheap for routing, classification, credit quoting |
| LLM (Fallback) | Gemini 2.5 Flash (`gemini-2.5-flash`) via `@google/generative-ai` | CEO chat fallback when Anthropic unavailable |
| Payments | Stripe | Subscriptions, customer payments, Connect for withdrawals |
| Code Hosting | GitHub (platform-owned org) | Founder app repos managed by platform |
| Browser Automation | Browserbase | Cloud Playwright for Browser agent |
| Email | Postmark (transactional) | SPF/DKIM/DMARC, deliverability |
| Email Verification | Hunter.io | find_email, verify_email |
| Research | Tavily | Read-only web search for Research agent (Baljia improvement over Polsia) |
| Ad Creative | Sora 2 (OpenAI) | 15-30s AI video ads |
| Object Storage | Supabase Storage (replaces R2) | Integrated with platform DB |

## Project Structure

```
baljia-ai/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/                   # Auth routes (no dashboard layout)
│   │   │   ├── login/                # Magic link + Google OAuth
│   │   │   ├── callback/             # Auth callback handler
│   │   │   └── onboarding/           # 3-path onboarding (Surprise/Idea/Grow)
│   │   ├── (dashboard)/              # Authenticated dashboard routes
│   │   │   └── dashboard/[companyId]/ # Company dashboard
│   │   ├── (public)/                 # Public routes (no auth)
│   │   │   └── live/                 # Public live operations wall (Phase 7)
│   │   ├── api/                      # 18 API routes
│   │   │   ├── chat/                 # CEO chat (real streaming via Claude + Gemini fallback)
│   │   │   ├── tasks/                # Task CRUD + approve/reject
│   │   │   ├── documents/            # Document CRUD + suggestions
│   │   │   ├── credits/              # Credit balance + ledger
│   │   │   ├── onboarding/           # Onboarding pipeline trigger
│   │   │   ├── events/               # Platform events + SSE stream
│   │   │   ├── worker/               # launch, verify, night-shift triggers
│   │   │   ├── recurring/            # Recurring task evaluation
│   │   │   ├── ops/dashboard/        # Internal ops dashboard data
│   │   │   └── webhooks/stripe/      # Stripe webhook handler
│   │   ├── globals.css               # Tailwind v4 + Baljia design tokens
│   │   └── layout.tsx                # Root layout (fonts, metadata)
│   ├── components/
│   │   ├── ui/                       # 12 base UI components
│   │   ├── dashboard/                # 11 dashboard components
│   │   ├── chat/                     # 5 CEO chat interface components
│   │   ├── live/                     # LiveWall + CompanyPublicPage
│   │   ├── mascot/                   # Baljia mascot (state-driven)
│   │   └── onboarding/              # Onboarding flow components (not yet built)
│   ├── lib/
│   │   ├── supabase/                 # Supabase clients (server + client + admin)
│   │   ├── agents/                   # CEO agent, agent factory, worker launcher, watchdog
│   │   │   ├── ceo/                  # ceo.agent.ts, ceo.prompt.ts, ceo.tools.ts
│   │   │   └── tools/               # 7 agent tool files (browser, research, data, etc.)
│   │   ├── services/                 # 18 business logic services
│   │   ├── validations/              # Zod schemas for API input
│   │   ├── api-utils.ts              # Auth guards + request helpers
│   │   ├── slug.ts                   # Slug generation with collision handling
│   │   └── utils.ts                  # Utility functions (cn, formatCredits, etc.)
│   └── types/
│       └── index.ts                  # All TypeScript types matching DB schema
├── supabase/
│   └── migrations/
│       ├── 00001_initial_schema.sql  # Complete platform schema (27 tables)
│       └── 00002_fix_schema_code_mismatches.sql  # Schema alignment fixes
├── docs/                             # Architecture documents
│   ├── Baljia_Knowledge_Graph_v2.md
│   ├── Baljia_Technical_Architecture_Spec_v2.md
│   ├── Baljia_Audit_Findings.md
│   └── IMPLEMENTATION_ROADMAP.md
├── package.json
├── tsconfig.json
├── next.config.ts
└── CLAUDE.md                         # This file
```

## Database Schema (27 tables)

All defined in `supabase/migrations/00001_initial_schema.sql`:

**Core:** users, companies, agents (seeded with 9), tasks, task_executions, reports, documents, document_suggestions, chat_sessions, platform_events

**Memory:** memory_layers (3 per company), learnings

**Billing:** subscriptions, credit_ledger, revenue_ledger, ad_spend_ledger, refund_history, referrals

**Communication:** email_threads, contacts, browser_credentials, ad_campaigns

**Platform:** mcp_servers, mcp_tools, agent_tool_mounts, recurring_tasks, night_shift_cycles, failure_fingerprints, task_failure_links

**Key triggers:**
- `create_core_documents()` — auto-creates 5 core doc slots + 3 memory layers on company insert
- `update_updated_at()` — auto-updates timestamps on companies, tasks, documents
- `get_credit_balance()` — function to get current credit balance from ledger

**RLS enabled on:** companies, tasks, documents, reports, credit_ledger, chat_sessions

## 9 Agents

| ID | Name | Max Turns | Style | Key Tools |
|----|------|-----------|-------|-----------|
| 0 | CEO/Chat | — (reactive) | agentic | 44 tools: chat/task mgmt, memory, Brave search, introspection |
| 30 | Engineering | 200 | agentic | polsia_infra (9), tasks (8), reports (3), polsia_support (2) |
| 42 | Browser | 200 | structured | browserbase (9), browser_auth (11), company_email (5) |
| 29 | Research | 200 | structured | Tavily (Baljia improvement), tasks, reports |
| 33 | Data | 200 | structured | polsia_infra (analytics), tasks, reports |
| 32 | Support | 200 | structured | company_email (5), conditional gmail, tasks, reports |
| 40 | Twitter | 200 | graph | twitter (2), documents (3), tasks, reports |
| 41 | MetaAds | 100 | graph | meta_ads (12), tasks, reports |
| 54 | ColdOutreach | 200 | graph | company_email (5), hunter_io (2), documents (3) |

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

## Key Architecture Patterns

### Credit Model
- 1 task = 1 credit (deducted at `start_task` / todo → in_progress)
- 4 separate billing lanes: subscription, task credits, ad spend, runtime AI
- Failed tasks consume credit (no auto-refund)
- Night shifts use separate capacity (not manual credits)
- Daily throughput: ~8-12 credits/day practical max

### Task Governance (between CEO/chat and worker launch)
- Sizes tasks, selects execution mode, checks prerequisites
- Forces decomposition when multiple features bundled
- Quotes credits before execution
- Classifies refund eligibility on failure

### Three Execution Modes (Engineering)
1. **Deterministic** — CRUD, admin tables, standard patterns. No agent needed.
2. **Template + Params** — Familiar base + custom delta. Smaller model fills params.
3. **Full Agent** — Novel/ambiguous work only. Rich compiled briefing first.

### Five Verification Levels
1. `none` — low-risk bookkeeping
2. `deterministic` — API, DB, log assertions
3. `browser_flow` — Browser agent validates UI
4. `quality_review` — LLM/rubric judgment for subjective output
5. `hybrid` — deterministic + browser + quality

**Critical: Worker is NOT the final authority on completion. Verifier sets final status.**

### Onboarding Pipeline
- Runs in isolated sandbox (Sapiom-style), NOT a visible agent
- 19-step sequence including strategy selection before naming
- 3-tier enrichment: strong person → personalize around person; weak person + strong business → personalize around business; weak both → bounded bucket fallback
- Per-journey starter task templates with dependency chain: Research → Build → Growth

### Night Shifts
- Scheduled platform process, not an agent
- Stage-aware: early/validation/monetization/retention/scale/compounding
- Trust-recovery priority: broken work → credit issues → repair → regression → roadmap
- Trial gets 3 night shifts; full plan gets 30/month

### Memory
- 3 layers: Domain Knowledge (15K tokens), User Prefs (3K), Cross-Company (15K)
- CEO/chat: direct read/write; Workers: injected packet only
- Learnings: separate CRUD/search system
- Baljia improvement: unified retrieval surface, worker-searchable memory

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

## What's Built So Far

### Phase 0-2: Foundation + UI ✅ COMPLETE
- [x] Project scaffolding (Next.js 15, TypeScript, Tailwind v4)
- [x] Complete database schema (27 tables, RLS, triggers, functions)
- [x] Schema alignment migration (00002 — fixed 4 mismatches)
- [x] TypeScript types for all 27 DB entities + agent runtime types
- [x] Supabase client setup (server + browser + admin)
- [x] Slug generation with collision handling + reserved names
- [x] Auth pages (login with magic link + Google, callback with routing)
- [x] Onboarding page (3-path: Surprise Me / Build My Idea / Grow My Company)
- [x] Baljia mascot component (7 states, 5 sizes, state-driven)
- [x] Company dashboard page (server component, loads all data)
- [x] DashboardShell component (3-column layout)
- [x] 12 base UI components (Button, Input, Textarea, Card, Badge, Tabs, Dialog, Dropdown, Skeleton, Toast, ScrollArea)
- [x] 11 dashboard components (TaskBoard, TaskCard, TaskDetailDialog, MetricsPanel, CreditDisplay, CreditLedger, PurchaseCreditsDialog, DocumentList, CompanyHeader, ActivityFeed, DashboardShell)
- [x] Environment variable template
- [x] Design system (globals.css: dark theme, gold accent, CSS vars, fonts)

### Phase 3: API + Services ✅ COMPLETE
- [x] Supabase Admin Client (service role, bypasses RLS)
- [x] 18 service files (task, company, credit, chat, document, event, memory, governance, router, verification, night-shift, recurring, failure, remediation, stage, mascot, rate-limiter, live-stream)
- [x] 18 API routes covering tasks, documents, credits, chat, onboarding, events, worker, recurring, ops, webhooks
- [x] Zod validation schemas for all API inputs
- [x] API utils (requireAuth, requireAuthAndCompany, parseJsonBody)
- [x] Stripe webhook handler (checkout.session.completed)

### Phase 4: CEO Chat + Governance ✅ COMPLETE
- [x] Real Claude-powered CEO chat with SSE streaming (Claude Sonnet 4 primary, Gemini 2.5 Flash fallback)
- [x] 5 chat UI components (ChatPanel, ChatMessage, ChatInput, TaskProposalCard, CreditQuoteCard)
- [x] CEO agent (ceo.agent.ts, ceo.prompt.ts, ceo.tools.ts — 8 tools)
- [x] Governance engine (task sizing, mode selection, split enforcement via Haiku 4.5)
- [x] Router service (tag → agent_id mapping)

### Phase 5: Execution Engine ✅ COMPLETE (code written, needs integration testing)
- [x] Agent factory + prompt assembler (agent-factory.ts — 560 lines)
- [x] Worker launcher + watchdog (worker-launcher.ts + watchdog.ts)
- [x] 7 agent tool files (browser, research, data, support, twitter, meta-ads, outreach)
- [x] Worker API routes (launch, verify, night-shift)
- [x] Events API routes (events, events/stream — SSE)
- [x] Live wall components (LiveWall.tsx, CompanyPublicPage.tsx)
- [ ] Engineering agent (3 execution modes) — NOT YET BUILT
- [ ] Event bus (Upstash Redis pub/sub) — NOT YET WIRED
- [ ] Neon service (per-company DB provisioning) — NOT YET BUILT
- [ ] Full Stripe billing service (subscriptions + credit purchases) — STUB ONLY

### What's NOT Built Yet
- Full onboarding pipeline (16-stage async)
- Individual agent implementations (Engineering, Browser, Research, Data, Support, Twitter, MetaAds, ColdOutreach)
- Night shift scheduler (service exists, cron trigger incomplete)
- Verification execution (service exists, actual checks not wired)
- Email service (Postmark)
- Tavily integration (research)
- Browserbase integration (browser agent)
- Sora 2 integration (ad creative)
- Referral system UI

## Naming Conventions

- Database: snake_case (Postgres convention)
- TypeScript types: PascalCase
- Component files: PascalCase.tsx
- Utility files: camelCase.ts
- API routes: kebab-case directories
- CSS variables: kebab-case with prefix (`--color-`, `--size-baljia-`)

## Common Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run db:migrate   # Push schema to Supabase
npm run db:reset     # Reset database
npm run db:types     # Generate TypeScript types from DB
```

## Important Gotchas

1. **Phantom mounts:** `memory`, `skills`, `stripe`, `gmail` appear in agent configs but are NOT real MCP servers. Filter them out in tool mount resolution.

2. **Document access is NOT universal:** Only Twitter and Cold Outreach have the `documents` MCP. Engineering, Browser, Data, Research CANNOT access company documents directly — content must be injected via compiled briefing.

3. **Trial gets night shifts:** Don't check `billing_state === 'active'` only — trial companies also get 3 night shifts. Check `['active', 'trial'].includes(billing_state)`.

4. **Credits don't roll over.** No multi-tier feature gating — the product sells execution volume.

5. **`available_documents` only shows populated docs.** Empty document slots may not appear in dashboard/agent contexts.

6. **Task IDs are global** (platform-wide), but the visible queue is company-local.

7. **Worker lifecycle is overhead:** Each task currently wastes 4 API calls (find task, start task, write report, complete task). Move these into platform in our build.

8. **`user_context` vs `user_research`:** Source uses both names — may be same slot or separate hidden surface. Treat as open question.

9. **Trial credit budget is ambiguous:** Source says both "10 credits" and "5 base + 10 welcome = 15." We default to 10 until clarified.

10. **Complexity (1-10) is planning metadata only.** Does NOT change credit cost, agent selection, tools, or runtime cap.
