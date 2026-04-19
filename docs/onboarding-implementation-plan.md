# Onboarding — Implementation Plan

> **Goal.** Bring our onboarding to Polsia parity *for the Research and Content Creation phases* without rewriting it as an LLM-driven agent. Layer activity stream, mood, watchdog, and per-journey divergence on top of the existing 21-stage pipeline.
>
> **Reference.** [onboarding-research-and-content.md](./onboarding-research-and-content.md) for the *what*; this doc is the *how* and *when*.

---

## Decisions locked before starting

| Decision | Choice | Why |
|---|---|---|
| **Surprise Me journey** | **KEEP** as the "Baljia magic" path | Differentiating marketing hook ("Don't have an idea? We'll invent one based on who you are"). Personal-context cost is concentrated where it actually creates substance. |
| **Per-journey enrichment** | Build/Grow get GeoIP only; Surprise Me gets full LinkedIn + Twitter + founder angle | Personal context is *substance* for Surprise Me, only *polish* for Build/Grow. Skip what doesn't pay off. |
| **Build vs Grow research intent** | Build = product research (PMF discovery); Grow = distribution research (find acquisition channels) | Same industry, fundamentally different questions. Different Tavily queries, different report sections, different engineering task spec. |
| Architecture style | Strategy pattern with **3 strategies** (BuildMyIdea, GrowMyCompany, SurpriseMe) | Cleaner than `if (journey===)` branches. Each strategy class encapsulates per-journey logic. |
| Per-journey idea shapes | Each idea-processing stage outputs its own JSON shape (Grow keeps richer business profile) | Strategy class methods read only their journey's fields — no spread-out branching needed. Forced unification would lose Grow's richness. |
| Execution model | Deterministic stage list (NOT LLM-driven agent) | Predictable, debuggable, ~$0.10/onboarding. Agent can come later if real divergence emerges. |
| Concurrency model | Single-process fire-and-forget (no queue) | Sufficient for <30 concurrent. Add Inngest/BullMQ when production load demands. |
| Watchdog | In-process tick loop + future cleanup cron | In-process catches stalls fast (60s threshold); cron is the durability backup. |
| Hosting | Local-first build; production hosting decided separately | Phases 0–4 verifiable on `npm run dev` with no hosting commitment |

---

## Phase ordering & timeline

| Phase | Scope | Time | Risk | Reviewable in isolation? |
|---|---|---|---|---|
| **0. Foundation** | Strategy refactor (3 strategies) + REMOVE (archetype stage, callHaiku rename) + ADD (header capture, name capture) + SCOPE (per-journey enrichment) | 1d | Low — mostly mechanical | Yes — type-check + manual run |
| **1. Observability layer** | `onboarding_activity` + `onboarding_mood` event channels; per-stage emissions; cost instrumentation | 1d | Low — additive only | Yes — visible on dev dashboard |
| **2. Watchdog** | In-process tick loop; idle warnings; absolute timeout (60s/600s) | 0.5d | Low | Yes — force-stall test |
| **3a. Per-journey research** | `refine_idea` (Build, active transform), `fetch_business_url` (Grow), `invent_idea` (Surprise) + per-journey market research (Build = product, Grow = distribution) + GeoIP-derived regional context (city/country dynamic, no hardcoded country) + persistence fixes | 1.5d | Medium — new behavior + journey divergence | Yes — run each journey end-to-end |
| **3b. Per-journey tasks** | Polsia 3-slot structure + per-journey engineering task spec (Build = product spec, Grow = optimization spec) + populate complexity/hours/priority + LLM-generated reasoning | 1d | Medium | Yes — verify task fields populated |
| **4. Finalize stages** | `magic_link` (60 min TTL) + `inbox_message` (JSONB property, no schema migration) + embed magic link in completion email | 0.5d | Low | Yes — visible in completion email |
| **5. Cleanup cron** | Sweep `onboarding_status='running'` rows older than 10min | 0.25d | Low | Yes — manual trigger test |

