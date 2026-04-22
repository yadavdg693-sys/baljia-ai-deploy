# Onboarding Rewrite — 7-Phase Implementation Plan

**Branch:** `onboarding-rewrite`
**Date started:** 2026-04-20
**Total scope:** ~5.75 days of work, backend + frontend, non-stop execution
**Ambiguity policy:** Best judgment + document assumptions in commit messages

This plan is the execution contract. Each phase ends in a commit. Each commit message follows the template at §9.

---

## 1. Executive summary

Transform the current 1425-LOC `onboarding.service.ts` monolith into a clean per-journey orchestrator + strategy pattern, with observability, watchdog, per-journey idea processing, per-journey market research (JSON schemas), 3-section missions, CEO-framework-inheriting task creation, magic-link finalization, and cleanup cron.

**Journeys**: Build My Idea / Grow My Company / Surprise Me (kept as Baljia magic path).

**Key decisions already locked** (see `memory/`):
- Per-journey enrichment scope (Build/Grow = geo only; Surprise = full)
- Per-journey idea shapes (no forced unification)
- Per-journey market research schemas (Build lean / Grow dense / Surprise + Idea Refinements)
- 3-section mission format (Mission / What we're building / Where we're headed)
- Task creation inherits CEO framework (inject `getPlatformCapabilitiesPrompt()`)
- GeoIP-driven regional context EVERYWHERE (no hardcoded country)
- `first_priorities` bridges market research → tasks as strategic seed (not verbatim copy)

---

## 2. Phase overview

| Phase | Scope | Est. | Risk |
|---|---|---|---|
| **0** | Foundation — STRUCTURE + REMOVE + ADD + SCOPE | 1.0d | Low |
| **1** | Observability (activity + mood events, cost instrumentation, log strip UI) | 1.0d | Low |
| **2** | Watchdog (in-process tick, 60s stall, 600s absolute) | 0.5d | Low |
| **3a** | Per-journey idea processing + market research + persistence + 3-section mission | 1.5d | Medium |
| **3b** | Per-journey task creation inheriting CEO framework | 1.0d | Medium |
| **4** | Magic link + inbox message + embed in completion email | 0.5d | Low |
| **5** | Cleanup cron for stuck onboarding rows | 0.25d | Low |

**Critical path**: 0 → 3a → 3b. Phases 1/2/4/5 interleave cleanly.

---

## 3. Global standards (applied to all phases)

### 3.1 File organization
- New pipeline code lives under `src/lib/services/onboarding/`
- One responsibility per file
- File names: `kebab-case.ts` for services, `PascalCase.tsx` for components
- Barrel exports (`index.ts`) only where they reduce import noise meaningfully

### 3.2 Naming
- `callHaiku` → `callSmallLLM` (single rename, all call sites)
- `HAIKU_MODEL` → `SMALL_LLM_FALLBACK_MODEL`
- Stage names stay snake_case (`market_research`, not `marketResearch`) since they're event payloads

### 3.3 Error policy
- `stage()` runner supports `{ optional?: boolean, retryOnce?: boolean }` options
- Default: catastrophic (throws bubble up; onboarding marked `failed`)
- Optional stages: log warn + emit `skipped` + continue (tweets, landing page, startup email)
- Retry-once: one retry with identical prompt on transient failures (LLM 5xx, JSON parse fail)

### 3.4 Type safety
- `PipelineContext` in `types.ts` — per-journey optional fields (`refinedIdea?`, `businessProfile?`, `inventedIdea?`)
- Strategy interface: minimal `OnboardingStrategy { run(ctx): Promise<void> }` — no abstract base class
- No `any` types; use `unknown` + narrow

### 3.5 Preserving existing behavior
- API contract: `POST /api/onboarding` returns `{company_id}` (unchanged)
- Event contract: `onboarding_stage` events shape unchanged; NEW channels `onboarding_activity` and `onboarding_mood` are additive
- DB schema: NO migrations — all fields we need already exist

### 3.6 Testing cadence
- After each phase: run `npx tsc --noEmit` (type check)
- After phases 3a/3b: run `npm test` (vitest)
- No dev-server live testing during execution (user unavailable; will verify at PR review)

