# Onboarding Pipeline — System Design (Phase 0 STRUCTURE)

**Status:** Design complete, pre-implementation
**Scope:** Refactor `src/lib/services/onboarding.service.ts` (1425 LOC monolith) into orchestrator + 3 strategies + shared stages
**Date:** 2026-04-19

---

## 1. Requirements

### Functional
- Run a 19-stage async pipeline (down from 20 — `classify_archetype` is dropped)
- 3 journeys with shared infra + journey-specific divergence at known stages:
  - **Build My Idea** → refine_idea + product research + product mission + build-spec tasks
  - **Grow My Company** → fetch_business_url + distribution research + refine-existing mission + optimization tasks
  - **Surprise Me** → full personal enrichment + invent_idea + product research + product mission + build-spec tasks
- Per-journey enrichment scope: Build/Grow get GeoIP only; Surprise Me gets LinkedIn + Twitter + GeoIP + founder angle
- Per-journey idea shape (no forced unification): `refinedIdea` / `businessProfile` / `inventedIdea`
- Per-journey market research: product (Build/Surprise) vs distribution (Grow)
- Per-journey starter tasks: 3-slot Polsia structure (engineering 100/8/3hr, research 70/3/1, outreach 70/4/1)
- Fire-and-forget from `POST /api/onboarding`
- Atomic CAS idempotency guard prevents double-runs
- Each stage emits `onboarding_stage` event for SSE-driven UI

### Non-functional
| Dimension | Target |
|---|---|
| Volume (pre-launch) | 17/day, peak 5/hour |
| Volume (launch burst) | 100/day, peak 20/hour |
| Wall time (typical) | 30–90 sec |
| Wall time (hard cap) | 600 sec (10 min) |
| Marginal LLM cost | ~$0.05/onboarding |
| LLM provider order | Codex GPT-5.4 → Haiku → Gemini |
| Concurrency | Single Render instance, in-process |

### Constraints (locked)
- 3 strategies (BuildIdea / GrowCompany / SurpriseMe) — Surprise Me kept as Baljia magic
- Per-journey enrichment scope (geo-only vs full)
- Per-journey idea shapes (no forced unified contract)
- Polsia 3-slot task structure (engineering > research > outreach by priority/complexity)
- Cannot break existing API contract (`POST /api/onboarding` returns `{company_id}`)
- No DB schema migration in this phase
- No new infra (no Inngest/BullMQ yet)

---

## 2. High-Level Design

### Component diagram

```
                    ┌────────────────────────────────────┐
POST /api/onboarding│    src/app/api/onboarding/route.ts │
─────────────────►  │    (auth + validate + create co)   │
                    └──────────────┬─────────────────────┘
                                   │ runOnboardingPipeline(args)
                                   ▼
                    ┌────────────────────────────────────┐
                    │  src/lib/services/onboarding/      │
                    │  ─ orchestrator.ts                 │
                    │      • CAS claim (idempotency)     │
                    │      • build initial context       │
                    │      • selectStrategy(journey)     │
                    │      • watchdog start/stop         │
                    │      • top-level catch + mark fail │
                    └──────────────┬─────────────────────┘
                                   │ strategy.run(ctx)
                ┌──────────────────┼──────────────────┐
                ▼                  ▼                  ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │ BuildIdea    │ │ GrowCompany  │ │ SurpriseMe   │
         │  .strategy   │ │  .strategy   │ │  .strategy   │
         │              │ │              │ │              │
         │ run(ctx) =   │ │ run(ctx) =   │ │ run(ctx) =   │
         │  leanHeader  │ │  leanHeader  │ │  fullHeader  │
         │  refineIdea  │ │  fetchBizUrl │ │  inventIdea  │
         │  infraGroup  │ │  infraGroup  │ │  infraGroup  │
         │  productMR   │ │  distribMR   │ │  productMR+  │
         │  missionNew  │ │  missionRefn │ │  missionNew  │
         │  roadmapGrp  │ │  roadmapGrp  │ │  roadmapGrp  │
         │  tasksBuild  │ │  tasksGrow   │ │  tasksBuild  │
         │  proofGroup  │ │  proofGroup  │ │  proofGroup  │
         └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
                │                │                │
                └────────────────┼────────────────┘
                                 ▼
                    ┌────────────────────────────────────┐
                    │  shared/ stage atoms               │
                    │  ─ enrichment.ts (geo, li, tw)     │
                    │  ─ naming.ts (name + slug retry)   │
                    │  ─ infra.ts (provision + email rt) │
                    │  ─ memory.ts (Layer 1 sections)    │
                    │  ─ emails.ts (startup + completion)│
                    │  ─ landing.ts, tweets.ts           │
                    │  ─ ceo-summary.ts, celebrate.ts    │
                    └──────────────┬─────────────────────┘
                                   │ delegates
                                   ▼
                    ┌────────────────────────────────────┐
                    │  Existing services (unchanged)     │
                    │  task.service / roadmap.service    │
                    │  document.service / chat.service   │
                    │  event.service / company.service   │
                    │  + llm/small-llm.ts (renamed)      │
                    └────────────────────────────────────┘
```

