# Session Handoff — Landing Page Generator (April 25, 2026)

Read this when resuming work in `baljia-ai-cf`. Self-contained context.

## Where you are

**Branch:** `cloudflare-spike` (this directory: `baljia-ai-cf`).
**NOT the main `baljia-ai` directory** — that's the older Render-era code, intentionally untouched per `docs/cf-migration-plan.md`.

A prior session drifted: a session's worth of landing-page work was edited in `baljia-ai/` (main) instead of `baljia-ai-cf/` (CF). All that work has now been ported back to CF. Main has been reverted to HEAD. Don't reference main for landing-page work.

## What just landed in CF (this directory)

Two files were updated/created:

1. **`src/lib/services/onboarding/shared/landing.ts`** (637 lines) — full rewrite of the landing-page generator. Combines:
   - Structured JSON output (8 fields: `design_intent` + 7 content sections)
   - Design-token system for per-company visual identity
   - Country-as-provenance rule (no city, country only in closing/tagline)
   - Existing CF deploy plumbing (`publishLandingToSubdomain` → `deployLandingPage` → R2)
   - Founder-safety audit (`sanitizeForFounder` audit mode)
   - **NO `documents.landing_page` write** — deployed URL at `{slug}.baljia.app` is the source of truth

2. **`src/lib/services/onboarding/shared/landing-design-tokens.ts`** (212 lines, NEW) — palette × mood, font pairings, density resolver. Maps `design_intent` enum picks → CSS custom properties + Google Fonts links + dark-mode variants.

Type-check passes from inside `baljia-ai-cf`.

## The landing page format (locked decisions)

After 32-Polsia-site research + extensive iteration, the canonical Day-0 landing page is:

```
brand header → hero (headline + subhead) → what it does (3-4 cards) →
how it works (3 steps) → what makes it different (3 bullets) →
closing (headline + body) → footer
```

**Intentionally absent (don't add these — each was deliberately removed):**
- ❌ FAQ section (Polsia only had it on 6/32 sites; not canonical)
- ❌ "Why now / problem" section (only 15/32 Polsia sites had it)
- ❌ "One line about business" separate block (hero subhead handles it)
- ❌ CTA / waitlist / email capture forms (page is informational only)
- ❌ SEO bloat (canonical, OG, Twitter Cards, JSON-LD) — Day-0 page has no traffic to optimize for
- ❌ `<main>` wrapper (over-engineering)
- ❌ City mentions anywhere (city = local-market scope, not provenance)
- ❌ Phone, address, founder photo, testimonials, pricing — Day-0 has none

**Country handling (subtle):**
- Country may appear ONCE in closing.body or brand.tagline as PROVENANCE only ("Built in India", "From Berlin")
- NEVER as market scope ("India's leading X", "for Indian businesses") — explicitly banned phrases in the prompt

## Inputs the prompt uses (only these — never fabricate beyond)

- `companyName`, `slug`, `oneLiner`
- `mission` / `missionDoc` (3-section)
- `marketResearchJson` (handles all 3 journey shapes via `extractMarketFacts()`)
- `refinedIdea` / `inventedIdea` / `businessProfile.description` (whichever journey populated)
- `founderAngle` (Surprise journey only)
- `founderEnrichment.geo.country` (provenance only)

## What CF already had before this session (don't re-do)

The 12 prompt improvements + supporting infrastructure are already in CF (committed pre-session in `b454eff`):

- Confidence-tagged market stats (`TaggedStat[]`) across all 3 journeys
- `data_gaps` field surfaces honestly in prompts
- `demand_signals` field for buyer intent
- `retention_check` + `funnel_diagnosis` (Grow journey)
- Journey-aware Task 3 (BUILD→discovery, SURPRISE→validation, GROW→sales)
- Dynamic engineering complexity (5-9, LLM-assessed, clamped)
- Structured JSON handoff between mission ← market research stages
- Mission-3-section anti-redundancy rule
- CEO 10 Skills inheritance via shared `ceo-framework.ts`
- URL auto-detection in `refine-idea.ts`
- `json-mode.ts` founder-safety screening with `sanitizeFields` / `sanitizeArrayOfObjects`
- Founder-safety sanitizer at `src/lib/founder-safety/sanitize.ts`

These are NOT in main. Main is intentionally older.

## CF-specific deploy plumbing (already wired, used by landing.ts)

- `src/lib/services/landing-deploy.service.ts` — tier-dispatching: CF (R2) primary, Render legacy fallback
- `src/lib/services/cf-deploy.service.ts` — `uploadLandingHtml`, `landingHtmlExists`, `isCloudflareDeployConfigured`
- `src/lib/services/domain.service.ts` — `provisionWildcardSubdomain` (DB-only, no DNS call since `*.baljia.app` is wildcard)
- R2 path for landing pages: `founder-apps/{slug}/index.html`
- CF Worker that serves `*.baljia.app` lives in `founder-app-worker/` — reads R2 by hostname slug

## Original next step (open thread)

End-to-end onboarding test. Run a real founder signup, watch the activity log for all stages, verify:

1. Sign up with fresh email at the dev server (or use kept users: yadavdg4 / yadavdg3 / system)
2. Pick a journey (Build / Surprise / Grow)
3. Watch the activity log emit each stage
4. After completion, verify:
   - `companies` row created
   - `documents` table has `mission`, `market_research` rows (NOT `landing_page` — that's intentional)
   - Mission is real 3-section
   - Market research has competitors, demand_signals, data_gaps
   - Landing page deployed to R2 at `founder-apps/{slug}/index.html`
   - `{slug}.baljia.app` loads and serves the landing HTML via CF Worker

If any step fails → fix that, retest. If all pass → onboarding is ready.

## Standing instructions (memory) the resuming session should know

- Match Polsia first; never remove Polsia features during build
- Day-0 landing page has zero founder input — never fabricate phone/photo/testimonials/pricing
- Per-journey enrichment: personal context (LinkedIn/Twitter/founder angle) only for Surprise. Build/Grow get GeoIP only.
- Mission format = 3-section locked (Mission / What we're building / Where we're headed)
- Market research format = per-journey JSON locked (Build lean / Grow dense / Surprise has Idea Refinements)
- Task creation inherits CEO framework (single source of truth = `platform-capabilities.ts` + `ceo-framework.ts`)
- "excluded/" directory is archive — never read or cite from it

## Session-start sanity check (paste into new session)

```bash
pwd  # should be /c/Users/Vaishnavi/My_Projects/baljia-ai-cf
git rev-parse --abbrev-ref HEAD  # should be cloudflare-spike
wc -l src/lib/services/onboarding/shared/landing.ts  # 637
wc -l src/lib/services/onboarding/shared/landing-design-tokens.ts  # 212
```

If those numbers don't match, something has shifted since this handoff — re-read this file and verify.