---

## 4. Phase 0 — Foundation

### 4.1 STRUCTURE — Refactor monolith into orchestrator + strategies

**New files** (create):

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/lib/services/onboarding/types.ts` | `OnboardingStage`, `PipelineContext`, `MoodState`, `FounderGeoData`, `FounderEnrichment` | ~80 |
| `src/lib/services/onboarding/stage-runner.ts` | `stage()` wrapper with `StageOptions` (optional, retryOnce, timeoutMs, mood) | ~60 |
| `src/lib/services/onboarding/orchestrator.ts` | Entry point — CAS claim, build ctx, selectStrategy, watchdog, top-level catch | ~100 |
| `src/lib/services/onboarding/strategies/base.strategy.ts` | `OnboardingStrategy` interface | ~15 |
| `src/lib/services/onboarding/strategies/build-idea.strategy.ts` | Build My Idea pipeline | ~50 |
| `src/lib/services/onboarding/strategies/grow-company.strategy.ts` | Grow My Company pipeline | ~50 |
| `src/lib/services/onboarding/strategies/surprise-me.strategy.ts` | Surprise Me pipeline | ~55 |
| `src/lib/services/onboarding/shared/headers.ts` | `leanHeader` (geo-only) + `fullHeader` (full personal enrichment) | ~60 |
| `src/lib/services/onboarding/shared/enrichment.ts` | `enrichGeoIP`, `enrichLinkedIn`, `enrichTwitter`, `extractFounderAngle` | ~200 |
| `src/lib/services/onboarding/shared/memory-sections.ts` | `appendMemorySection`, `persistContext` | ~80 |
| `src/lib/services/onboarding/shared/naming.ts` | `nameCompany` with 3-retry + slug collision handling | ~90 |
| `src/lib/services/onboarding/shared/infra.ts` | `provisionInfrastructure` (slug + company email) | ~60 |
| `src/lib/services/onboarding/shared/infra-group.ts` | Composite: name → provision → startup_email | ~30 |
| `src/lib/services/onboarding/shared/roadmap-group.ts` | Composite: generate_roadmap → derive_active_milestone | ~30 |
| `src/lib/services/onboarding/shared/proof-group.ts` | Composite: landing → tweet → ceo_summary → completion → diagnostics → celebrate | ~35 |
| `src/lib/services/onboarding/shared/emails.ts` | `sendStartupEmail` + `sendCompletionEmail` composers | ~180 |
| `src/lib/services/onboarding/shared/landing.ts` | `generateLandingPage` | ~80 |
| `src/lib/services/onboarding/shared/tweets.ts` | `postLaunchTweet` | ~40 |
| `src/lib/services/onboarding/shared/ceo-summary.ts` | `generateCeoSummary` — first chat message | ~70 |
| `src/lib/services/onboarding/shared/celebrate.ts` | `flushDiagnostics` + `celebrate` | ~40 |
| `src/lib/services/onboarding/llm/small-llm.ts` | `callSmallLLM` (renamed from `callHaiku`) | ~50 |

**Files to update**:
- `src/app/api/onboarding/route.ts` — single import line change

**Files to delete**:
- `src/lib/services/onboarding.service.ts` (after new structure compiles)

**Verification**:
- `npx tsc --noEmit` passes
- `grep -r "from '@/lib/services/onboarding.service'"` returns zero matches

**Commit message**: `Phase 0 — STRUCTURE: refactor onboarding monolith into orchestrator + 3 strategies + shared atoms`

### 4.2 REMOVE — Drop stale stages + rename

**Removals**:
- `runClassifyArchetype` stage removed from pipeline (archetype column stays in DB for backward compat but is no longer populated at onboarding time; roadmap service's own keyword-based classifier remains)
- `runEnrichBusiness` stage removed (duplicates market_research for Build/Surprise; replaced by `fetchBusinessUrl` for Grow in Phase 3a)
- `runSelectStrategy` stage removed (replaced by per-journey idea processing stages in Phase 3a)

**Renames** (apply across codebase):
- `callHaiku` → `callSmallLLM` (expect ~10 call sites)
- `HAIKU_MODEL` constant → `SMALL_LLM_FALLBACK_MODEL`

**Verification**:
- `grep -r "callHaiku\|HAIKU_MODEL"` returns zero matches
- `grep -r "classify_archetype\|classifyArchetype"` returns zero hits in active code paths (only `roadmap.service.ts` keeps its own `classifyArchetype` helper for internal use)

**Commit message**: `Phase 0 — REMOVE: drop classify_archetype + enrich_business + select_strategy stages; rename callHaiku to callSmallLLM`

### 4.3 ADD — Capture browser context + name field

**Backend additions**:
- `src/app/api/onboarding/route.ts` — capture `Accept-Language` and `User-Agent` from request headers; pass to pipeline as `browserLocale` and `userAgent` context fields
- `PipelineContext` gains `browserLocale: string | null` and `userAgent: string | null`
- Memory persistence: add these to Layer 1 under `## Founder Profile` for downstream use