### Directory layout

```
src/lib/services/onboarding/
├── orchestrator.ts          # entry — replaces runOnboardingPipeline
├── types.ts                 # OnboardingStage, PipelineContext, MoodState
├── stage-runner.ts          # stage() wrapper — emit + retry + optional + watchdog tick
│
├── strategies/
│   ├── build-idea.strategy.ts
│   ├── grow-company.strategy.ts
│   └── surprise-me.strategy.ts
│
├── shared/                  # journey-agnostic atoms (used by 2+ strategies)
│   ├── headers.ts           # leanHeader (Build/Grow), fullHeader (Surprise)
│   ├── enrichment.ts        # geo, linkedin, twitter, founder-angle
│   ├── memory-sections.ts   # appendMemorySection + persistContext
│   ├── naming.ts            # name + slug retry loop (3 attempts)
│   ├── infra.ts             # provisionInfrastructure + email routing
│   ├── infra-group.ts       # composite: name → provision → startup_email
│   ├── roadmap-group.ts     # composite: generate → derive_milestone
│   ├── proof-group.ts       # composite: landing → tweet → ceo_summary → completion → diagnostics → celebrate
│   ├── emails.ts            # startup + completion email composers
│   ├── landing.ts           # HTML landing page generator
│   ├── tweets.ts            # launch tweet (Late.dev)
│   ├── ceo-summary.ts       # first chat message
│   └── celebrate.ts         # final emit + status update
│
└── llm/
    ├── small-llm.ts         # callSmallLLM (renamed callHaiku)
    └── json-mode.ts         # structured-output helper (Phase 3a use)
```

### Why this organization

- **Strategy class = pipeline manifest.** Each strategy's `run(ctx)` reads top-to-bottom as the journey's recipe. Divergence is visible at a glance.
- **Composite helpers (`leanHeader`, `infraGroup`, `proofGroup`) DRY the shared phases** without flattening the per-journey divergence into config flags.
- **`shared/` atoms are pure stage functions** — no class hierarchy, no inheritance. Strategies compose by importing.
- **No abstract base class.** Per the locked decision (per-journey shapes, no forced unification), inheritance would create false commonality. Composition is honest about what's shared vs. what's not.
- **`stages/` flat hierarchy avoids artificial categorization.** Files map 1:1 to behavior, not to taxonomic concepts.

---

## 3. Deep Dive

### 3.1 Orchestrator API

```typescript
// orchestrator.ts
export async function runOnboardingPipeline(
  companyId: string,
  userId: string,
  journey: OnboardingJourney,
  input: string | undefined,
  requestIp: string | null = null,
  browserTimezone: string | null = null,
): Promise<void> {
  const claimed = await tryClaimRun(companyId);   // atomic CAS
  if (!claimed) return;

  const ctx = buildInitialContext({ companyId, userId, journey, input, requestIp, browserTimezone });
  const strategy = selectStrategy(journey);

  const watchdog = new Watchdog(ctx);             // Phase 2
  watchdog.start();

  try {
    await strategy.run(ctx);
  } catch (err) {
    await markFailed(ctx, err);
  } finally {
    watchdog.stop();
  }
}

function selectStrategy(journey: OnboardingJourney): OnboardingStrategy {
  switch (journey) {
    case 'build_my_idea':   return new BuildIdeaStrategy();
    case 'grow_my_company': return new GrowCompanyStrategy();
    case 'surprise_me':     return new SurpriseMeStrategy();
  }
}
```