**Total: ~5.75 days** of focused work. No new infrastructure required.

---

## Phase 0 — Foundation (refactor + drops + adds + scope)

### Goal
Restructure onboarding into orchestrator + 3 strategy classes. Apply contained removals (archetype stage, callHaiku rename) and additions (header capture, name capture). Scope per-journey enrichment.

### Files to create
| File | Purpose |
|---|---|
| `src/lib/services/onboarding/orchestrator.ts` | Pipeline runner — drives stage state machine, hosts watchdog + emitters |
| `src/lib/services/onboarding/strategies/base.strategy.ts` | Shared stages (heartbeat, persist_context, name_company, provision_infrastructure, send_startup_email, send_completion_email, celebrate, etc.) |
| `src/lib/services/onboarding/strategies/build-idea.strategy.ts` | Build My Idea: GeoIP-only enrichment, refine_idea, product-research |
| `src/lib/services/onboarding/strategies/grow-company.strategy.ts` | Grow My Company: GeoIP-only enrichment, fetch_business_url, distribution-research |
| `src/lib/services/onboarding/strategies/surprise-me.strategy.ts` | Surprise Me: full personal enrichment + invent_idea + product-research with extra sections |
| `src/lib/services/onboarding/types.ts` | `OnboardingStage`, `PipelineContext` (per-journey idea fields), `MoodState` |
| `src/lib/services/onboarding/stages/index.ts` | Stage implementations as standalone functions |

### Files to modify
| File | Change |
|---|---|
| `src/lib/services/onboarding.service.ts` | Becomes thin re-export shim → `orchestrator.run()`. Existing stage functions migrate to `stages/`. |
| `src/lib/services/onboarding.service.ts` | DROP `runClassifyArchetype` stage + `## Archetype` memory section + `archetype` references in task/landing prompts. Keep `roadmaps.archetype` DB column for analytics (`generateRoadmap` re-classifies internally). |
| `src/lib/services/onboarding.service.ts` | RENAME `callHaiku` → `callSmallLLM` (~10 occurrences). Misleading legacy name — function actually routes to Codex 5.4. |
| `src/app/api/onboarding/route.ts` | ADD: capture `Accept-Language` and `User-Agent` headers, pass into pipeline ctx. Update orchestrator call site. |
| `src/app/(auth)/onboarding/page.tsx` | ADD: name field input shown when `users.name` is null (post-magic-link signup) |
| Per-journey enrichment scoping | Build/Grow strategies skip `enrichLinkedIn`, `enrichTwitter`, `extractFounderAngle`. Surprise Me strategy keeps all three. |

### Acceptance
- `npm run lint && npm run build` clean
- Build My Idea founder completes onboarding without LinkedIn/Twitter API calls (verify in Tavily call counts)
- Grow My Company founder completes onboarding without LinkedIn/Twitter API calls
- Surprise Me founder still gets full personal enrichment
- Magic-link signup with no Google name prompts founder for name in onboarding form
- `Accept-Language` and `User-Agent` end up in memory Layer 1
- All 3 journeys complete identically to current behavior in their happy paths

### Out of scope (deferred to later phases)
- Activity stream and mood updates (Phase 1)
- Watchdog (Phase 2)
- Per-journey market research and idea processing (Phase 3a)
- Per-journey task creation (Phase 3b)
- Magic link + inbox stages (Phase 4)
- Cleanup cron (Phase 5)

---

## Phase 1 — Observability layer

### Goal
Every stage emits human-readable activity lines and pushes mood state. Founder dashboard renders a Polsia-style scrolling log.

### New event channels

```ts
// existing — keep
events.emit(companyId, 'onboarding_stage', { stage, status })

// NEW
events.emit(companyId, 'onboarding_activity', {
  text: string,           // "Searching web for: AI book platforms..."
  tool?: string,          // "tavily.search"
  ts: number,
})

events.emit(companyId, 'onboarding_mood', {
  mood: MoodState,        // 'researching' | 'building' | etc.
  ts: number,
})
```