**Frontend additions**:
- Magic-link signup form (if one exists) gets a name field; otherwise defer and document
- Check: does `src/app/(auth)/login/page.tsx` or similar capture name during magic-link? If yes, add optional name field. If no, document as follow-up

**Commit message**: `Phase 0 — ADD: capture Accept-Language + User-Agent + optional name field for magic-link signups`

### 4.4 SCOPE — Per-journey enrichment branching

Implemented via strategy class boundaries:
- `BuildIdeaStrategy.run()` calls `leanHeader(ctx)` → geo only
- `GrowCompanyStrategy.run()` calls `leanHeader(ctx)` → geo only
- `SurpriseMeStrategy.run()` calls `fullHeader(ctx)` → geo + LinkedIn + Twitter + founder angle

No `if (journey === ...)` branching in stage code. Strategy class is the branching boundary.

**Commit message**: `Phase 0 — SCOPE: per-journey enrichment via strategy boundaries (leanHeader vs fullHeader)`

---

## 5. Phase 1 — Observability

### 5.1 New event channels

**`onboarding_activity`**: human-readable activity log
```typescript
{ company_id, text: string, tool?: string, timestamp: number }
```
Examples: `"Searching web for: AI book platforms 2025 competitors"`, `"Company name updated to 'AgentDeck'"`, `"Report #N saved"`, `"Landing page live at agentdeck.baljia.app"`.

**`onboarding_mood`**: mascot state signals
```typescript
{ company_id, mood: 'listening' | 'researching' | 'building' | 'writing' | 'celebrating', stage?: string }
```

### 5.2 Emission points

Each stage emits 1-3 activity lines + optional mood transition. Added to each stage's internal code, NOT in the stage-runner (runner only emits the machine-readable `onboarding_stage` event).

### 5.3 Cost instrumentation

New helper: `src/lib/services/onboarding/shared/cost-tracker.ts`
- Tracks LLM tokens (prompt + completion), Tavily calls, email sends per stage
- Writes summary to `ctx.costs` at end of pipeline
- Emits final `onboarding_costs` event for admin observability
- No new table — stored as JSONB in a new `onboarding_costs` column on `companies` table OR in `events` table under `event_type = 'onboarding_costs'`. Default: `events` table (no migration).

### 5.4 Frontend log strip

New component: `src/components/onboarding/OnboardingLogStrip.tsx`
- Terminal-style scrolling log
- Subscribes to SSE stream `/api/events?company_id=...`
- Filters for `onboarding_activity` event type
- Auto-scrolls to bottom
- Mounted in existing onboarding status/waiting page

**Commit message**: `Phase 1: observability — onboarding_activity + onboarding_mood event channels, cost tracking, dashboard log strip`

---

## 6. Phase 2 — Watchdog

**File**: `src/lib/services/onboarding/watchdog.ts`

```typescript
class OnboardingWatchdog {
  // 5s tick, 60s stall warning, 600s absolute kill
  start(ctx: PipelineContext): void
  tick(stage: OnboardingStage): void
  stop(): void
}
```