API surface to `route.ts` is identical — the function name, arg list, return shape, and fire-and-forget contract are preserved. Internal route imports change from `@/lib/services/onboarding.service` to `@/lib/services/onboarding/orchestrator`. Single import update.

### 3.2 Strategy interface

```typescript
// strategies/base.strategy.ts (intentionally minimal — interface only)
export interface OnboardingStrategy {
  run(ctx: PipelineContext): Promise<void>;
}
```

No abstract base class. No shared `run()` template. Each strategy is independently complete.

### 3.3 BuildIdeaStrategy example

```typescript
export class BuildIdeaStrategy implements OnboardingStrategy {
  async run(ctx: PipelineContext): Promise<void> {
    await leanHeader(ctx);                      // heartbeat → enrich_geo → persist_context
    await stage(ctx, 'refine_idea', () => refineIdea(ctx));
    await infraGroup(ctx);                      // name → provision → startup_email
    await stage(ctx, 'generate_market_research', () => productMarketResearch(ctx));
    await stage(ctx, 'save_mission', () => saveMissionNew(ctx));
    await roadmapGroup(ctx);                    // generate_roadmap → derive_active_milestone
    await stage(ctx, 'create_starter_tasks', () => createTasksBuild(ctx));
    await proofGroup(ctx);                      // landing → tweet → ceo_summary → completion → diagnostics → celebrate
  }
}
```

### 3.4 PipelineContext shape

```typescript
export interface PipelineContext {
  // Entry
  companyId: string;
  userId: string;
  journey: OnboardingJourney;
  input: string | undefined;
  requestIp: string | null;
  browserTimezone: string | null;

  // Founder identity
  founderName: string | null;
  founderEmail: string;

  // Enrichment (scope varies by journey)
  founderEnrichment: {
    geo: FounderGeoData | null;
    linkedinSummary?: string | null;       // Surprise only
    twitterBio?: string | null;            // Surprise only
    confidence: 'high' | 'medium' | 'low';
  } | null;
  enrichedFounderSummary: string | null;
  enrichedBusinessSummary: string | null;
  founderAngle?: string | null;            // Surprise primarily; others if rich geo

  // Per-journey idea shapes (exactly ONE populated per run)
  refinedIdea?: { refined_idea: string; changes_made: string; rationale: string };
  businessProfile?: BusinessProfile;
  inventedIdea?: { invented_idea: string; changes_made: string; rationale: string };

  // Company outputs
  companyName: string;
  slug: string;
  oneLiner: string;
  mission: string;
  marketResearch: string | null;

  // Roadmap derivatives
  activeMilestoneTitle: string | null;
  activeMilestoneTags: string[];

  // Diagnostics
  startedAt: number;
}
```

**Trade-off accepted:** optional fields require defensive reads in shared stages (`if (ctx.refinedIdea)` etc.). Alternative — discriminated union per journey — is rejected because it forces shared stages to be generic and makes context evolution painful. Risk mitigated by: each strategy reads only its own journey's fields; shared stages don't need to read any of the three.

**Removed from current shape:**
- `archetype` (drop with `classify_archetype` stage)
- `strategy` string (was a per-journey label; superseded by strategy class identity)

### 3.5 stage-runner.ts

```typescript
export interface StageOptions {
  optional?: boolean;       // skippable failures (warn, continue)
  retryOnce?: boolean;      // Phase 3a — transient LLM/Tavily errors
  timeoutMs?: number;       // Phase 2 — hard cap per stage
  mood?: MoodState;         // Phase 1 — emit mood on entry
}

export async function stage(
  ctx: PipelineContext,
  name: OnboardingStage,
  fn: () => Promise<void>,
  opts: StageOptions = {},
): Promise<void> {
  await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'running' });
  if (opts.mood) await eventService.emit(ctx.companyId, 'onboarding_mood', { mood: opts.mood, stage: name });

  watchdog.tick(name);   // resets stall counter

  try {
    await runWithOptions(fn, opts);
    await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'done' });
  } catch (err) {
    if (opts.optional) {
      log.warn(`Optional stage failed: ${name}`, err);
      await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'skipped' });
      return;
    }
    await eventService.emit(ctx.companyId, 'onboarding_stage', { stage: name, status: 'error', error: stringify(err) });
    throw err;
  }
}
```