### Stage interface gets

```ts
interface OnboardingStage {
  name: string
  required: boolean
  mood: MoodState
  startMsg: (ctx) => string  // emitted before execute
  doneMsg: (ctx) => string   // emitted after success
  failMsg: (err) => string   // emitted on error
  execute(ctx, tools): Promise<void>
}
```

### Orchestrator wraps every stage

```ts
async function runStage(ctx, stage) {
  emitter.activity(ctx.companyId, stage.startMsg(ctx))
  emitter.mood(ctx.companyId, stage.mood)
  watchdog.heartbeat(stage.name)

  try {
    await stage.execute(ctx, tools)
    emitter.activity(ctx.companyId, stage.doneMsg(ctx))
    emitter.stage(ctx.companyId, stage.name, 'done')
  } catch (err) {
    emitter.activity(ctx.companyId, stage.failMsg(err))
    if (stage.required) throw err
  }
}
```

### Per-stage messages (sample)

| Stage | startMsg | doneMsg |
|---|---|---|
| `enrich_founder` | "Looking up founder background..." | "Founder profile enriched ({confidence})" |
| `enrich_business` | "Researching business context..." | "Business research complete" |
| `select_strategy` | "Selecting strategy..." | "Strategy '{strategy}' saved" |
| `name_company` | "Generating company name candidates..." | "Company name updated to '{name}'" |
| `generate_market_research` | "Searching web for: {query}..." | "Market research saved" |
| `save_mission` | "Writing mission..." | "Document 'mission' saved successfully" |
| `generate_landing_page` | "Creating landing page..." | "Landing page live at {slug}.baljia.app" |
| `post_launch_tweet` | "Posting to Twitter..." | "Tweet posted" |
| `send_startup_email` | "Sending startup email..." | "Email sent from {slug}@baljia.app" |
| `celebrate` | "Celebrating!" | "Celebration triggered!" |

### Files to create
| File | Purpose |
|---|---|
| `src/lib/services/onboarding/emitter.ts` | Thin wrapper around `event.service` for activity/mood/stage |
| `src/components/dashboard/OnboardingLogStrip.tsx` | Terminal-style log component subscribing to `onboarding_activity` |

### Files to modify
| File | Change |
|---|---|
| All `stages/*.ts` | Add `startMsg`, `doneMsg`, `failMsg`, `mood` properties |
| `src/lib/services/event.service.ts` | Add `'onboarding_activity'` and `'onboarding_mood'` to event type union |
| Onboarding splash page (`src/app/onboarding/...`) | Mount `<OnboardingLogStrip />` and mascot mood-driven animation |

### Acceptance
- Open dev dashboard during onboarding → see live "Searching web for: X" log lines scroll past
- Mascot animation changes based on mood (researching → building → celebrating)
- All stage transitions emit on all 3 channels
- SSE consumer `/api/events` correctly streams the new event types

---

## Phase 2 — Watchdog

### Goal
Detect stuck/hung stages within seconds; force-kill at absolute timeout; mark `failed`.

### Files to create
| File | Purpose |
|---|---|
| `src/lib/services/onboarding/watchdog.ts` | `OnboardingWatchdog` class with `start()`, `heartbeat()`, `tick()`, `stop()` |

### Behavior

```ts
const watchdog = new OnboardingWatchdog({
  companyId,
  maxMs: 600_000,    // 10 min absolute
  stallSec: 60,      // kill if no progress for 60s
  warnSec: 10,       // emit warning if no progress for 10s
  tickSec: 5,        // check every 5s
})

watchdog.start()

// orchestrator calls this after every stage
watchdog.heartbeat(currentStageName)

// on tick, if idle > warnSec → emit activity
// on tick, if idle > stallSec → kill pipeline
// on absolute timeout → kill regardless
```