**Integration**:
- `orchestrator.ts` creates watchdog, starts it, stops it in `finally`
- `stage-runner.ts` calls `watchdog.tick(name)` on every stage entry
- On 60s stall: `log.warn` + emit `onboarding_activity` with `"Stage stalled >60s: {name}"`
- On 600s absolute: throw `WatchdogTimeoutError` which the orchestrator catches and marks `failed`

**Env vars** (new):
- `ONBOARDING_STALL_MS` (default 60000)
- `ONBOARDING_MAX_DURATION_MS` (default 600000)
- `ONBOARDING_TICK_MS` (default 5000)

**Commit message**: `Phase 2: in-process watchdog with stall detection (60s warn) + absolute timeout (600s kill)`

---

## 7. Phase 3a — Per-journey idea processing + market research + content

### 7.1 Idea processing stages (new)

**`src/lib/services/onboarding/stages/refine-idea.ts`** (Build)
- Input: `ctx.input` (raw founder idea text)
- Output: `ctx.refinedIdea = { refined_idea, changes_made, rationale }`
- Active transform: vague/infeasible input → buildable scope
- Uses `callSmallLLM` with structured JSON output
- Emits activity: `"Refining idea: {before} → {after}"`

**`src/lib/services/onboarding/stages/fetch-business-url.ts`** (Grow)
- Input: `ctx.input` (business URL)
- Step 1: Validate URL (SSRF defense — reject localhost/private IPs/link-local)
- Step 2: `fetch()` the URL with 10s timeout; on success, extract metadata (title, meta tags, body text up to 3000 chars)
- Step 3: On DNS failure or fetch failure, fall back to Tavily `site:${url}` search
- Step 4: LLM synthesizes `ctx.businessProfile = { business_name, description, revenue_model, target_customer, existing_validation, extracted_metadata: { title, meta, body } }`
- Emits activity: `"Fetching business URL..."`, `"Extracted business profile: {name}"`

**`src/lib/services/onboarding/stages/invent-idea.ts`** (Surprise)
- Input: `ctx.founderAngle`, `ctx.enrichedFounderSummary`, geo
- Uses `getCapabilityConstraint()` from platform-capabilities to ensure idea is buildable
- Output: `ctx.inventedIdea = { invented_idea, changes_made, rationale }`
- Emits activity: `"Inventing idea from founder background..."`

### 7.2 Market research — per-journey JSON schemas

**`src/lib/services/onboarding/stages/market-research.ts`** — dispatches to journey-specific synthesis

Per-journey synthesis functions:
- `synthesizeBuildMarketResearch(ctx)` → `BuildMarketResearch` shape
- `synthesizeGrowMarketResearch(ctx)` → `GrowMarketResearch` shape
- `synthesizeSurpriseMarketResearch(ctx)` → `SurpriseMarketResearch` shape

All use OpenAI structured outputs (`response_format: { type: 'json_schema' }`) via `callSmallLLM`.

Tavily queries differ per journey (locked in `project_grow_vs_build_intent` memory).

**Storage**: persist entire JSON to `documents` table with `doc_type: 'market_research'`. Render to markdown at display time.

**Retry-once** on JSON parse fail with simplified prompt.

### 7.3 Persistence fixes

- `runMarketResearch` persists its own `market_research` document (currently `runSaveMission` does this — fix double-duty)
- `runSaveMission` no longer saves `market_research` doc
- Mission prompt receives full market research JSON (not a 400-char slice)

### 7.4 Mission stage — 3-section replacement

**`src/lib/services/onboarding/stages/save-mission.ts`**

Replaces 1-line output with:
```typescript
{
  mission: string,              // 1 sentence
  what_were_building: string,   // 2-3 sentences
  where_were_headed: string,    // 4-6 sentences with GeoIP anchoring
}
```

Per-journey framing (locked in `project_mission_format_locked` memory):
- Build/Surprise: articulate future that doesn't exist
- Grow: refine existing identity

One-liner derived from `what_were_building` first sentence.

GeoIP injection mandatory in `where_were_headed`; if GeoIP missing, use generic phrasing (no hardcoded country).