Three error policies, explicit per call site:
- **Default (no opts)**: catastrophic — failure aborts pipeline
- **`optional: true`**: skippable — log + emit `skipped` + continue (used for tweet, landing, optional emails)
- **`retryOnce: true`**: recoverable transient — one retry then fail per default (Phase 3a)

### 3.6 Stage error classification

| Stage | Policy | Why |
|---|---|---|
| `heartbeat`, `persist_context`, `name_company`, `provision_infrastructure` | catastrophic | DB writes — silent failure leaves orphan state |
| `refine_idea`, `fetch_business_url`, `invent_idea` | catastrophic | The journey's defining stage |
| `save_mission`, `create_starter_tasks` | catastrophic | Required for company to be usable |
| `generate_market_research` | retryOnce | Transient Tavily/LLM failures common; one retry recovers most |
| `enrich_founder` (Surprise), `enrich_business` | optional | Best-effort — pipeline continues with degraded context |
| `enrich_geo` | optional | API quota exhaustion shouldn't block |
| `send_startup_email`, `send_completion_email` | optional | Postmark sandbox failures shouldn't break pipeline |
| `post_launch_tweet`, `generate_landing_page` | optional | Proof artifacts; pipeline succeeds without them |
| `generate_ceo_summary` | catastrophic | Founder must see CEO message in chat on first load |
| `flush_diagnostics`, `celebrate` | catastrophic | Final state transitions |

This table makes Phase 0 explicit. Currently the code mixes try/catch ad hoc — formalizing it is part of the refactor.

### 3.7 Atomic CAS (preserved from current)

```typescript
async function tryClaimRun(companyId: string): Promise<boolean> {
  const [claimed] = await db.update(companies)
    .set({ onboarding_status: 'running' })
    .where(and(
      eq(companies.id, companyId),
      inArray(companies.onboarding_status, ['initializing', 'failed']),
    ))
    .returning({ id: companies.id });
  return !!claimed;
}
```

Identical semantics to today. Phase 5 cleanup cron resets stuck `running` rows older than 10min back to `failed`, allowing retry.

### 3.8 Watchdog hook (Phase 2 — designed now)

```typescript
class Watchdog {
  private interval: NodeJS.Timeout | null = null;
  private lastTick = Date.now();
  private currentStage: OnboardingStage = 'heartbeat';

  start() {
    this.lastTick = Date.now();
    this.interval = setInterval(() => this.check(), 5000);  // 5s tick
  }

  tick(stage: OnboardingStage) {
    this.lastTick = Date.now();
    this.currentStage = stage;
  }

  private check() {
    const elapsed = Date.now() - this.lastTick;
    if (elapsed > 60_000) log.warn('Stage stalled >60s', { stage: this.currentStage });
    if (Date.now() - this.ctx.startedAt > 600_000) {
      log.error('Pipeline exceeded 600s — killing');
      throw new Error('Watchdog: 600s absolute limit exceeded');
    }
  }

  stop() { if (this.interval) clearInterval(this.interval); }
}
```

Lives in orchestrator. Stage runner calls `watchdog.tick(name)` on entry. Phase 2 work, but design is locked now so stage-runner has a stable API.

### 3.9 LLM helper

```typescript
// llm/small-llm.ts — renamed from callHaiku
export async function callSmallLLM(prompt: string, maxTokens = 256): Promise<string> {
  // Same body as today, no behavior change.
  // Provider order: Codex GPT-5.4 → Haiku → Gemini
}
```

Pure rename + re-export. All call sites updated in single mechanical pass.

---

## 4. Scale and Reliability

### 4.1 Load model

| Phase | Avg | Peak/hr | Concurrent inflight (est.) |
|---|---|---|---|
| Pre-launch (Apr–May 2026) | 17/day | 5 | 3–5 |
| Launch month (Jun 2026) | 100/day | 20 | 15–20 |
| Steady-state Y1 | 50/day | 10 | 5–10 |