### Files to modify
| File | Change |
|---|---|
| `src/lib/services/onboarding/orchestrator.ts` | Wire watchdog start/heartbeat/stop around the pipeline run |

### Acceptance
- Force-stall test: insert `await new Promise(r => setTimeout(r, 90_000))` into a stage → watchdog kills at 60s, marks `failed`, emits `onboarding_failed` event
- Activity log shows `Watchdog: Xs since progress, active tool=<name>` warnings during the stall
- Absolute timeout: rig a stage to wait 11min → watchdog kills at 10min

### Limitations (noted, accepted)
- In-process — pod restart leaves orphan `running` rows. Phase 5 (cron sweep) addresses this.

---

## Phase 3a — Per-journey idea processing + market research

### Goal
Make all 3 journeys behave fundamentally differently in idea processing AND in market research framing. Build = product research, Grow = distribution research, Surprise = product research with extra framing.

### Idea processing per journey

Each journey has its own idea-processing stage that produces a journey-specific output shape on `ctx`. Strategy classes handle the per-journey branching at the class level — no `if (journey === ...)` spread across downstream stages.

| Journey | Stage | Behavior | Output (ctx field) |
|---|---|---|---|
| **Build My Idea** | `refine_idea` | **Active transform** of vague/infeasible/oversized input into specific buildable scope. NEVER soft-fails. Always produces a buildable version. Surfaces `changes_made` in activity log. | `ctx.refinedIdea = {refined_idea, changes_made, rationale}` |
| **Grow My Company** | `fetch_business_url` | `fetch(input)` with 5s timeout, 100KB body cap, SSRF defense (block private IPs). On DNS failure (ENOTFOUND, EAI_AGAIN): catch, emit failure, fall through to Tavily search with `site:url` operator. | `ctx.businessProfile = {business_name, description, revenue_model, target_customer, existing_validation, extracted_metadata}` |
| **Surprise Me** | `invent_idea` | Codex synthesizes a buildable startup idea from founder background (LinkedIn + Twitter + location + GeoIP). Uses `getCapabilityConstraint()` to ensure invented ideas fit our platform. | `ctx.inventedIdea = {invented_idea, changes_made, rationale}` |

### Market research per journey (different intents)

