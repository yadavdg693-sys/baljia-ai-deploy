# Frontend Craft Rules — Phase 1 Design

**Date:** 2026-05-06
**Author:** brainstormed via /superpowers:brainstorming
**Status:** Awaiting user review
**Scope:** Engineering agent (id 30) — frontend output quality only
**Effort estimate:** ~1 hour
**Source material:** [`nexu-io/open-design`](https://github.com/nexu-io/open-design) (Apache 2.0)

## 1. Problem

The Engineering agent (id 30) ships founder web apps as Git-backed Render deploys of the Next.js skeleton. The agent is technically capable of producing frontend code, but its output frequently exhibits "AI default" tells: indigo accents, two-stop hero gradients, emoji feature icons, lorem ipsum, identical hero→features→pricing→FAQ→CTA section sequences. These tells make founder apps look templated, regardless of how well the underlying functionality works.

The agent's existing system prompt already instructs it to read skill files first ([agent-factory.ts:93](../../../src/lib/agents/agent-factory.ts#L93)), but in practice, under a 200-turn watchdog and a deploy deadline, the agent often dives into coding without reading the relevant skills. Adding more skill files does not fix this — it adds more files to skip.

## 2. Hypothesis

If the highest-density frontend craft rules are inlined directly into the Engineering agent's system prompt — short enough to remain in working memory, concrete enough to be checkable — frontend output quality will visibly improve on the next task. The agent will avoid the most common AI tells without needing to fetch a skill file.

This hypothesis is testable by smoke-running an Engineering task that builds a UI page and comparing the output against a recent comparable task.

## 3. Source assessment — `nexu-io/open-design`

`nexu-io/open-design` is a 29.7k-star Apache-2.0 repo that ships:

| Asset | What | Phase 1 use |
|---|---|---|
| `craft/` (9 files) | Universal frontend craft rules — anti-ai-slop, color, typography, accessibility-baseline, animation-discipline, form-validation, state-coverage, rtl-and-bidi | **Adopt** (skip rtl-and-bidi for now) |
| `skills/` (~70 files) | Artifact-shape workflows targeting **single-file HTML output** | **Reject** — wrong output format for our Next.js skeleton |
| `design-systems/` (71 files) | Per-brand `DESIGN.md` token sets | **Defer to Phase 3** — different code path (onboarding renderer, not agent runtime) |

The craft layer is the only directly-transferable asset. Skill workflows would push our agent away from the skeleton toward inline-CSS HTML. Design systems are renderer-layer concerns, not agent-prompt concerns.

## 4. Architecture

Phase 1 is a single-file change to [`src/lib/agents/agent-factory.ts`](../../../src/lib/agents/agent-factory.ts) plus vendored content under `.claude/skills/craft-frontend/`.

```
.claude/skills/craft-frontend/         ← NEW directory
├── SKILL.md                            ← index, ~30 lines
├── README.md                           ← attribution + upstream link
├── anti-ai-slop.md                     ← vendored from OD craft/
├── color.md                            ← vendored
├── typography.md                       ← vendored
├── state-coverage.md                   ← vendored
├── form-validation.md                  ← vendored
├── accessibility-baseline.md           ← vendored
└── animation-discipline.md             ← vendored

src/lib/agents/agent-factory.ts         ← MODIFIED (Engineering prompt only)
  └── Engineering agent prompt gets:
      - new "Frontend Quality Bar" section (~80 lines)
      - new row in skill matrix table → craft-frontend
```

No new tools. No code-path changes. No DB writes. No changes to non-Engineering agents. No changes to onboarding-time landing renderer.

## 5. Components

### 5.1 Vendored craft skill

Directory: `.claude/skills/craft-frontend/`

Files vendored from upstream (each gets a 3-line attribution header pointing to upstream commit URL + Apache-2.0 LICENSE link):

- `anti-ai-slop.md` — 7 P0 cardinal sins, 4 P1 soft tells, polish tells, "soul" rule
- `color.md` — color theory, palette construction
- `typography.md` — type pairing, scale, hierarchy
- `state-coverage.md` — every interactive element needs hover/focus/disabled/loading
- `form-validation.md` — inline errors, success affordances, async validation patterns
- `accessibility-baseline.md` — WCAG floor (contrast, focus-visible, semantic HTML)
- `animation-discipline.md` — duration/easing budgets, what to animate

Skipped: `rtl-and-bidi.md` (founder market is currently LTR; revisit if/when we expand).

Adaptation pass during vendoring: where OD references `DESIGN.md` (their per-artifact token contract), rewrite to reference our skeleton's `globals.css` CSS variables and `tailwind.config.ts` keys. Where OD references `data-od-id` (their comment-mode tagging), strip — we don't have comment mode. Where OD references their `lint-artifact.ts` (auto-enforcement), rewrite as guidance until Phase 4 is decided.

### 5.2 SKILL.md (skill index)

`.claude/skills/craft-frontend/SKILL.md` is ~30 lines. It exists so `list_skills` surfaces the directory and `read_skill('craft-frontend')` returns a useful index. The body is a one-paragraph orientation plus a table mapping situations → which file in this directory to read next.

### 5.3 Inlined "Frontend Quality Bar" prompt section

Inserted into [`src/lib/agents/agent-factory.ts`](../../../src/lib/agents/agent-factory.ts) inside the Engineering agent's system prompt, immediately after the existing Rules section and before the prompt close. Approximate length: 80 lines. Content:

**P0 — non-negotiable, do not ship if any of these are present:**
- No Tailwind default indigo as accent. Specifically: never use `#6366f1`, `#4f46e5`, `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`, or `#a855f7` as a primary or accent color. Use the shadcn/ui CSS tokens already defined in the skeleton's `app/globals.css` (`--primary`, `--accent`, `--ring`, etc.) — these are referenced via Tailwind classes like `bg-primary` and `text-accent-foreground`. Never hardcode hex.
- No two-stop "trust" gradients on hero (purple→blue, blue→cyan, indigo→pink). A flat surface plus intentional typography wins.
- No emoji as feature icons (`✨`, `🚀`, `🎯`, `⚡`, `🔥`, `💡` inside headers, buttons, list items, or icon classes). Use 1.6–1.8px-stroke monoline SVG with `currentColor` (lucide-react ships in the skeleton).
- No sans-serif on display text when the brand binds a serif. If the skeleton's `app/layout.tsx` declares a display font (`next/font` import), use it on h1/h2; do not hardcode `system-ui` or `Inter`.
- No "rounded card with colored left-border accent" tile shape — drop either the radius or the left border.
- No invented metrics ("10× faster", "99.9% uptime", "3× more productive"). Either pull from a real source or use a labelled placeholder.
- No filler copy (`lorem ipsum`, `feature one / two / three`, `placeholder text`, `sample content`). Empty sections are composition problems, not copy problems.

**P1 — soft tells, fix before finishing:**
- No standard "Hero → Features → Pricing → FAQ → CTA" sequence with zero variation. Introduce one unconventional section (full-bleed testimonial quote, comparison-against-status-quo pricing, inline mini-product-demo).
- No external placeholder image CDNs (`unsplash.com`, `placehold.co`, `placekitten.com`, `picsum.photos`). Use the skeleton's placeholder convention.
- More than ~12 raw hex values outside `:root` means tokens were not honoured.
- Accent CSS variable used 6+ times in a single rendered screen — cap at 2 visible uses per screen.

**Soul rule:** Aim for ~80% proven patterns + ~20% distinctive choice. The 20% should live in: one bold visual move (typography, single color decision, unexpected proportion), voice and microcopy ("Start tracking" beats "Get started"), one micro-interaction the user remembers, one product-specific detail (kbd shortcut hint, status badge with product-specific phrasing).

**Pointer:** "For full ruleset and rationale, call `read_skill('craft-frontend')`."

**Completion gate:** "A landing/dashboard/page deliverable is not complete until it passes this bar. Self-check before declaring done."

### 5.4 Skill-matrix row update

The Engineering prompt already contains a "Skill matrix" table at [`agent-factory.ts:73-89`](../../../src/lib/agents/agent-factory.ts#L73). One new row added:

| Touching... | Read skill |
|---|---|
| Frontend craft / state coverage / form a11y / why does my UI look AI-default | craft-frontend |

## 6. Data flow

Unchanged. Same agent loop, same tool registry, same DB writes. Only system-prompt content and `.claude/skills/` filesystem content differ. No prompt cache changes beyond the one-time invalidation that happens any time the Engineering prompt is edited.

## 7. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Anthropic prompt cache invalidates on next call | Certain | One-time miss; cache rebuilds on second call. Not material at our volume. |
| Prompt grows from ~85 to ~165 lines | Certain | Well under any practical limit. Engineering prompt has plenty of headroom. |
| Inlined rules contradict shadcn/Tailwind skeleton patterns | Possible | Adaptation pass during vendoring rewrites OD-specific concepts (`DESIGN.md`, `data-od-id`) into skeleton-native language. Self-test before commit. |
| Agent still ignores the rules under pressure | Possible | Inlining is the strongest available mitigation short of enforcement. If smoke test shows ignored rules, escalate to Phase 4 (lint enforcement) — that becomes the contingency, not a roadmap item. |
| Vendoring upstream content invites license drift | Low | Apache 2.0 explicitly permits derivative works with attribution. Each vendored file carries a header citing upstream URL + commit + LICENSE. |

## 8. Testing

Three checks before declaring Phase 1 done:

1. **Self-test** — read the assembled Engineering prompt end-to-end as if I were the agent. Confirm: rules are unambiguous; no rule contradicts another rule; no rule contradicts the existing skeleton conventions; pointers (`read_skill('craft-frontend')`) resolve to actual files.
2. **Smoke test** — trigger one real Engineering task that builds a frontend page (e.g., a landing or dashboard for a test company). Eyeball the diff against a recent comparable task. Check explicitly for: no indigo accent, no two-stop hero gradient, no emoji icons in headers, no lorem ipsum, accent CSS variable used ≤2 times per screen.
3. **Regression check** — `npm test` still green (the 96 CEO tool unit tests don't exercise the worker prompt, but verify nothing breaks).

Smoke test is the only one that produces a quality signal. Items 1 and 3 are guardrails.

## 9. Success criterion

The smoke-tested page output, side-by-side with a recent comparable page, shows at least three of the seven P0 sins eliminated and at least one P1 soft tell addressed. If yes → Phase 1 succeeded; consider scheduling Phase 2. If no → reframe the rules before doing Phase 2; Phase 4 (enforcement) becomes the next bet.

## 10. Out of scope (Phase 1)

These are deliberately deferred. Each gets its own brainstorm later if Phase 1 succeeds:

- **Phase 2** — write new skeleton-aware workflow skills (`skeleton-landing`, `skeleton-dashboard`, `skeleton-page`). Don't port OD's HTML-artifact skills.
- **Phase 3** — extract palette/font/spacing tokens from ~8 OD design systems into TypeScript objects in [`src/lib/services/onboarding/shared/landing-design-tokens.ts`](../../../src/lib/services/onboarding/shared/landing-design-tokens.ts). Onboarding-time landing renderer concern, not agent runtime.
- **Phase 4** — port OD's `lint-artifact.ts` regex list into a post-deploy verification step. Pull deployed HTML via `check_url_health`'s URL, grep for P0 patterns, fail verification if any hit.
- No changes to non-Engineering agents (Twitter, MetaAds, Browser, Support, Research, Data, ColdOutreach, CEO).
- No changes to onboarding-time structured-JSON landing renderer.
- No new tools, no new DB columns, no new agent IDs.

## 11. Implementation outline

The implementation plan (produced by `writing-plans` skill after this spec is approved) will cover:

1. Create `.claude/skills/craft-frontend/` directory + README.md with attribution
2. Vendor 7 craft files from upstream with attribution headers + adaptation pass (DESIGN.md → skeleton CSS vars, drop data-od-id, drop lint-artifact references)
3. Write `SKILL.md` index file (~30 lines)
4. Edit Engineering agent prompt in `agent-factory.ts`: add skill-matrix row, add "Frontend Quality Bar" section
5. Self-test by reading the assembled prompt
6. Run `npm test` — confirm green
7. Smoke test: trigger one Engineering task, eyeball the output
8. Commit

## 12. Attribution

All vendored craft files carry an Apache 2.0 attribution header. Implementation pins the upstream URL to a specific commit SHA (resolved at vendor time, not in this spec):

```markdown
> Adapted from [nexu-io/open-design](https://github.com/nexu-io/open-design)
> craft/<filename>.md (Apache License 2.0).
> Upstream: https://github.com/nexu-io/open-design/blob/<commit-sha>/craft/<filename>.md
> Local adaptations: skeleton-native language (shadcn CSS tokens, Tailwind classes), drop data-od-id references, drop lint-artifact references.
```

A `.claude/skills/craft-frontend/README.md` carries the full Apache 2.0 NOTICE pattern: source repo, license link, and the local adaptation summary.

## Phase 1 smoke test results — 2026-05-07

**Target:** Genesis Advertising (`genesis-advertising-hen6`) — only company with a live Render service. **Three tasks** run sequentially via local `launchTask` (so the new prompt was actually in effect): SMOKE-A `/pricing`, SMOKE-B `/thanks`, SMOKE-C dashboard hero.

**Important caveat — the target was not a Next.js skeleton.** Genesis Advertising is on the legacy Express/`server.js` deploy path, not the Next.js skeleton the Frontend Quality Bar prompt assumes. The agent had to navigate this mismatch every run. So the test measures "do the rules transfer when the framework doesn't match" rather than "do the rules work in the intended skeleton."

### Run-by-run

| Run | Task | Status | Live URL | Notes |
|---|---|---|---|---|
| A | `/pricing` (3 tiers) | failed (verification_reject) | `genesis-advertising-hen6.onrender.com/pricing` ✅ HTTP 200 | Page IS live and reachable. Verifier rejected because agent built **2 tiers (Free + Pro) not 3** as requested — spec mismatch, not a craft violation. 19 turns. |
| B | `/thanks` page | failed (infra_error) | n/a | Pre-empted by cross-tenant access denied error on `render_deploy` — service ID typo (`srv-d7tjghreo...` vs `srv-d7tjgrreo...`). 0 turns. Unrelated to prompt change. |
| C | dashboard hero | failed (verification_reject) | `genesis-advertising-hen6.onrender.com/dashboard` ✅ HTTP 200 | Page IS live. Verifier rejected (reason undetermined — possibly missing CTA or signed-out probe). 20 turns. |

### Auto-grader verdict (P0 patterns on the live pages)

| Pattern | A `/pricing` | C `/dashboard` |
|---|---|---|
| Tailwind indigo hex (`#6366f1` etc.) | 0 | 0 |
| Two-stop "trust" gradients | 0 | 0 |
| Listed forbidden emoji (`✨ 🚀 🎯 ⚡ 🔥 💡`) | 0 | 0 |
| `lorem ipsum` / placeholder copy | 0 | 0 |
| External placeholder CDNs | 0 | 0 |
| Raw hex outside `:root` | 10 | 12 |

Surface-level: **clean**. Zero hits on the explicitly-named forbidden patterns.

### Eyeball check — important nuance the auto-grader missed

The `/pricing` page uses HTML-entity emoji that bypassed my regex (which only checked the 6 listed emoji):

- `&#10003;` ✓ (check mark) × 7 — inside feature `<li>` elements
- `&#11088;` ⭐ (star) × 1 — inside an `<h2>`
- `&#128218;` 📚 (books) × 1 — in nav brand

The Frontend Quality Bar rule reads: *"No emoji as feature icons. No `✨ 🚀 🎯 ⚡ 🔥 💡` inside `<h*>`, `<button>`, `<li>`, or any class containing `icon`."* The agent followed the **literal forbidden list** but violated the **spirit of the rule**. Star inside `<h2>` and check marks inside `<li>` are direct violations of the structural prohibition.

**Verdict: the agent's rule-following was shallow.** It treated the 6-emoji list as exhaustive rather than as examples of a broader prohibition.

### Verdict per the spec's success criterion

Spec §9 success criterion: "≥ 3 of 7 P0 sins eliminated AND ≥ 1 of 4 P1 soft tells addressed."

- **P0 sins demonstrably avoided** (3 of 7): no Tailwind indigo, no two-stop hero gradients, no lorem ipsum / filler copy. Real prices used (no invented metrics).
- **P0 partial / violated** (1 of 7): emoji-as-feature-icon rule — agent used different emoji (✓ ⭐ 📚) instead of the listed six.
- **P1 addressed** (1+ of 4): accent restraint reasonable on `/pricing` (gold used in brand, primary CTA, Pro tier border — ~4 visible uses; over the 2-per-screen cap but moderate).

By the spec's criterion: **PARTIAL PASS**. The rules with concrete checkable lists worked; the rule that depended on the agent inferring a broader pattern (no emoji at all in icon slots) didn't.

### Honest limitations of this smoke test

1. **Wrong framework.** Genesis Advertising is Express/server.js, not the Next.js skeleton the prompt assumes. References to `app/globals.css`, `tailwind.config.ts`, `next/font`, `lucide-react` were all inert. A clean test requires a skeleton-based founder app.
2. **No before/after comparison** on the same page. We can't say Phase 1 "improved" output — we can only say the new output is largely clean. Genesis's existing root page was already P0-clean before Phase 1.
3. **All 3 tasks failed verification.** Whether due to spec mismatch (A: 2 tiers vs 3) or infra error (B), the deliverable correctness wasn't there even though the page rendered.
4. **Auto-grader is too lenient on emoji.** Need to grep for ALL emoji codepoints in icon slots, not just the 6 listed.

### Implication for Phase 2 / 3 / 4

The shallow rule-following observation is the most important signal. The agent will follow rules that are *fully enumerable as a literal list* (specific hex codes, specific filler strings). It will route around rules that require inferring a broader pattern (no emoji as icons; introduce one unconventional section).

This makes **Phase 4 (lint enforcement) the next-most-important phase**, not Phase 2. A lint that catches "any emoji codepoint inside `<h*>|<button>|<li>|.icon`" (not just the 6 listed) closes the spirit-vs-letter gap structurally rather than relying on the agent's interpretation.

**Recommended next step:** brainstorm Phase 4 (post-deploy HTML lint) before brainstorming Phase 2 (skeleton-aware skills). Phase 2 is a "give the agent more guidance" play — but the smoke test shows guidance alone isn't sufficient when the agent can route around it. Phase 4 is structural enforcement, which is what's actually missing.

### Loose ends

- SMOKE-B's cross-tenant access denied error needs investigation — looks like an agent typo on a service ID, but worth checking `render_deploy` tool's service-ID validation.
- The `/pricing` page has a hardcoded mailto link as the Pro CTA — works but odd UX.
- The `/pricing` page brands itself "BookGen AI" not "Genesis Advertising" — the company's actual product is books, not ads. Names diverge from product. Not a Phase 1 issue, just observation.

