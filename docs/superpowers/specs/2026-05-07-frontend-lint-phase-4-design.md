# Frontend Lint — Phase 4 Design

**Date:** 2026-05-07
**Status:** Awaiting user review
**Scope:** Engineering agent (id 30) — post-deploy lint enforcement
**Effort estimate:** ~3–4 hours
**Source material:** [`nexu-io/open-design`](https://github.com/nexu-io/open-design) `apps/daemon/src/lint-artifact.ts` (Apache 2.0); Phase 1 smoke test results.
**Predecessor:** [Phase 1 spec](2026-05-06-frontend-craft-phase-1-design.md) — inlined Frontend Quality Bar into the Engineering prompt. Smoke tested 2026-05-07; verdict PARTIAL PASS.

## 1. Problem

Phase 1 inlined frontend craft rules into the Engineering agent's system prompt. The 2026-05-07 smoke test on Genesis Advertising surfaced a structural gap: **the agent follows rules backed by fully enumerable lists but routes around rules that require inferring a broader pattern.**

Concrete evidence: the rule "No emoji as feature icons. No `✨ 🚀 🎯 ⚡ 🔥 💡` inside `<h*>`, `<button>`, `<li>`, or any class containing `icon`." The agent shipped a `/pricing` page using `&#10003;` ✓ × 7 inside `<li>`, `&#11088;` ⭐ × 1 inside `<h2>`, and `&#128218;` 📚 × 1 in nav brand. Literal 6-emoji list followed; structural prohibition violated.

Spec [§9 success criterion](2026-05-06-frontend-craft-phase-1-design.md#9-success-criterion) was technically met (3 P0 sins eliminated, 1 P1 addressed), but the qualitative finding is: **prompt-level guidance is insufficient for any rule the agent can route around**.

## 2. Hypothesis

If the structurally-enforceable Frontend Quality Bar rules are checked **after** the agent ships (post-deploy lint with broad-pattern regex), the agent cannot route around them by interpreting the prompt narrowly. The verifier becomes the gatekeeper, not the prompt. Telling the agent up-front that the lint exists also changes its strategy: it knows substituting `⭐` for `✨` won't pass, so it'll reach for SVG icons (`lucide-react`) instead.

This hypothesis is testable: run the same smoke task that previously shipped emoji-in-icon-slots; observe whether the agent now ships SVG icons OR the verifier catches the violation and fails the task with a structured rejection.

## 3. Architecture

A new deterministic verifier `lintFrontend(url)` runs as part of the existing `deterministic` verification level for Engineering tasks that produce a deployed URL. Returns pass/fail/warnings. Does not introduce a new verification level.

```
Engineering task ships
  → check_url_health → 200
  → existing deterministic verifier runs
    → NEW: lintFrontend(deployed_url) called as part of deterministic chain
      → if any P0 hit: status=failed, failure_class=verification_reject
      → if only P1: status=completed, warnings recorded on the task
      → otherwise: status=completed
```

No new tools. No new agent prompts. No new DB columns. Single new verifier file + integration point + tests.

## 4. Components

### 4.1 New verifier: `src/lib/services/verifiers/frontend-lint.verifier.ts`

Pure function, ~80 LoC:

```typescript
export interface LintHit {
  category: 'P0' | 'P1';
  rule: string;          // e.g. "tailwind-indigo", "emoji-in-icon-slot"
  evidence: string;      // matched substring (truncated to 80 chars)
  count: number;         // total occurrences in the document
}

export interface LintResult {
  passed: boolean;       // false if any P0 hit
  hits: LintHit[];
  fetched_url: string;
  fetched_at: string;
  fetch_error?: string;  // present if fetch failed
}

export async function lintFrontend(url: string): Promise<LintResult>;
```

Fetch retries once with 2s backoff. On second fetch failure, returns `{ passed: true, fetch_error: '...' }` — inconclusive lint must NOT fail the task; it degrades to a warning logged on the execution.

### 4.2 Rule constants: exported from the verifier file

Single source of truth shared between lint code and prompt self-check section:

```typescript
export const TAILWIND_INDIGO_HEXES = [
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
  '#8b5cf6', '#7c3aed', '#a855f7',
] as const;

export const FILLER_COPY_NEEDLES = [
  'lorem ipsum', 'placeholder text', 'sample content',
  'feature one', 'feature two', 'feature three',
] as const;

export const PLACEHOLDER_CDNS = [
  'unsplash.com', 'placehold.co', 'placekitten.com', 'picsum.photos',
] as const;
```

The Phase 1 prompt currently hardcodes the same hex list inline. Phase 4 doesn't refactor the prompt to import these constants (prompt is a string template, not TS) — but documents the rule names so prompt-side and lint-side names stay in lockstep when edited.

### 4.3 Lint rules implemented (4 of 7 P0; 2 of 4 P1)

| Severity | Rule | Detection strategy |
|---|---|---|
| **P0-1** | Tailwind indigo | Literal grep for the 7 hex codes anywhere in the HTML body (case-insensitive). |
| **P0-2** | Two-stop "trust" gradients | Regex match on `linear-gradient` whose color stops contain a pair from `{purple, indigo}` × `{blue, cyan, pink}`, OR Tailwind class pair like `from-(purple\|indigo)-\d{3} ... to-(blue\|cyan\|pink)-\d{3}`. |
| **P0-3** | Emoji in icon slots ← *the new structural one* | Two-pass: (a) extract any `<h[1-6]>...</h[1-6]>`, `<button>...</button>`, `<li>...</li>`, or element with `class="...icon..."` block; (b) test each block for: emoji codepoint ranges (`U+1F300–U+1FAFF`, `U+2600–U+27BF`) OR HTML numeric entity references whose codepoint falls in those ranges (`&#10003;`, `&#11088;`, `&#128218;`, etc.). Inline `<svg>` and `<img>` in icon slots are explicitly NOT flagged — those are the correct patterns. |
| **P0-4** | Filler copy | Literal grep for `FILLER_COPY_NEEDLES` (case-insensitive). |
| **P1-1** | External placeholder CDNs | Literal grep for `PLACEHOLDER_CDNS`. |
| **P1-2** | Accent token overuse | Count occurrences of `bg-primary`, `text-accent`, `text-accent-foreground`, `ring-ring`, `border-primary` in body markup. Flag if total > 5 (P1 rule says "6+"). |

### 4.4 Excluded from Phase 4

- "Rounded card with colored left-border accent" — requires DOM shape parsing (radius + border-left + accent color). Defer.
- "Invented metrics" — requires fact-checking (e.g. "10× faster" with no citation). Defer; needs LLM judgment, not regex.
- "Hero → Features → Pricing → FAQ → CTA template sequence" — requires section taxonomy detection. Defer.
- ">12 raw hex outside `:root`" — could implement (count `#[0-9a-fA-F]{6}` in body, exclude `:root` block) but moderate noise risk. Defer.
- The "soul rule" — subjective. Defer permanently; this is a quality-review-level concern.

### 4.5 Integration: `src/lib/services/verification.service.ts`

Locate the existing deterministic verification path. After URL health check passes for an Engineering task with a deployed URL, call `lintFrontend(url)`. Map result:

- `result.passed === false` AND any `category === 'P0'` hit → set verification failed; pass `result.hits` into the failure context so the agent's failure handler can surface the violated rule names in the next remediation attempt
- `result.hits` of category P1 only → verification passes; record warnings on the task (extend the existing warning surface or add to execution log)
- `result.fetch_error` set → log a warning on the execution; do NOT fail the task

Implementation note: the Engineering tools list `check_url_health` is what tells us a URL is live. The verification service should invoke `lintFrontend` on the same URL.

### 4.6 Engineering prompt update

In [`src/lib/agents/agent-factory.ts`](../../../src/lib/agents/agent-factory.ts) Engineering prompt, add ONE sentence to the Frontend Quality Bar section's "Self-check before declaring complete" block:

> "**Note:** A post-deploy lint runs against your deployed URL after `check_url_health` returns 200. The emoji-in-icon-slot rule is detected by structural regex regardless of which emoji codepoint or HTML numeric entity is used — `&#10003;`, `&#11088;`, `&#128218;`, raw codepoints in U+2600–U+27BF and U+1F300–U+1FAFF are all caught. Routing around the literal 6-emoji list will not pass verification. Use `lucide-react` SVG icons or inline `<svg>` instead — those are not flagged."

This signals up front that the agent can't route around the structural rule.

### 4.7 Tests: `src/lib/services/verifiers/frontend-lint.verifier.test.ts`

Vitest suite with at minimum:

- 5 violating-fixture tests, one per implemented P0/P1 rule
- 5 clean-fixture tests, one per rule
- 1 regression test using the actual `/pricing` HTML from the Phase 1 smoke test (the one with `&#10003;` × 7 in `<li>` and `&#11088;` in `<h2>`) — must catch the emoji-in-icon-slot violation
- 1 clean shadcn-styled fixture test (no emoji, no indigo, no filler) — must pass
- 1 fetch-error test (mock `fetch()` to throw) — confirms inconclusive result rather than failure
- 1 P1-only test (placeholder CDN present, no P0 hits) — confirms `passed: true` with warnings

Tests live alongside the verifier file (same colocation pattern as `agent-factory.frontend-craft.test.ts`).

## 5. Data flow

Unchanged outside the verification step. Engineering task → tool calls (including `check_url_health`) → execution log → verification service. The new step adds one HTTP fetch + regex evaluation inside the existing deterministic verifier path. No DB schema changes. No new tools.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| False positives on legitimate pages | Tune regexes against real fixtures during implementation; lint scope strictly `<h*>`/`<button>`/`<li>`/`.icon` — does NOT flag emoji in `<select>` country flags, `<span>` decorative content, or footer attributions |
| Fetch network blip fails the task | Retry once with 2s backoff; on second failure, return inconclusive (degrade to warning, do NOT fail) |
| Rules drift between prompt + lint | Single source of truth: rule constants exported from `frontend-lint.verifier.ts`; prompt's self-check section references the same rule names verbatim; a future test could read both files and assert overlap |
| Agent disables ALL emoji including legitimate | Lint scope is targeted: only `<h*>`/`<button>`/`<li>`/`.icon` slots; flag emoji in nav country selectors etc. allowed |
| Express vs Next.js skeleton diff | Lint operates on rendered HTML, not source; works for any deploy path. The Genesis smoke pages (Express) lint correctly because they're HTML at the URL endpoint |
| Lint timeout extends task wall-clock | Hard 10s timeout on fetch + regex; total lint adds ≤15s to verification |

## 7. Testing strategy

1. **Unit:** 12+ Vitest cases covering every rule, both clean and violating, plus error paths
2. **Regression on Phase 1 smoke output:** the actual `/pricing` HTML from 2026-05-07 must be detected as failing emoji-in-icon-slot
3. **Live smoke (Task 6 of plan):** re-trigger an Engineering task that previously would ship emoji icons; confirm either (a) agent now ships SVG icons, OR (b) lint catches and fails the task with a structured rejection
4. **Regression for unrelated paths:** existing 215+ tests in `npm test` continue to pass

## 8. Success criterion

Re-running a `/pricing`-style task on Genesis Advertising (post-Phase-4) produces ONE of:

- ✅ Page lints clean (uses `lucide-react` SVG icons or HTML `<svg>`, no emoji codepoints in icon slots) — agent learned from the prompt update
- ✅ Page fails verification with rule name `emoji-in-icon-slot` and the matched evidence — lint structurally enforces

Both outcomes confirm Phase 4 works. The bad outcome is: agent ships emoji-icon-slot violations AND lint passes them — that's a false negative the regex must catch.

## 9. Out of scope (Phase 4)

- Two of seven P0 rules (rounded-card-with-left-border-accent; invented-metrics) — defer
- All four P1 soft tells beyond "accent token >5 in body" and "external placeholder CDN" — defer  
- The "soul rule" (subjective) — permanent defer
- Phase 2 (skeleton-aware skills) — handled in next brainstorm AFTER Phase 4 ships
- Phase 3 (token catalog in `landing-design-tokens.ts`) — different code path entirely; separate brainstorm
- Refactoring the Engineering prompt to import rule constants from TS — prompt is a string template, refactor not justified for one-time edits
- Updating non-Engineering agent prompts — out of scope

## 10. Effort

~3–4 hours:

| Task | Effort |
|---|---|
| Write `frontend-lint.verifier.ts` (~80 LoC, 7 rules) | 1.5 hr |
| Write tests (12 cases minimum, including Phase 1 smoke regression fixture) | 1 hr |
| Wire into `verification.service.ts` deterministic path | 30 min |
| Update Engineering prompt with the post-deploy-lint announcement (1 sentence) | 15 min |
| Live smoke test on Genesis Advertising | 30–60 min |

## 11. Implementation outline

The `writing-plans` skill will produce the formal plan after this spec is approved. High-level steps:

1. Set up verifier scaffolding + write failing tests for all 7 rules (TDD red baseline)
2. Implement `lintFrontend()` plus the 5 rule detectors (P0-1, P0-2, P0-3, P0-4, P0-5) — confirm tests pass
3. Implement P1 detectors (placeholder CDN, accent overuse) — confirm tests pass
4. Add fixture test using the captured `/pricing` HTML from Phase 1 smoke
5. Wire into `verification.service.ts`; add unit test confirming P0 hit triggers task failure
6. Update Engineering prompt with the post-deploy-lint sentence
7. Re-run smoke test on Genesis Advertising — verify either clean output or structural rejection
8. Record results in this spec's "Phase 4 smoke test results" section

## 12. Attribution

Lint regex patterns are inspired by the same `nexu-io/open-design` `lint-artifact.ts` (Apache 2.0) that informed Phase 1's craft files. Implementation is original (different stack, different regex shapes); the rule taxonomy and the canonical AI-tell list (the 7 indigo hexes, two-stop gradient pairs, etc.) carry attribution back to upstream. The new verifier file carries a header citation:

```typescript
/**
 * Frontend lint — post-deploy P0/P1 rule enforcement for Engineering agent output.
 *
 * Rule taxonomy informed by nexu-io/open-design craft/anti-ai-slop.md and
 * apps/daemon/src/lint-artifact.ts (Apache License 2.0).
 * Upstream: https://github.com/nexu-io/open-design (commit 2afb002 pinned).
 *
 * Implementation is original to Baljia.
 */
```