**Commit message**: `Phase 3a: per-journey idea processing + market research (3 JSON schemas) + 3-section mission + persistence fixes`

---

## 8. Phase 3b — Per-journey task creation

### 8.1 Prompt rebuild

**`src/lib/services/onboarding/stages/create-starter-tasks.ts`** — new file

- Imports `getPlatformCapabilitiesPrompt()` from `@/lib/platform-capabilities`
- Injects into prompt as "PLATFORM CAPABILITIES" section
- Inlines CEO's 10 Skills (Scope Sniffing, Pattern Matching, MVP Filtering, Failure Prediction, Constraint Budgeting, Translation) + Task Scoping rules
- Per-slot CAN/CANNOT declarations
- Per-journey engineering description:
  - Build/Surprise: 5-section product spec
  - Grow: 5-section optimization spec
- Consumes `ctx.marketResearch.first_priorities` as strategic seed (not verbatim title copy)
- 7 hard rules including self-contained descriptions + GeoIP-driven outreach channels

### 8.2 Task fields

All 3 tasks created in parallel (`Promise.all`):
- Slot order: engineering → research → outreach (queue_order 1/2/3)
- Priority: 100 / 70 / 70
- Complexity: 8 / 3 / 4
- Estimated hours: 3 / 1 / 1
- Estimated credits: 1 / 1 / 1
- Source: `'onboarding'`
- Status: `'todo'`
- Reasoning: LLM-generated worker-voiced; soft fallback to slot-specific generic on parse fail

### 8.3 Per-journey variance

Two prompt variants:
- `buildTaskPrompt.ts` (used by Build + Surprise)
- `growTaskPrompt.ts` (used by Grow — optimization spec)

**Commit message**: `Phase 3b: per-journey task creation inheriting CEO framework (capabilities + 10 Skills + Task Scoping)`

---

## 9. Phase 4 — Magic link + inbox message

### 9.1 Magic link stage

**`src/lib/services/onboarding/stages/generate-magic-link.ts`** — new file

- Uses existing `auth.service.ts` magic link generation
- 60-minute TTL
- Target: `/dashboard/{slug}`
- Stores token + metadata in existing magic-link table
- Returns URL for embedding in completion email

### 9.2 Inbox message stage

**`src/lib/services/onboarding/stages/send-inbox-message.ts`** — new file