The fundamental distinction: **Grow = distribution research** (PMF exists, find acquisition channels). **Build = product research** (PMF doesn't exist, find it). Surprise Me = product research like Build but with extra framing for the invented idea.

#### Tavily query patterns differ per journey

| Build (product) | Grow (distribution) | Surprise (product, invented-idea) |
|---|---|---|
| `${idea} competitors pricing 2025` | `${competitor} traffic sources SimilarWeb` | Same as Build |
| `${idea} market size TAM` | `${competitor} acquisition channels SEO content` | + `${category} timing signals 2025 2026` |
| `${idea} reviews complaints Reddit` | `${audience} communities Reddit forums` | |

#### Market research synthesized sections per journey

| Section | Build | Grow | Surprise |
|---|---|---|---|
| Market Overview | ✅ | — | ✅ |
| Why Now | ✅ | — | ✅ |
| Current Positioning (existing biz) | — | ✅ | — |
| Competitor Acquisition Channels (DISTRIBUTION) | — | ✅ | — |
| Competitive Landscape | ✅ | ✅ | ✅ |
| The Opportunity (visionary gap) | ✅ | — | ✅ |
| Growth Opportunities (channels + quick wins) | — | ✅ | — |
| Recommended Actions (specific, prioritized) | — | ✅ | — |
| Idea Refinements (Surprise-specific) | — | — | ✅ |
| Why This Fits | ✅ | ✅ | ✅ |

### Stage hardening (Phase 3a additional changes)

Beyond per-journey divergence, fix existing quirks per the design principles:

| Change | Why |
|---|---|
| `runMarketResearch` persists its own output to `documents` table at end of stage | Currently relies on `runSaveMission` to save it — fix double-duty |
| `runSaveMission` no longer saves `market_research` doc | Single responsibility — each stage owns its outputs |
| Mission prompt receives FULL market research, not 400-char slice | Codex 5.4 mini handles full context fine; 400-char slice was defensive habit |
| Mission uses Codex JSON output mode | Replaces brittle regex parsing of `ONE_LINER:` / `MISSION:` |
| Mission retries once with stricter prompt on parse fail before failing onboarding | LLM occasionally returns malformed output; one retry catches most |
| Regional context = GeoIP-derived dynamic (city/country passed to LLM as parameter) | NO static dictionary, NO hardcoded country. The market research and outreach prompts inject `${city}, ${country}` from GeoIP and let the LLM reason about appropriate channels/positioning. If GeoIP missing, skip regional sections — never substitute a placeholder country |

### Files to create
| File | Purpose |
|---|---|
| `src/lib/services/onboarding/stages/refine-idea.ts` | Build journey — active transform |
| `src/lib/services/onboarding/stages/fetch-business-url.ts` | Grow journey — fetch with DNS recovery + SSRF defense |
| `src/lib/services/onboarding/stages/invent-idea.ts` | Surprise Me journey — invent from background |

### Files to modify
| File | Change |
|---|---|
| Build/Grow/Surprise strategy classes | Each defines its own market-research method (different prompts, different sections, different Tavily queries) |
| `src/lib/services/onboarding/stages/market-research.ts` | Refactor — accept journey-specific section builder; persist own output |
| `src/lib/services/onboarding/stages/save-mission.ts` | Remove market_research save; switch to JSON output mode; pass full research; one retry |

### Acceptance
- Build My Idea with vague input ("an AI tool") → activity log shows `refine_idea` transformation ("Refined: AI tool → email summary assistant for solo consultants. Reason: ...")
- Grow My Company with valid URL → fetches page, extracts business profile, persists to memory Layer 1
- Grow My Company with invalid URL (e.g. `couathour.io`) → activity log shows DNS failure, falls back to Tavily site search
- Surprise Me → invented idea appears in activity log with rationale
- Market research document persists at end of `runMarketResearch` stage (not in mission stage)
- Each journey produces a different research document structure (verifiable by reading the docs)
- Mission stage no longer creates a `market_research` document
- Mission stage receives full research text in its prompt input

---

## Phase 3b — Per-journey task creation (Polsia structure)

### Goal
Apply Polsia's 3-slot task structure with engineering FIRST. Make engineering task descriptions different per journey (Build = product spec, Grow = optimization spec).

### Slot structure (universal across journeys)

| Slot | Tag | Priority | Complexity | Hours |
|---|---|---|---|---|
| 1 | `engineering` | 100 (HIGH) | 8 | 3 |
| 2 | `research` | 70 (MEDIUM) | 3 | 1 |
| 3 | `outreach` | 70 (MEDIUM) | 4 | 1 |

### Engineering task description format differs per journey

**Build / Surprise (product spec — building NEW):**
```
1. Core flow: [3-6 numbered user-facing steps]
2. Key features: [3-5 named features]
3. Tech stack: [framework + DB + critical libs]
4. Success criteria: [measurable definition of done]
5. Out of scope for v1: [explicit scope guardrails]
```

**Grow (optimization spec — improving EXISTING):**
```
1. Current state: [what exists today, what metric we're improving]
2. Hypothesis: [what's the bottleneck, what change should help]
3. Specific changes: [3-5 concrete edits to existing code/UI]
4. Measurement: [what metric improves and by how much]
5. Rollback plan: [how we revert if it makes things worse]
```

### Other Phase 3b changes

| Change | Why |
|---|---|
| LLM-generated `suggestion_reasoning` per task (replace hardcoded boilerplate) | Worker agent reads this when picking up — generic strings give zero signal |
| Soft fallback to slot-specific generic string if LLM omits reasoning (~1-2% rate) | Pipeline never fails on this; founder unaffected |
| Populate `complexity` (8/3/4) and `estimated_hours` (3/1/1) on the `tasks` row | Schema already supports these; informs worker agent's turn budget |
| `Promise.all` parallel task creation (currently sequential `for` loop) | Saves ~300ms per onboarding |

### Files to modify
| File | Change |
|---|---|
| `src/lib/services/onboarding/stages/create-starter-tasks.ts` | New prompt per Polsia format; per-journey engineering description; parallel insert |
| Build/Grow/Surprise strategy classes | Each defines its engineering task description format |

### Acceptance
- Generated engineering task description follows the 5-section spec format for the relevant journey
- Engineering task is queue_order=1 with priority=100 in DB
- Research task is queue_order=2, outreach is queue_order=3, both priority=70
- `complexity` and `estimated_hours` populated on all 3 task rows
- `suggestion_reasoning` differs per company (not boilerplate)
- 3 task creates run via `Promise.all`, not sequential

---

## Phase 4 — Finalize stages

### Goal
Add the two missing finalize stages: `magic_link` and `inbox_message`.

### `magic_link` stage

```ts
import { createMagicLink } from '@/lib/services/auth.service'

async function execute(ctx) {
  const magicUrl = await createMagicLink({
    userId: ctx.userId,
    redirectTo: `/dashboard/${ctx.slug}`,
    ttlMinutes: 60,
  })
  ctx.dashboardMagicUrl = magicUrl  // consumed by completion email
}
```

### `inbox_message` stage

**No schema migration needed** — chat is stored as `chat_sessions.messages: jsonb` (an array of message objects). Just add `kind: 'inbox'` as a property on the message object when appending to the JSONB array.

```ts
async function execute(ctx) {
  const session = await chatService.getOrCreateSession(ctx.companyId, ctx.userId)
  await chatService.appendMessage(session.id, {
    id: crypto.randomUUID(),
    session_id: session.id,
    role: 'system',
    kind: 'inbox',  // property on the JSONB message object
    content: buildInboxMarkdown(ctx),  // includes deep links to landing, tasks, docs, magic link
    created_at: new Date().toISOString(),
  })
}
```

The frontend reads `kind: 'inbox'` to render the message with a distinct visual treatment (e.g., info banner) vs regular chat messages.

### Files to create
| File | Purpose |
|---|---|
| `src/lib/services/onboarding/stages/magic-link.ts` | New stage |
| `src/lib/services/onboarding/stages/inbox-message.ts` | New stage |

### Files to modify
| File | Change |
|---|---|
| Base strategy class | Insert `magic_link` and `inbox_message` between `generate_ceo_summary` and `send_completion_email` |
| `src/lib/services/onboarding/stages/send-completion-email.ts` | Read `ctx.dashboardMagicUrl`, embed as "View Dashboard →" CTA button in email body |
| `src/lib/services/auth.service.ts` | Verify `createMagicLink` accepts `redirectTo` + `ttlMinutes` params; if not, extend it |
| Frontend chat component | Render messages with `kind: 'inbox'` differently (info banner vs regular bubble) |

### Acceptance
- Completion email contains a "View Dashboard →" CTA with embedded magic link
- Clicking the magic link logs the founder in and lands them at `/dashboard/{slug}`
- Inbox message visible in chat with distinct visual treatment (e.g. info banner)

---

## Phase 5 — Cleanup cron

### Goal
Catch and resolve onboarding rows that got stuck in `running` due to pod restarts.

### Behavior

Cron job runs every 5 minutes:
```sql
UPDATE companies
SET onboarding_status = 'failed'
WHERE onboarding_status = 'running'
  AND updated_at < NOW() - INTERVAL '10 minutes'
```

For each row updated, emit `onboarding_failed` event with reason `'orphaned'`.

### Files to create
| File | Purpose |
|---|---|
| `src/app/api/cron/onboarding-cleanup/route.ts` | Cron endpoint, gated by `CRON_SECRET` |

### Files to modify
| File | Change |
|---|---|
| `render.yaml` | Add `*/5 * * * *` cron entry for the new endpoint |

### Acceptance
- Manually insert a row with `onboarding_status='running'` and `updated_at` 15 min ago
- Hit the cron endpoint with valid `CRON_SECRET`
- Row is updated to `failed`, event emitted, log line written

---

## Test approach

### Per-phase
- Each phase ends with a manual end-to-end run on `npm run dev` against a real test account
- `npm run lint` and `npm run build` must pass between phases (no merge with red checks)
- For Phase 1, watch the activity log render in the browser — most regressions visible there

### End-of-build smoke test (after Phase 5)
1. Build My Idea: sign up with `idea = "Newsletter automation for solo creators"`. Watch full pipeline. Verify:
   - Activity log shows ~30 readable lines
   - Mood transitions through 5+ states
   - Landing page live at `/dashboard/{slug}`
   - Both emails delivered
   - Magic link in completion email works
   - Inbox message visible in chat
2. Grow My Company: sign up with valid URL → fetch succeeds → research uses page content
3. Grow My Company: sign up with invalid URL → DNS fail logged → fallback search runs → still completes
4. Force-stall test: temporarily inject 90s sleep into a stage → watchdog kills at 60s → company marked `failed`
5. Cleanup cron: insert orphan row → cron sweeps → row marked `failed`

### What NOT to test
- Per-stage unit tests for prompt outputs (LLM responses are non-deterministic; test contract not output)
- LLM provider fallback chain (already tested in `test-codex-stream.ts` etc.)
- Email deliverability (Postmark side; verified separately)

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refactor breaks an existing edge case | Medium | High | Phase 0 is a pure rename — diff should show file moves only |
| Activity event volume overwhelms Redis | Low | Medium | Cap emissions at 1/sec per company; batch within stages |
| Watchdog kills a legitimate slow LLM call | Medium | Medium | Set `stallSec=60` (Polsia-equivalent); LLM calls already have their own 60s timeout in `llm-safety` |
| Magic link reuse / replay | Low | High | Already mitigated in `auth.service` — single-use, time-bound, scoped to user |
| `fetch_business_url` hits malicious endpoint | Medium | Medium | 5s timeout, 100KB body cap, no following redirects to private IPs (SSRF defense) |
| Orphan `running` rows accumulate | Medium | Low | Phase 5 cron handles it; secondary mitigation = idempotent CAS already prevents double-execution |
| LLM cost spikes during high-volume signups | Low | Medium | Per-onboarding ceiling ~$0.20; alert if daily LLM spend >$50 |

---

## Out of scope (deferred to later)

- Cross-company memory (Layer 3) — referencing founder's prior companies in research. Useful for repeat founders; v1 launch is fresh founders only.
- LLM-driven OnboardingAgent rewrite (Polsia "Option B" Sapiom-style) — defer until per-strategy stage count exceeds ~8 each
- Real job queue (Inngest/BullMQ) — defer until concurrent onboardings sustained >30
- Activity log persistence to DB (currently pub/sub only) — add when debugging completed runs becomes painful
- Per-stage retry policy with backoff — current "abort on first failure" is acceptable
- Cloudflare Pages / per-company landing page deployment — current DB-served wildcard model is sufficient until Engineering agent ships real per-company products

---

## See also

- [onboarding-research-and-content.md](./onboarding-research-and-content.md) — what each phase actually does
- `CLAUDE.md` § "11 Locked Build Decisions" — non-negotiable architectural choices
- `src/lib/services/onboarding.service.ts` — current (pre-refactor) implementation
- `src/lib/services/event.service.ts` — pub/sub infrastructure
- `src/lib/agents/watchdog.ts` — worker watchdog (template for onboarding watchdog)