Per-onboarding wall time: 30–90 sec typical (LLM-dominated, low CPU). Single Render instance comfortably holds 20 concurrent in-process Promises.

### 4.2 Cost model

| Item | Per-onboarding | Source |
|---|---|---|
| LLM calls (5 avg × $0.005) | $0.025 | Codex GPT-5.4-mini |
| Tavily searches (7 avg × $0.005) | $0.035 | 8-key pool rotation |
| GeoIP (ipinfo, 50K/mo free) | $0.000 | Free tier covers 1000+/mo |
| Postmark (2 emails) | ~$0.001 | $15/mo bucket |
| **Total marginal** | **~$0.06** | |

At 1000 founders / 2 months: ~$60 total marginal cost. Negligible.

### 4.3 Failure modes & recovery

| Failure | Detection | Recovery (Phase) |
|---|---|---|
| LLM 5xx | Provider exception | Auto-fallback in `callSmallLLM` (now) |
| LLM rate limit | Provider exception | Same fallback (now) |
| Tavily timeout | 5s AbortSignal | `retryOnce` flag (Phase 3a) |
| GeoIP quota exhausted | API returns no country | `optional` skip (now) |
| Email send failure (Postmark sandbox) | Sender exception | `optional` skip (Phase 0) |
| Process crash mid-pipeline | Stuck `running` row | Cleanup cron (Phase 5) |
| Long stage hang (e.g. LLM hang) | No `tick()` for 60s | Watchdog warn → kill at 600s (Phase 2) |
| Concurrent requests for same company | CAS fails on 2nd | Reject with current behavior (now) |
| Strategy-level catastrophic stage failure | Throws to orchestrator | `markFailed` writes `onboarding_status = 'failed'` (now) |

### 4.4 Reliability improvements unlocked by this refactor

1. **Per-stage error policy is explicit** — no more silent try/catch swallowing failures
2. **Watchdog can be added cleanly** because stage-runner is the single chokepoint
3. **Mood + cost instrumentation hooks into one place** (Phase 1)
4. **Tests can swap strategies for fixtures** — orchestrator is testable via DI
5. **New journey can be added without touching existing strategies** — open/closed

---

## 5. Trade-off Analysis

### Decisions made

| # | Decision | Chose | Alternative | Why |
|---|---|---|---|---|
| 1 | Strategy organization | 3 classes implementing minimal interface | Abstract base with template method | Per-journey divergence is real; inheritance creates false commonality (memory: per_journey_idea_shapes) |
| 2 | Stage atomicity | Each stage = own function in `shared/` | Inline in strategy, no shared module | Reusability across strategies (3 strategies × 12 shared stages); testability |
| 3 | Context type | Single mutable + per-journey optional fields | Discriminated union per journey | Optional fields keep shared stages simple; the type-safety cost is low because each strategy only reads its own journey's fields |
| 4 | Phase grouping | Composite helpers (`leanHeader`, `infraGroup`, `proofGroup`) | Repeat each stage call in each strategy | DRY for common phases, divergence remains explicit at the helper boundary |
| 5 | Directory layout | New `onboarding/` directory, delete monolith | Keep `onboarding.service.ts`, internal split | 1425 LOC monolith is hard to navigate; one-time migration cost |
| 6 | LLM helper rename | `callSmallLLM` | Keep `callHaiku` | Aligns with reality (Codex GPT-5.4 primary); reduces confusion |
| 7 | Optional stage handling | `{ optional: true }` flag | Strategy wraps in try-catch | DRY, consistent error contract, single chokepoint for instrumentation |
| 8 | Stage runner location | `stage-runner.ts` (separate from orchestrator) | Inline in orchestrator | Makes the runner directly importable by strategies without circular deps |
| 9 | Watchdog ownership | Orchestrator owns, runner ticks | Each strategy owns its own | Watchdog lifecycle = pipeline lifecycle, not strategy lifecycle |
| 10 | Migration approach | Atomic swap (delete monolith, create dir, update one import) | Gradual extraction | Only 2 files import from current monolith; cheap to do atomically |

### What I'd revisit as the system grows

