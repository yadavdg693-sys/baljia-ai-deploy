# Onboarding rewrite: 7-phase refactor + audit fixes + smoke-test-verified

**Open PR at:** https://github.com/yadavdg693-sys/Balaji/pull/new/onboarding-rewrite

**Base:** `main`
**Compare:** `onboarding-rewrite`

---

## Summary

Full rewrite of the onboarding pipeline from a 1425-LOC monolith into an orchestrator + 3 strategy classes + shared atoms architecture. Implements every locked decision from `.claude/memory/` (per-journey enrichment, per-journey idea shapes, per-journey market research JSON schemas, 3-section Polsia mission, CEO-framework-inheriting task creation, GeoIP-driven regional context with zero hardcoded countries, magic link CTA, cleanup cron).

**End-to-end smoke-test verified**: Build journey 35/35 passed, Grow journey 35/35 passed.

## What changed (11 commits)

| # | Commit | Summary |
|---|---|---|
| 1 | `cd65325` | Pre-rewrite: cleanup parked code + onboarding spec docs + 7-phase plan |
| 2 | `b348a03` | **Phase 0** — Foundation (orchestrator + 3 strategies + ~20 shared atoms) |
| 3 | `c90dd91` | **Phase 1** — Observability (activity/mood/cost channels + log strip UI) |
| 4 | `18537e6` | **Phase 2** — Watchdog (60s stall / 600s absolute / 5s tick) |
| 5 | `b6ce376` | **Phase 3a** — Per-journey idea processing + market research (3 JSON schemas) + 3-section mission |
| 6 | `fc71773` | **Phase 3b** — Task creation inheriting CEO framework (capabilities + 10 Skills + Polsia field values) |
| 7 | `0b8a9ce` | **Phase 4** — Magic link (60min TTL) + inbox message + completion-email CTA |
| 8 | `477331c` | **Phase 5** — Cleanup cron (sweeps stuck onboarding rows >10min) |
| 9 | `07be666` | Audit fixes: wire cost tracking (ALS) + STAGE_ORDER completeness + single SSE stream |
| 10 | `abecd41` | Smoke test + fix: upsert memoryLayers row (pre-existing bug surfaced by smoke test) |
| 11 | `cbb482d` | Remove CI workflow (PAT lacks `workflow` scope) |

## Architecture

```
src/lib/services/onboarding/
├── orchestrator.ts              # entry — CAS claim, selectStrategy, watchdog, top-level catch
├── types.ts                     # OnboardingStage, PipelineContext, per-journey shapes
├── stage-runner.ts              # stage() wrapper — emit + retry + optional + ALS + watchdog tick
├── context.ts                   # AsyncLocalStorage for auto cost attribution
├── watchdog.ts                  # 60s stall + 600s absolute
├── strategies/
│   ├── build-idea.strategy.ts
│   ├── grow-company.strategy.ts
│   └── surprise-me.strategy.ts
├── shared/                      # ~20 composable stage atoms
│   ├── headers.ts               # leanHeader (Build/Grow) vs fullHeader (Surprise)
│   ├── refine-idea.ts / fetch-business-url.ts / invent-idea.ts
│   ├── market-research-build.ts / -grow.ts / -surprise.ts / -render.ts
│   ├── mission-3-section.ts
│   ├── create-starter-tasks.ts  # CEO framework inheriting
│   ├── generate-magic-link.ts / send-inbox-message.ts
│   ├── tracked-calls.ts         # ALS-wrapped Tavily + sendEmail for cost attribution
│   └── …etc
└── llm/
    └── small-llm.ts             # callSmallLLM (renamed from callHaiku) + JSON-mode helper
```

## Smoke test evidence

**Build journey** (`scripts/smoke-test-onboarding.ts build_my_idea`):
- Pipeline completed in 238.9s
- Company named "Mocknote" (LLM-generated from input)
- 4507-char market research report with 4 named competitors + 3 first_priorities
- 3 tasks created with Polsia field values (priority 100/70/70, complexity 8/3/4, hours 3/1/1)
- Cost event: llm_calls=6, tavily_calls=3 (proves tracked-calls wiring is live)
- 35/35 assertions passed

**Grow journey** (`--url https://linear.app`):
- Pipeline completed cleanly
- Company named "Planaut"
- `fetch_business_url` successfully extracted Linear's metadata + synthesized BusinessProfile
- 8752-char distribution-focused market research (denser Grow format)
- 35/35 assertions passed

**Surprise journey** (`surprise_me` — default user "Paul Graham" for realistic Tavily enrichment):
- Pipeline completed cleanly
- Company named "Partnerloom"
- Invented idea: *"A web app for technical founders of pre-seed AI and developer-tools startups..."* (grounded in founder background)
- 6459-char product-focused market research with Why Now + Idea Refinements sections
- Cost event: llm_calls=9, tavily_calls=6 (higher than Build/Grow due to fullHeader's LinkedIn/Twitter/angle enrichment)
- 35/35 assertions passed

## Known items (not blockers)

- **Postmark in sandbox** — completion email stages skip gracefully (optional). Approval request still needs to be submitted on Postmark dashboard (DKIM/SPF/Return-Path all verified today).
- **Tech debt from audit** (documented in-line):
  - SSRF defense in `fetch-business-url` checks hostname patterns but doesn't DNS-resolve + IP-check (defer)
  - `ChatMessage.kind` uses type cast for `'inbox'` (full type refactor deferred)
  - `marketResearchJson` is in-memory only between `market_research` and `create_starter_tasks` — rendered markdown persists; JSON does not
- **Pre-existing errors** in `scripts/test-bedrock.ts` (unrelated to this refactor)

## Test plan

- [x] `npx tsc --noEmit` passes for the onboarding module
- [x] Smoke test Build journey — 35/35
- [x] Smoke test Grow journey — 35/35
- [x] Smoke test Surprise journey — 35/35 (with real-name founder for Tavily enrichment)
- [ ] Full E2E once Postmark approval lands (startup + completion email delivery)
- [ ] Frontend walk-through in dev browser (log strip rendering, SSE stream, mood indicator)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