- Appends to `chat_sessions.messages` JSONB array with `kind: 'inbox'` property
- NO schema migration (it's a JSONB additive property)
- Message body: greeting + link to dashboard + summary of what was built
- Type narrowing: frontend chat component filters by `kind`

### 9.3 Embed magic link in completion email

- Completion email body gets a new "CTA button" with magic link URL
- Link text: "Open your dashboard"
- Expires in 60 min; if founder clicks after, falls back to normal login

**Commit message**: `Phase 4: magic_link (60min TTL) + inbox_message (JSONB kind property) + embed in completion email`

---

## 10. Phase 5 — Cleanup cron

### 10.1 Cron route

**`src/app/api/cron/onboarding-cleanup/route.ts`** — new file

- Finds rows where `onboarding_status = 'running'` AND `updated_at < NOW() - INTERVAL '10 minutes'`
- Sets `onboarding_status = 'failed'` with reason `'stuck_watchdog_miss'`
- Emits `onboarding_failed` event for each
- Returns summary: `{ cleaned: number, ids: string[] }`

### 10.2 Render cron schedule

Add to `render.yaml`:
```yaml
- type: cron
  name: onboarding-cleanup
  schedule: '*/5 * * * *'  # every 5 min
  buildCommand: npm ci && npm run build
  command: curl -X POST $RENDER_EXTERNAL_URL/api/cron/onboarding-cleanup -H "x-cron-secret: $CRON_SECRET"
```

### 10.3 Auth

Cron endpoint validates `x-cron-secret` header against env var.

**Commit message**: `Phase 5: cleanup cron sweeping stuck onboarding rows older than 10min`

---

## 11. Commit message template

```
Phase N: <short one-line summary>

<paragraph describing what changed and why>

Changes:
- <file 1>: <what changed>
- <file 2>: <what changed>
- ...

Assumptions / deviations from spec:
- <assumption 1>
- <assumption 2>

Verification:
- npx tsc --noEmit → pass
- [any other verification done]

Refs:
- docs/onboarding-7-phase-implementation-plan.md §<section>
- memory/<relevant memory files>
```

---

## 12. Rollback plan

- Each phase is a single commit on `onboarding-rewrite` branch
- To roll back a phase: `git revert <commit-sha>` on branch
- To abandon the whole rewrite: `git checkout main && git branch -D onboarding-rewrite`
- Original `onboarding.service.ts` lives in `main`'s history — can be restored via `git checkout main -- src/lib/services/onboarding.service.ts`

---

## 13. Known risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | 1425-LOC monolith refactor may introduce subtle behavior changes | Preserve stage order + CAS idempotency verbatim in orchestrator |
| 2 | `callHaiku` rename spans multiple files outside onboarding | Grep across entire `src/` before renaming |
| 3 | JSON schema mode may not be supported by all providers | `callSmallLLM` fallback chain already handles this; degrade to plain JSON + regex parse on fallback |
| 4 | Watchdog kill behavior must not leave DB in inconsistent state | Watchdog only THROWS; orchestrator's `finally` handles DB cleanup |
| 5 | Frontend log strip component needs SSE connection management | Use existing event route pattern; reuse existing SSE client code if present |
| 6 | Phase 5 cron needs secret management | Use existing `CRON_SECRET` env var pattern from existing cron routes |
| 7 | Per-journey idea processing may fail on edge inputs | Each stage throws on catastrophic failure; onboarding marked failed; cleanup cron recovers stuck rows |

---

## 14. Verification checklist (end of execution)

Final pre-PR verification:
- [ ] `npx tsc --noEmit` passes on branch
- [ ] `npm test` passes (no regressions from existing tests)
- [ ] `grep -r "callHaiku\|HAIKU_MODEL"` returns zero matches
- [ ] `grep -r "onboarding.service"` returns zero matches (only `onboarding.service.ts` deletion remains)
- [ ] No hardcoded country names in any prompt string (`grep -rn "India\|Pune\|US founders"` on active code — samples in docs are acceptable)
- [ ] API contract `POST /api/onboarding` returns `{company_id}` (unchanged)
- [ ] All event channels emit (spot-check via grep for `eventService.emit`)
- [ ] Docs updated to reflect current code state

---

## 15. References

**Memory (locked decisions)**:
- `memory/project_journey_enrichment_model.md`
- `memory/project_idea_processing_active_transform.md`
- `memory/project_grow_vs_build_intent.md`
- `memory/project_per_journey_idea_shapes.md`
- `memory/project_mission_format_locked.md`
- `memory/project_market_research_constraints.md`
- `memory/project_market_research_format_locked.md`
- `memory/project_task_creation_inherits_ceo.md`

**Docs (reference material)**:
- `docs/onboarding-research-and-content.md` — per-journey patterns + mission samples + market research samples
- `docs/task-logic-details.md` — task creation prompt + CEO inheritance section
- `docs/onboarding-system-design.md` — orchestrator/strategy system design
- `docs/onboarding-implementation-plan.md` — original plan (superseded by this doc for execution)

**Code (existing, reused)**:
- `src/lib/platform-capabilities.ts` — `getPlatformCapabilitiesPrompt()` + `getCapabilityConstraint()` (inherited by CEO + onboarding tasks)
- `src/lib/agents/ceo/ceo.prompt.ts` — CEO 10 Skills + Task Scoping rules (referenced, not copied)
- `src/lib/services/event.service.ts` — event emission (dual-write Neon + Redis)
- `src/lib/services/task.service.ts` — task CRUD
- `src/lib/services/roadmap.service.ts` — roadmap generation
- `src/lib/services/memory.service.ts` — memory layer management
- `src/lib/services/document.service.ts` — document CRUD
- `src/lib/tavily.ts` — Tavily with 8-key pool rotation
- `src/lib/auth.ts` — magic link generation (Phase 4)