- **At 1000+/day**: in-process concurrency becomes the bottleneck. Move to BullMQ/Inngest with stages as job steps. Strategy classes become job definitions — refactor remains valid.
- **At 4+ stages diverging per journey**: optional context fields multiply. Reconsider discriminated unions per journey.
- **At 4+ journeys**: composite helpers may need to become parameterized (e.g. `runHeader(ctx, { enrichmentScope })`) instead of duplicated. Easy to fold in later.
- **At 10+ external API dependencies**: stage runner needs first-class circuit breakers (today: ad hoc per-call timeouts). Wrap shared stages in `withCircuitBreaker()`.
- **When observability gets richer**: swap bespoke `eventService.emit` for OpenTelemetry spans. Stage runner is the single chokepoint to change.
- **When we want stage-level retry policies beyond `retryOnce`**: introduce explicit `RetryPolicy` (linear, exponential, jittered) on `StageOptions`.

### What this design does NOT solve

- Doesn't introduce queuing — still in-process fire-and-forget
- Doesn't add cross-stage transactions — each stage's DB writes commit independently (acceptable: failures leave clearly-flagged orphaned company rows that cleanup cron handles)
- Doesn't refactor `roadmap.service` or `task.service` — onboarding consumes their existing APIs
- Doesn't change DB schema — context is in-memory, no new tables
- Doesn't change API contract — `POST /api/onboarding` and `/api/onboarding/status` unchanged
- Doesn't add cross-strategy abstractions ("validate buildability") — per-journey shapes deliberately preserved

---

## 5b. Stage Map: Old (current monolith) → New (per-journey strategies)

The new design is not just a restructuring — it eliminates a real duplication and consolidates branching that was scattered across stages. This table makes the elimination explicit.

### Stages removed (across all journeys)

| Removed | Why |
|---|---|
| `enrich_business` | **Duplicates `market_research`** for Build/Surprise (both run Tavily on the input asking "competitors, market, pricing"). For Grow, this stage was effectively a "read your own URL" step — that responsibility moves to the new `fetch_business_url` stage. Either way, the standalone stage is gone. |
| `select_strategy` | Was a switch on `journey` that mutated `ctx.strategy` differently per journey. Replaced by per-journey idea-processing stages (`refine_idea` / `fetch_business_url` / `invent_idea`) that each produce their own context shape. The branching moves into strategy class boundaries — no more `if (journey === ...)`. |
| `classify_archetype` | Locked decision (memory `project_*`). Adds an LLM call without changing downstream behavior — archetype was used only for keyword-based roadmap categorization, which can derive equally well from the existing `journey + refined idea + market research` context. |

### Stages with per-journey divergence (new design)

| Concern | Build | Grow | Surprise |
|---|---|---|---|
| Header / enrichment | `leanHeader` (geo only) | `leanHeader` (geo only) | `fullHeader` (geo + LinkedIn + Twitter + founder angle) |
| Idea processing | `refine_idea` (LLM, scope clarification, NO Tavily) | `fetch_business_url` (read OWN site → extract business profile) | `invent_idea` (LLM from founder background, NO Tavily) |
| Market research | `productMarketResearch` (Tavily competitors + pricing) | `distributionMarketResearch` (Tavily competitor traffic / channels / conversion) | `productMarketResearch` + Why Now + Idea Refinements sections |
| Mission | `saveMissionNew` (articulate new) | `saveMissionRefine` (refine existing identity) | `saveMissionNew` (articulate new) |
| Starter tasks | `createTasksBuild` (engineering = 5-section product spec) | `createTasksGrow` (engineering = 5-section optimization spec) | `createTasksBuild` (engineering = 5-section product spec) |

### Stages identical across journeys (extracted to `shared/`)

`heartbeat` · `persist_context` · `name_company` · `provision_infrastructure` · `send_startup_email` · `generate_roadmap` · `derive_active_milestone` · `generate_landing_page` · `post_launch_tweet` · `generate_ceo_summary` · `send_completion_email` · `flush_diagnostics` · `celebrate`

### Net result on Tavily calls per onboarding

| Source | Current (Build) | New (Build) | Current (Grow) | New (Grow) | Current (Surprise) | New (Surprise) |
|---|---|---|---|---|---|---|
| `enrich_founder` (LinkedIn + Twitter) | 2 | **0** | 2 | **0** | 2 | 2 |
| `enrich_business` | 1 | **0** | 1 (own site) | 1 (via `fetch_business_url`) | 1 | **0** |
| `market_research` (competitor + pricing + local) | 3 | 3 | 3 | 3 | 3 | 3 |
| **Total** | **6** | **3** | **6** | **4** | **6** | **5** |

50% reduction on Tavily volume for Build, 33% for Grow, 17% for Surprise — without losing any signal, just by removing genuine duplication and matching enrichment scope to journey value.

---

## 6. Implementation Order (Phase 0 STRUCTURE)

Sequence designed so every step compiles cleanly and existing tests pass:

1. **Create directory + types** (`onboarding/types.ts`, `onboarding/llm/small-llm.ts` as alias of current `callHaiku`)
2. **Create stage-runner** (`onboarding/stage-runner.ts`) — same semantics as today's `stage()`, plus `optional` flag
3. **Extract shared atoms** (`onboarding/shared/*.ts`) — pure mechanical extraction from current file, no behavior change
4. **Create composite helpers** (`leanHeader`, `infraGroup`, `roadmapGroup`, `proofGroup`)
5. **Create 3 strategy classes** — each strategy's `run()` is a manifest of stage calls matching today's pipeline
6. **Create orchestrator** — wraps CAS + selectStrategy + run + catch
7. **Update import in `route.ts`** — single line: `from '@/lib/services/onboarding/orchestrator'`
8. **Delete `onboarding.service.ts`**
9. **Verify `/api/onboarding/status` import still works** (it imports types only — likely no change)
10. **Run typecheck + smoke onboarding** on dev to confirm parity

After STRUCTURE, the same directory layout supports REMOVE (drop `classify_archetype`), ADD (Accept-Language + name field), SCOPE (per-journey enrichment branching) without further reorganization.

---

## 7. Open Questions

1. **Should `BusinessProfile` (Grow's idea shape) live in `types.ts` or in a Phase 3a `business-profile.ts` module?** Lean: define as `unknown` placeholder in Phase 0, fill shape in Phase 3a when we implement `fetch_business_url`.
2. **Retry-once behavior for `generate_market_research`** — should the retry use a different prompt (e.g. simpler) or identical? Defer to Phase 3a.
3. **Watchdog absolute limit (600s)** — should we surface this to the founder or just kill silently? Lean: emit `onboarding_failed` with reason `timeout` so UI shows "took too long, please retry".
4. **Should the orchestrator emit `onboarding_started` event on CAS success?** Currently no such event exists; UI infers from first `onboarding_stage` event. Nice-to-have, not blocking.

---

## Appendix A — Files touched

**New files (~16):**
- `src/lib/services/onboarding/orchestrator.ts`
- `src/lib/services/onboarding/types.ts`
- `src/lib/services/onboarding/stage-runner.ts`
- `src/lib/services/onboarding/strategies/build-idea.strategy.ts`
- `src/lib/services/onboarding/strategies/grow-company.strategy.ts`
- `src/lib/services/onboarding/strategies/surprise-me.strategy.ts`
- `src/lib/services/onboarding/shared/headers.ts`
- `src/lib/services/onboarding/shared/enrichment.ts`
- `src/lib/services/onboarding/shared/memory-sections.ts`
- `src/lib/services/onboarding/shared/naming.ts`
- `src/lib/services/onboarding/shared/infra.ts`
- `src/lib/services/onboarding/shared/infra-group.ts`
- `src/lib/services/onboarding/shared/roadmap-group.ts`
- `src/lib/services/onboarding/shared/proof-group.ts`
- `src/lib/services/onboarding/shared/emails.ts`
- `src/lib/services/onboarding/shared/landing.ts`
- `src/lib/services/onboarding/shared/tweets.ts`
- `src/lib/services/onboarding/shared/ceo-summary.ts`
- `src/lib/services/onboarding/shared/celebrate.ts`
- `src/lib/services/onboarding/llm/small-llm.ts`

**Modified files (1):**
- `src/app/api/onboarding/route.ts` — single import line change

**Deleted files (1):**
- `src/lib/services/onboarding.service.ts`
