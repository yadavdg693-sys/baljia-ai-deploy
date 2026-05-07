# Frontend Lint — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-deploy frontend lint that auto-rejects rule-violating Engineering agent output, closing the spirit-vs-letter gap from Phase 1's smoke test (agent shipped emoji in `<h2>`/`<li>` by routing around the literal 6-emoji forbidden list).

**Architecture:** A pure-function verifier `lintFrontend(url)` fetches the deployed HTML and applies 4 P0 + 2 P1 rule regexes. Wires into the existing `deterministic` verification level for Engineering tasks with a deployed URL. P0 hit → task fails verification with named rule + evidence. P1 only → task passes with warnings. Fetch failure → inconclusive (no fail).

**Tech Stack:** TypeScript, Vitest, Node `fetch`, no new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-07-frontend-lint-phase-4-design.md](../specs/2026-05-07-frontend-lint-phase-4-design.md)

---

## File Structure

**Create:**
- `src/lib/services/verifiers/frontend-lint.verifier.ts` — `lintFrontend(url)` + rule constants + types
- `src/lib/services/verifiers/frontend-lint.verifier.test.ts` — Vitest, ~14 cases

**Modify:**
- `src/lib/services/verification.service.ts` — call `lintFrontend` in `verifyDeterministic` after the existing `render_health_evidence` check, extract deployed URL from `check_url_health` tool calls
- `src/lib/agents/agent-factory.ts` — add ~3-line "Post-deploy lint" note to the Engineering prompt's Frontend Quality Bar self-check section

**Out of scope (per spec §9):** "rounded card with left-border accent" and "invented metrics" rules; refactoring the prompt to import TS constants; updating non-Engineering agent prompts.

---

## Task 1: Scaffold + write all failing tests (TDD red baseline)

**Files:**
- Create: `src/lib/services/verifiers/frontend-lint.verifier.test.ts`

- [ ] **Step 1: Create the directory + write the test file**

Create `src/lib/services/verifiers/frontend-lint.verifier.test.ts` with this exact content:

```typescript
// Tests for the post-deploy frontend craft lint.
// Drives the implementation in frontend-lint.verifier.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lintFrontend } from './frontend-lint.verifier';

const URL = 'https://example.test/pricing';

function mockHtml(body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })),
  );
}

function mockNetworkError(): void {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENETUNREACH'); }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lintFrontend — clean fixtures', () => {
  it('passes a clean shadcn-styled page with SVG icons', async () => {
    mockHtml(`<html><body>
      <h1>Welcome</h1>
      <button class="bg-primary"><svg width="16" height="16"><circle cx="8" cy="8" r="6"/></svg> Start</button>
      <li><svg><path d="M0 0h8v8H0z"/></svg> Real feature with concrete value</li>
      <p>Real prose, no filler.</p>
    </body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(true);
    expect(r.hits).toEqual([]);
  });
});

describe('lintFrontend — P0-1 Tailwind indigo', () => {
  it('catches #6366f1 used as accent color', async () => {
    mockHtml(`<html><body><h1 style="color:#6366f1">Hi</h1></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    const hit = r.hits.find((h) => h.rule === 'tailwind-indigo');
    expect(hit).toBeDefined();
    expect(hit?.category).toBe('P0');
    expect(hit?.evidence.toLowerCase()).toContain('#6366f1');
  });

  it('catches all 7 indigo hexes in one page', async () => {
    mockHtml(`<style>:root{--a:#6366f1;--b:#4f46e5;--c:#4338ca;--d:#3730a3;--e:#8b5cf6;--f:#7c3aed;--g:#a855f7}</style><body></body>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    const indigo = r.hits.find((h) => h.rule === 'tailwind-indigo');
    expect(indigo?.count).toBeGreaterThanOrEqual(7);
  });
});

describe('lintFrontend — P0-2 two-stop trust gradient', () => {
  it('catches linear-gradient(purple,blue)', async () => {
    mockHtml(`<html><body><div style="background:linear-gradient(135deg, purple, blue)">Hero</div></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    expect(r.hits.find((h) => h.rule === 'two-stop-gradient')).toBeDefined();
  });

  it('catches Tailwind from-indigo-500 to-pink-500 class pair', async () => {
    mockHtml(`<html><body><div class="bg-gradient-to-r from-indigo-500 to-pink-500">Hero</div></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    expect(r.hits.find((h) => h.rule === 'two-stop-gradient')).toBeDefined();
  });

  it('does NOT flag a single-color background', async () => {
    mockHtml(`<html><body><div style="background:#222">Hero</div></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.hits.find((h) => h.rule === 'two-stop-gradient')).toBeUndefined();
  });
});

describe('lintFrontend — P0-3 emoji in icon slots (the structural one)', () => {
  it('catches HTML numeric entity ⭐ inside <h2>', async () => {
    mockHtml(`<html><body><h2>Pro &#11088;</h2></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    const hit = r.hits.find((h) => h.rule === 'emoji-in-icon-slot');
    expect(hit).toBeDefined();
    expect(hit?.category).toBe('P0');
  });

  it('catches checkmark entity ✓ inside <li>', async () => {
    mockHtml(`<html><body><ul><li>&#10003; Unlimited outlines</li></ul></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    expect(r.hits.find((h) => h.rule === 'emoji-in-icon-slot')).toBeDefined();
  });

  it('catches raw codepoint ✨ inside <button>', async () => {
    mockHtml(`<html><body><button>Get started ✨</button></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    expect(r.hits.find((h) => h.rule === 'emoji-in-icon-slot')).toBeDefined();
  });

  it('catches emoji inside class*="icon"', async () => {
    mockHtml(`<html><body><span class="feature-icon">🚀</span></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    expect(r.hits.find((h) => h.rule === 'emoji-in-icon-slot')).toBeDefined();
  });

  it('does NOT flag inline <svg> in <button>', async () => {
    mockHtml(`<html><body><button><svg width="16"><circle cx="8" cy="8" r="6"/></svg> Start</button></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.hits.find((h) => h.rule === 'emoji-in-icon-slot')).toBeUndefined();
  });

  it('does NOT flag emoji in <p> body text outside icon slots', async () => {
    mockHtml(`<html><body><p>Read about ✨ on our blog</p></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.hits.find((h) => h.rule === 'emoji-in-icon-slot')).toBeUndefined();
  });

  it('catches 9 emoji hits matching the actual Phase 1 /pricing fixture pattern', async () => {
    mockHtml(`<html><body>
      <nav><a class="brand">&#128218; BookGen AI</a></nav>
      <h2>Pro &#11088;</h2>
      <ul>
        <li>&#10003; Unlimited outlines</li>
        <li>&#10003; All genres</li>
        <li>&#10003; Save to library</li>
        <li>&#10003; Priority generation</li>
        <li>&#10003; Export</li>
        <li>&#10003; Support</li>
        <li>&#10003; API access</li>
      </ul>
    </body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    const hit = r.hits.find((h) => h.rule === 'emoji-in-icon-slot');
    expect(hit?.count).toBeGreaterThanOrEqual(8); // 7 li + 1 h2; nav.brand is fine (no h*/button/li/icon class)
  });
});

describe('lintFrontend — P0-4 filler copy', () => {
  it('catches lorem ipsum', async () => {
    mockHtml(`<html><body><p>Lorem ipsum dolor sit amet</p></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    expect(r.hits.find((h) => h.rule === 'filler-copy')).toBeDefined();
  });

  it('catches "feature one / feature two"', async () => {
    mockHtml(`<html><body><h3>Feature one</h3><h3>Feature two</h3></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(false);
    expect(r.hits.find((h) => h.rule === 'filler-copy')).toBeDefined();
  });
});

describe('lintFrontend — P1-1 external placeholder CDNs', () => {
  it('flags unsplash.com and is P1 (page passes overall)', async () => {
    mockHtml(`<html><body><img src="https://images.unsplash.com/photo-1"></body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(true); // P1 only — passes overall
    const hit = r.hits.find((h) => h.rule === 'placeholder-cdn');
    expect(hit?.category).toBe('P1');
  });
});

describe('lintFrontend — P1-2 accent token overuse', () => {
  it('flags > 5 visible accent class uses', async () => {
    mockHtml(`<html><body>
      <div class="bg-primary">a</div><div class="bg-primary">b</div>
      <div class="text-accent">c</div><div class="text-accent">d</div>
      <div class="text-accent-foreground">e</div><div class="ring-ring">f</div>
    </body></html>`);
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(true); // P1 only
    expect(r.hits.find((h) => h.rule === 'accent-overuse')).toBeDefined();
  });

  it('does NOT flag at exactly 2 accent uses', async () => {
    mockHtml(`<html><body>
      <button class="bg-primary">a</button>
      <a class="text-accent">b</a>
    </body></html>`);
    const r = await lintFrontend(URL);
    expect(r.hits.find((h) => h.rule === 'accent-overuse')).toBeUndefined();
  });
});

describe('lintFrontend — fetch error handling', () => {
  it('returns inconclusive (passed:true with fetch_error) on network failure', async () => {
    mockNetworkError();
    const r = await lintFrontend(URL);
    expect(r.passed).toBe(true);
    expect(r.fetch_error).toBeDefined();
    expect(r.hits).toEqual([]);
  });

  it('retries once before giving up', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error('first attempt fails');
      return new Response('<html><body>OK</body></html>', { status: 200 });
    }));
    const r = await lintFrontend(URL);
    expect(attempts).toBe(2);
    expect(r.passed).toBe(true);
    expect(r.fetch_error).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the new test file, expect every test to fail with import error**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts
```

Expected: every test fails because `frontend-lint.verifier` does not exist yet. This is the red baseline.

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/verifiers/frontend-lint.verifier.test.ts
git commit -m "test(frontend-lint): add 17 Vitest cases for post-deploy lint

TDD red baseline. Covers:
- 1 clean shadcn-styled fixture
- P0-1 indigo (2 cases)
- P0-2 two-stop gradient (3 cases including negative)
- P0-3 emoji-in-icon-slot — 7 cases including raw codepoints, HTML
  entities, class-icon match, negative for <svg>, and a regression
  fixture mirroring the actual Phase 1 /pricing HTML emoji pattern
- P0-4 filler copy (2 cases)
- P1-1 placeholder CDN (asserts P1 not P0)
- P1-2 accent-overuse (2 cases including negative)
- fetch error handling (network failure + retry-once)"
```

---

## Task 2: Implement core verifier (types + fetch + retry)

**Files:**
- Create: `src/lib/services/verifiers/frontend-lint.verifier.ts`

- [ ] **Step 1: Confirm fetch error tests are currently failing**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "fetch error handling"
```

Expected: 2 failing tests (module not found).

- [ ] **Step 2: Write the verifier scaffold with types + fetch logic**

Create `src/lib/services/verifiers/frontend-lint.verifier.ts` with this content:

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

export const TAILWIND_INDIGO_HEXES = [
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
  '#8b5cf6', '#7c3aed', '#a855f7',
] as const;

export const FILLER_COPY_NEEDLES = [
  'lorem ipsum',
  'placeholder text',
  'sample content',
  'feature one',
  'feature two',
  'feature three',
] as const;

export const PLACEHOLDER_CDNS = [
  'unsplash.com',
  'placehold.co',
  'placekitten.com',
  'picsum.photos',
] as const;

export const ACCENT_TOKEN_CLASSES = [
  'bg-primary',
  'text-accent',
  'text-accent-foreground',
  'ring-ring',
  'border-primary',
] as const;

export interface LintHit {
  category: 'P0' | 'P1';
  rule: string;
  evidence: string;
  count: number;
}

export interface LintResult {
  passed: boolean;
  hits: LintHit[];
  fetched_url: string;
  fetched_at: string;
  fetch_error?: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 2_000;

async function fetchOnce(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'baljia-frontend-lint/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchHtmlWithRetry(url: string): Promise<{ html: string } | { error: string }> {
  try {
    const html = await fetchOnce(url);
    return { html };
  } catch (firstError) {
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    try {
      const html = await fetchOnce(url);
      return { html };
    } catch (secondError) {
      const msg = secondError instanceof Error ? secondError.message : String(secondError);
      return { error: msg };
    }
  }
}

export async function lintFrontend(url: string): Promise<LintResult> {
  const fetched_at = new Date().toISOString();
  const result = await fetchHtmlWithRetry(url);
  if ('error' in result) {
    return {
      passed: true,
      hits: [],
      fetched_url: url,
      fetched_at,
      fetch_error: result.error,
    };
  }
  const hits = runRules(result.html);
  const passed = !hits.some((h) => h.category === 'P0');
  return { passed, hits, fetched_url: url, fetched_at };
}

// Rule implementations — populated in subsequent tasks.
function runRules(_html: string): LintHit[] {
  return [];
}
```

- [ ] **Step 3: Run the fetch error tests to verify they pass**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "fetch error handling"
```

Expected: 2 passing (network failure + retry-once). Other tests still fail because rules aren't implemented.

- [ ] **Step 4: Run the clean-fixture test — should pass too**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "clean fixtures"
```

Expected: 1 passing (clean shadcn fixture has no rules to violate yet).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/verifiers/frontend-lint.verifier.ts
git commit -m "feat(frontend-lint): scaffold verifier with types + fetch retry

Pure-function lintFrontend(url) with 10s fetch timeout, single 2s retry
on failure, and inconclusive return on second failure. Rule constants
exported as single source of truth (TAILWIND_INDIGO_HEXES,
FILLER_COPY_NEEDLES, PLACEHOLDER_CDNS, ACCENT_TOKEN_CLASSES).

runRules stub returns []; subsequent tasks implement each rule."
```

---

## Task 3: Implement P0-1 (Tailwind indigo) + P0-4 (filler copy)

**Files:**
- Modify: `src/lib/services/verifiers/frontend-lint.verifier.ts`

Two simple literal-grep rules. Batched because they share the pattern.

- [ ] **Step 1: Confirm relevant tests are failing**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P0-1 Tailwind indigo|P0-4 filler copy"
```

Expected: 4 failing tests.

- [ ] **Step 2: Replace the `runRules` stub with implementations for these two rules**

Replace the existing stub:

```typescript
function runRules(_html: string): LintHit[] {
  return [];
}
```

with:

```typescript
function runRules(html: string): LintHit[] {
  const hits: LintHit[] = [];
  hits.push(...lintTailwindIndigo(html));
  hits.push(...lintFillerCopy(html));
  return hits;
}

function lintTailwindIndigo(html: string): LintHit[] {
  const lower = html.toLowerCase();
  let total = 0;
  let firstEvidence = '';
  for (const hex of TAILWIND_INDIGO_HEXES) {
    const matches = lower.match(new RegExp(hex, 'gi'));
    if (matches && matches.length > 0) {
      total += matches.length;
      if (!firstEvidence) firstEvidence = hex;
    }
  }
  if (total === 0) return [];
  return [{
    category: 'P0',
    rule: 'tailwind-indigo',
    evidence: firstEvidence,
    count: total,
  }];
}

function lintFillerCopy(html: string): LintHit[] {
  const lower = html.toLowerCase();
  let total = 0;
  let firstEvidence = '';
  for (const needle of FILLER_COPY_NEEDLES) {
    const matches = lower.match(new RegExp(needle.replace(/ /g, '\\s+'), 'g'));
    if (matches && matches.length > 0) {
      total += matches.length;
      if (!firstEvidence) firstEvidence = needle;
    }
  }
  if (total === 0) return [];
  return [{
    category: 'P0',
    rule: 'filler-copy',
    evidence: firstEvidence,
    count: total,
  }];
}
```

- [ ] **Step 3: Run the tests — should pass**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P0-1 Tailwind indigo|P0-4 filler copy"
```

Expected: 4 passing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/verifiers/frontend-lint.verifier.ts
git commit -m "feat(frontend-lint): implement P0-1 indigo + P0-4 filler copy"
```

---

## Task 4: Implement P0-2 (two-stop trust gradients)

**Files:**
- Modify: `src/lib/services/verifiers/frontend-lint.verifier.ts`

- [ ] **Step 1: Confirm gradient tests are failing**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P0-2 two-stop"
```

Expected: 2 failing (positive cases); 1 passing (negative case for single-color background).

- [ ] **Step 2: Add the gradient rule**

In `frontend-lint.verifier.ts`, add this function near `lintFillerCopy`:

```typescript
function lintTwoStopGradient(html: string): LintHit[] {
  const lower = html.toLowerCase();

  // Pattern 1: linear-gradient with named stops mixing trust palette pairs
  // Examples: linear-gradient(135deg, purple, blue), linear-gradient(to right, indigo, pink)
  const cssGradient = /linear-gradient\([^)]*\b(purple|indigo)\b[^)]*\b(blue|cyan|pink)\b[^)]*\)/g;
  const cssReverse = /linear-gradient\([^)]*\b(blue|cyan|pink)\b[^)]*\b(purple|indigo)\b[^)]*\)/g;

  // Pattern 2: Tailwind class pairs like "from-indigo-500 to-pink-500"
  const tailwindPair = /\bfrom-(purple|indigo)-\d{2,3}\b[\s\S]{0,80}?\bto-(blue|cyan|pink)-\d{2,3}\b/g;
  const tailwindReverse = /\bfrom-(blue|cyan|pink)-\d{2,3}\b[\s\S]{0,80}?\bto-(purple|indigo)-\d{2,3}\b/g;

  const matches: string[] = [];
  for (const rx of [cssGradient, cssReverse, tailwindPair, tailwindReverse]) {
    const found = lower.match(rx);
    if (found) matches.push(...found);
  }

  if (matches.length === 0) return [];
  return [{
    category: 'P0',
    rule: 'two-stop-gradient',
    evidence: matches[0].slice(0, 80),
    count: matches.length,
  }];
}
```

Then update `runRules` to call it:

```typescript
function runRules(html: string): LintHit[] {
  const hits: LintHit[] = [];
  hits.push(...lintTailwindIndigo(html));
  hits.push(...lintTwoStopGradient(html));
  hits.push(...lintFillerCopy(html));
  return hits;
}
```

- [ ] **Step 3: Run the gradient tests**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P0-2 two-stop"
```

Expected: 3 passing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/verifiers/frontend-lint.verifier.ts
git commit -m "feat(frontend-lint): implement P0-2 two-stop trust gradient detection

Catches CSS linear-gradient with purple/indigo paired against
blue/cyan/pink, plus Tailwind class pairs like from-indigo-500
to-pink-500. Tested with positive + negative fixtures."
```

---

## Task 5: Implement P0-3 (emoji in icon slots) — the structural rule

**Files:**
- Modify: `src/lib/services/verifiers/frontend-lint.verifier.ts`

This is the rule the agent routed around in Phase 1. Most complex of the bunch.

- [ ] **Step 1: Confirm emoji tests are failing**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P0-3 emoji"
```

Expected: 5 failing (positive cases — 4 violation tests + 1 regression fixture); 2 passing (negative cases for `<svg>` and `<p>` body text).

- [ ] **Step 2: Add the emoji-in-icon-slot rule**

In `frontend-lint.verifier.ts`, add this function:

```typescript
// Emoji codepoint ranges that count as "feature icon" emoji.
// U+2600–U+27BF: Miscellaneous Symbols + Dingbats (✓, ⭐, ✨, ⚡)
// U+1F300–U+1FAFF: Misc Symbols and Pictographs through Symbols Extended-A
//                  (🚀, 🎯, 🔥, 💡, 📚, etc.)
const EMOJI_CODEPOINT_RX = /[☀-➿]|[\u{1F300}-\u{1FAFF}]/u;

function isEmojiCodepoint(codepoint: number): boolean {
  return (codepoint >= 0x2600 && codepoint <= 0x27BF)
      || (codepoint >= 0x1F300 && codepoint <= 0x1FAFF);
}

// Match HTML numeric entity references like &#10003; or &#11088;
// Returns true if the decoded codepoint falls in our emoji ranges.
function containsEmojiEntity(text: string): boolean {
  const entityRx = /&#(\d+);/g;
  let m: RegExpExecArray | null;
  while ((m = entityRx.exec(text)) !== null) {
    const cp = parseInt(m[1], 10);
    if (isEmojiCodepoint(cp)) return true;
  }
  return false;
}

function blockHasEmoji(text: string): boolean {
  if (EMOJI_CODEPOINT_RX.test(text)) return true;
  if (containsEmojiEntity(text)) return true;
  return false;
}

// Strip <svg>...</svg> blocks before checking — SVG icons are the correct
// pattern and may legitimately contain unicode glyphs we don't want to flag.
function stripSvg(html: string): string {
  return html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');
}

function lintEmojiInIconSlots(html: string): LintHit[] {
  const stripped = stripSvg(html);
  let count = 0;
  let firstEvidence = '';

  // Slot patterns:
  //   <h1>...</h1> through <h6>...</h6>
  //   <button>...</button>
  //   <li>...</li>
  //   any element with class containing "icon"
  const slotPatterns: Array<{ name: string; rx: RegExp }> = [
    { name: 'heading', rx: /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi },
    { name: 'button', rx: /<button\b[^>]*>([\s\S]*?)<\/button>/gi },
    { name: 'list-item', rx: /<li\b[^>]*>([\s\S]*?)<\/li>/gi },
    // class*="icon" — match the element's content; greedy handling is fine here
    // because we only care if ANY descendant has emoji
    { name: 'icon-class', rx: /class="[^"]*icon[^"]*"[^>]*>([\s\S]*?)<\//gi },
  ];

  for (const { rx } of slotPatterns) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(stripped)) !== null) {
      const inner = m[1];
      if (blockHasEmoji(inner)) {
        count++;
        if (!firstEvidence) firstEvidence = inner.slice(0, 80).replace(/\s+/g, ' ').trim();
      }
    }
  }

  if (count === 0) return [];
  return [{
    category: 'P0',
    rule: 'emoji-in-icon-slot',
    evidence: firstEvidence,
    count,
  }];
}
```

Then update `runRules`:

```typescript
function runRules(html: string): LintHit[] {
  const hits: LintHit[] = [];
  hits.push(...lintTailwindIndigo(html));
  hits.push(...lintTwoStopGradient(html));
  hits.push(...lintEmojiInIconSlots(html));
  hits.push(...lintFillerCopy(html));
  return hits;
}
```

- [ ] **Step 3: Run the emoji tests**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P0-3 emoji"
```

Expected: 7 passing (4 violations caught, 2 negatives correctly ignored, 1 regression fixture catches 8+ emoji hits).

- [ ] **Step 4: Verify the entire P0 suite is green**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P0-"
```

Expected: 13 passing (all P0 cases across rules 1-4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/verifiers/frontend-lint.verifier.ts
git commit -m "feat(frontend-lint): implement P0-3 emoji-in-icon-slot detection

The structural rule that closes the spirit-vs-letter gap from Phase 1.
Catches:
- Raw emoji codepoints in U+2600-U+27BF + U+1F300-U+1FAFF
- HTML numeric entity refs (&#10003; ✓, &#11088; ⭐, &#128218; 📚)
inside <h1-6>, <button>, <li>, or class containing 'icon'.
Strips <svg>...</svg> first so legitimate inline SVG icons pass.

Includes a regression fixture mirroring the actual Phase 1 /pricing
HTML (7×<li>&#10003; + <h2>&#11088;) — confirms structural rule
catches what the literal 6-emoji list missed."
```

---

## Task 6: Implement P1 rules (placeholder CDNs + accent overuse)

**Files:**
- Modify: `src/lib/services/verifiers/frontend-lint.verifier.ts`

- [ ] **Step 1: Confirm P1 tests are failing**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts -t "P1-"
```

Expected: 2 failing (P1-1 unsplash, P1-2 accent overuse > 5); 1 passing (negative case for 2 accent uses).

- [ ] **Step 2: Add the P1 detector functions**

In `frontend-lint.verifier.ts`, add:

```typescript
function lintPlaceholderCdn(html: string): LintHit[] {
  const lower = html.toLowerCase();
  let total = 0;
  let firstEvidence = '';
  for (const cdn of PLACEHOLDER_CDNS) {
    const escaped = cdn.replace(/\./g, '\\.');
    const matches = lower.match(new RegExp(escaped, 'g'));
    if (matches && matches.length > 0) {
      total += matches.length;
      if (!firstEvidence) firstEvidence = cdn;
    }
  }
  if (total === 0) return [];
  return [{
    category: 'P1',
    rule: 'placeholder-cdn',
    evidence: firstEvidence,
    count: total,
  }];
}

function lintAccentOveruse(html: string): LintHit[] {
  let total = 0;
  for (const cls of ACCENT_TOKEN_CLASSES) {
    const matches = html.match(new RegExp(`\\b${cls}\\b`, 'g'));
    if (matches) total += matches.length;
  }
  // P1 threshold: 6+ visible accent uses on a single rendered page
  if (total <= 5) return [];
  return [{
    category: 'P1',
    rule: 'accent-overuse',
    evidence: `${total} accent class uses`,
    count: total,
  }];
}
```

Then update `runRules`:

```typescript
function runRules(html: string): LintHit[] {
  const hits: LintHit[] = [];
  hits.push(...lintTailwindIndigo(html));
  hits.push(...lintTwoStopGradient(html));
  hits.push(...lintEmojiInIconSlots(html));
  hits.push(...lintFillerCopy(html));
  hits.push(...lintPlaceholderCdn(html));
  hits.push(...lintAccentOveruse(html));
  return hits;
}
```

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run src/lib/services/verifiers/frontend-lint.verifier.test.ts
```

Expected: all 17 tests pass.

- [ ] **Step 4: Run full project test suite to confirm no regressions**

```bash
npm test
```

Expected: all green except the pre-existing `browser.tools.integration.test.ts` failure (unrelated; missing DATABASE_URL in test env).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/verifiers/frontend-lint.verifier.ts
git commit -m "feat(frontend-lint): implement P1 rules (placeholder CDN + accent overuse)

Completes the 6 implemented rules (4 P0 + 2 P1). P1 hits do NOT fail
the task — they record warnings on the verification result.

All 17 verifier unit tests passing."
```

---

## Task 7: Wire `lintFrontend` into `verifyDeterministic`

**Files:**
- Modify: `src/lib/services/verification.service.ts`

After the existing `render_health_evidence` check at approximately line 322, extract the deployed URL from successful `check_url_health` tool calls and run the lint.

- [ ] **Step 1: Read the current shape of `verifyDeterministic`**

```bash
grep -n "render_health_evidence\|isSuccessfulHealthCall\|verifyDeterministic" src/lib/services/verification.service.ts
```

Note the line numbers of:
- `verifyDeterministic` function start (around line 285)
- `render_health_evidence` check block (around line 312-322)
- `getExecutionToolCalls` helper (used at line 291) — it returns `Array<{ tool: string; tool_input: unknown; ... }>`

- [ ] **Step 2: Add the import for `lintFrontend` and a helper to extract the deployed URL**

At the top of `src/lib/services/verification.service.ts`, find the existing imports block. Add:

```typescript
import { lintFrontend } from './verifiers/frontend-lint.verifier';
```

Then add a helper near the other helpers (like `extractRequestedBrowserPaths`):

```typescript
// Extract the deployed URL the agent verified via check_url_health.
// Returns the first successful health-check URL found, or null if none.
function extractDeployedUrl(toolCalls: Array<{ tool: string; tool_input?: unknown; result?: string }>): string | null {
  for (const t of toolCalls) {
    if (t.tool !== 'check_url_health') continue;
    const input = t.tool_input as { url?: string } | undefined;
    if (typeof input?.url !== 'string') continue;
    // Only count successful health checks. tool result text starts with "OK" on success.
    if (typeof t.result === 'string' && /\b200\b|^OK\b/i.test(t.result)) {
      return input.url;
    }
  }
  return null;
}
```

Note: the exact shape of `t.result` may differ — read `getExecutionToolCalls` (in the same file) to confirm. If the result is structured differently, adjust the success-detection condition. The intent is "find a URL that returned 200."

- [ ] **Step 3: Add the lint check inside `verifyDeterministic`**

In `verifyDeterministic` (around line 285), AFTER the existing `render_health_evidence` check (which currently ends near line 322 with the closing `});` of `checks.push({...})`), add:

```typescript
  // Frontend lint — Phase 4. Runs only for deploy-shaped tasks that produced
  // a deployed URL via check_url_health. P0 hit fails the task; P1 hits are
  // advisory. Fetch failure is inconclusive (does not fail).
  if (requiresDeploy) {
    const deployedUrl = extractDeployedUrl(toolCalls);
    if (deployedUrl) {
      const lintResult = await lintFrontend(deployedUrl);
      const p0Hits = lintResult.hits.filter((h) => h.category === 'P0');
      const p1Hits = lintResult.hits.filter((h) => h.category === 'P1');
      checks.push({
        name: 'frontend_lint',
        passed: lintResult.fetch_error ? true : p0Hits.length === 0,
        detail: lintResult.fetch_error
          ? `Lint inconclusive: ${lintResult.fetch_error}`
          : p0Hits.length > 0
            ? `${p0Hits.length} P0 violation(s): ${p0Hits.map((h) => `${h.rule}(${h.count}, e.g. "${h.evidence}")`).join(', ')}` +
              (p1Hits.length > 0 ? ` Plus ${p1Hits.length} P1 warning(s).` : '')
            : p1Hits.length > 0
              ? `Lint clean of P0; ${p1Hits.length} P1 warning(s): ${p1Hits.map((h) => h.rule).join(', ')}`
              : 'Lint clean (no P0 or P1 hits).',
      });
    }
  }
```

This places `frontend_lint` as a HARD check — `passed: false` will fail verification per the existing logic at the bottom of `verifyDeterministic` (`hardFailures(checks)` returns failed checks not in `ADVISORY_CHECK_NAMES`).

- [ ] **Step 4: Run the verification.service tests to catch any regressions**

```bash
npx vitest run src/lib/services/verification.service.test.ts
```

Expected: existing tests pass. New `frontend_lint` check shouldn't interfere with their fixtures (their fixtures don't have a deployed URL OR the URL is unreachable — fetch failure returns inconclusive, lint passes).

If a test fails because lintFrontend tried to fetch a fake URL, mock it in the test by stubbing `fetch` at the test level OR add a unit test specifically asserting frontend_lint behaves correctly when fetch is inconclusive.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all green except the pre-existing `browser.tools.integration.test.ts` failure.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/verification.service.ts
git commit -m "feat(verification): wire frontend-lint into deterministic checks

Engineering tasks that produce a deployed URL now run lintFrontend
against the URL after the existing health check. P0 hits fail
verification with a structured rule-name + evidence; P1 hits log
as warnings but pass; fetch errors are inconclusive (do not fail).

Closes the spirit-vs-letter gap from Phase 1 smoke test — agent can
no longer ship emoji-as-icons by routing around the literal 6-emoji
forbidden list."
```

---

## Task 8: Update Engineering prompt with the post-deploy lint announcement

**Files:**
- Modify: `src/lib/agents/agent-factory.ts` (Engineering prompt at key `30:`, around line 105+)

- [ ] **Step 1: Find the Self-check section in the Frontend Quality Bar**

The Frontend Quality Bar's "Self-check before declaring complete" subsection currently ends with the bullet "One distinctive choice is identifiable." Locate this in the Engineering prompt template literal (approximately line 144-151).

- [ ] **Step 2: Insert the lint note immediately before the existing Self-check subsection**

Find this pattern in `src/lib/agents/agent-factory.ts`:

```
If a screenshot of the page would let an outsider identify which product it's from, the page has soul. If not, it's a template.

### Self-check before declaring complete
```

Replace it with:

```
If a screenshot of the page would let an outsider identify which product it's from, the page has soul. If not, it's a template.

### Post-deploy lint (you cannot route around this)

A post-deploy lint runs against your deployed URL after \`check_url_health\` returns 200. The emoji-in-icon-slot rule is detected by structural regex regardless of which emoji codepoint or HTML numeric entity is used — \`&#10003;\`, \`&#11088;\`, \`&#128218;\`, raw codepoints in U+2600–U+27BF and U+1F300–U+1FAFF are all caught inside \`<h*>\`, \`<button>\`, \`<li>\`, or any element with a class containing \`icon\`. Substituting one emoji for another will not pass verification. Use \`lucide-react\` SVG icons or inline \`<svg>\` instead — those are stripped from the lint scope and pass.

### Self-check before declaring complete
```

(Note: backticks inside the template literal are escaped as `\``.)

- [ ] **Step 3: Run the existing craft-frontend test to confirm prompt edit didn't break invariants**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: all 15 tests still pass (the new section adds content but doesn't touch the strings the existing tests check).

- [ ] **Step 4: Add one new assertion to the existing test file confirming the lint note exists**

In `src/lib/agents/agent-factory.frontend-craft.test.ts`, inside the `describe('Engineering agent prompt — Frontend Quality Bar')` block, add this test:

```typescript
  it('announces the post-deploy lint to the agent', () => {
    expect(promptSource).toContain('Post-deploy lint');
    expect(promptSource).toContain('emoji-in-icon-slot');
    expect(promptSource).toContain('lucide-react');
  });
```

- [ ] **Step 5: Run the augmented test**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: 16 passing (15 original + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/agent-factory.ts src/lib/agents/agent-factory.frontend-craft.test.ts
git commit -m "feat(engineering-agent): announce post-deploy lint in prompt

Adds 'Post-deploy lint (you cannot route around this)' subsection to
the Frontend Quality Bar in the Engineering agent system prompt.
Tells the agent the structural emoji rule is detected regardless of
codepoint/entity substitution, and points at lucide-react / inline
<svg> as the correct pattern.

Updates agent-factory.frontend-craft.test.ts with one assertion that
the lint note + 'emoji-in-icon-slot' + 'lucide-react' all appear in
the prompt source. Total 16/16 passing."
```

---

## Task 9: Live smoke test (operator-driven)

**Files:** none modified.

This is the only verification step that produces a quality signal — the rest were correctness guards. Operator-driven because it requires triggering a real Engineering task on a real founder company.

- [ ] **Step 1: Re-run a `/pricing`-style smoke task**

Use the existing smoke runner with the same target as Phase 1:

```bash
npx tsx --env-file=.env.local src/scripts/smoke-frontend-craft.ts
```

(Defaults to `genesis-advertising-hen6` and a `/pricing` task — same shape that previously shipped emoji.)

Wait for completion (~5-15 min).

- [ ] **Step 2: Inspect the verdict**

The smoke runner auto-grades the deployed page. ALSO check the task's verification result — go to the DB or log and read the `frontend_lint` check entry:

```bash
cd "c:/Users/Vaishnavi/My_Projects/baljia-ai-cf"
cat > src/scripts/inspect-lint-result-temp.ts <<'EOF'
import { db, tasks, taskExecutions } from '@/lib/db';
import { eq, desc, like } from 'drizzle-orm';

(async () => {
  const recent = await db.select({
    id: tasks.id, title: tasks.title, status: tasks.status,
  }).from(tasks)
    .where(like(tasks.title, 'SMOKE%'))
    .orderBy(desc(tasks.created_at))
    .limit(3);
  for (const t of recent) {
    console.log('\nTask:', t.id, t.status, '—', t.title);
    const [e] = await db.select().from(taskExecutions).where(eq(taskExecutions.task_id, t.id)).orderBy(desc(taskExecutions.started_at)).limit(1);
    const log = (e?.execution_log ?? []) as Array<Record<string, unknown>>;
    const verifyEvents = log.filter((ev) => String(ev.event ?? '').includes('verif') || ev.checks);
    for (const v of verifyEvents) console.log('  ', JSON.stringify(v).slice(0, 400));
  }
  process.exit(0);
})();
EOF
npx tsx --env-file=.env.local src/scripts/inspect-lint-result-temp.ts
rm src/scripts/inspect-lint-result-temp.ts
```

Look for `frontend_lint` in the verification check output.

- [ ] **Step 3: Record the verdict in the spec**

Append a section to `docs/superpowers/specs/2026-05-07-frontend-lint-phase-4-design.md`:

```markdown
## Phase 4 smoke test results — <date>

- Smoke task: <task id>
- Live URL: <url>
- HTTP: <code>
- frontend_lint check result: <pass|fail>
- Hits (if any): <list rule names + counts>
- Verdict: <one of>
  - **PASS-CLEAN** — agent shipped clean output (no emoji in icon slots, used lucide-react/SVG)
  - **PASS-LINT-FAIL** — agent shipped emoji-in-icon-slot anyway; lint correctly caught it; task failed verification with structured reject — proof the lint works
  - **FAIL-LINT-MISS** — agent shipped emoji-in-icon-slot AND lint missed it (false negative — needs rule tightening)
  - **OTHER** — describe

- Notes: one paragraph on what changed vs Phase 1's `/pricing` output
```

Both PASS-CLEAN and PASS-LINT-FAIL are success outcomes. FAIL-LINT-MISS means we need to improve the regex.

- [ ] **Step 4: Commit results**

```bash
git add docs/superpowers/specs/2026-05-07-frontend-lint-phase-4-design.md
git commit -m "docs(spec): record Phase 4 frontend-lint smoke test results"
```

- [ ] **Step 5: Decide on Phase 2**

Per the spec, Phase 2 (skeleton-aware skills) is the next deferred phase. Per the user's "C" choice, Phase 4 → Phase 2. If Phase 4's smoke test shows the lint works, brainstorm Phase 2 next via `/superpowers:brainstorming`.

If Phase 4 shows FAIL-LINT-MISS, fix the rule first before moving on.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Implemented by |
|---|---|
| §3 Architecture (deterministic verifier hook) | Task 7 |
| §4.1 New verifier file | Task 2 |
| §4.2 Rule constants exported | Task 2 |
| §4.3 Lint rules implemented (4 P0 + 2 P1) | Tasks 3–6 |
| §4.5 Integration with verification.service.ts | Task 7 |
| §4.6 Engineering prompt update | Task 8 |
| §4.7 Tests with 12+ cases including Phase 1 regression fixture | Task 1 (17 tests, includes the regression fixture) |
| §6 Risks (fetch retry; <svg> exclusion; rule scope) | Tasks 2 (retry), 5 (svg strip + targeted slots) |
| §7 Testing strategy (unit + regression + live smoke + npm test) | Tasks 1, 5 (regression), 6 (npm test), 9 (live smoke) |
| §8 Success criterion | Task 9 step 3 |
| §9 Out of scope | No tasks touch deferred surfaces |
| §12 Attribution | Task 2 (header in verifier file) |

No gaps.

**2. Placeholder scan:** No "TBD"/"TODO"/"similar to Task N" entries. Every step has the actual code/command. The smoke task expected verdict in Task 9 step 3 names four explicit verdict labels rather than "fill in result."

**3. Type and identifier consistency:**
- `LintHit` shape (`category`, `rule`, `evidence`, `count`) is consistent across Tasks 2, 3, 4, 5, 6, 7
- `LintResult` shape (`passed`, `hits`, `fetched_url`, `fetched_at`, `fetch_error?`) consistent
- Rule names — `tailwind-indigo`, `two-stop-gradient`, `emoji-in-icon-slot`, `filler-copy`, `placeholder-cdn`, `accent-overuse` — used identically in tests (Task 1), implementations (Tasks 3-6), and integration (Task 7)
- `runRules` signature stable across additions
- `extractDeployedUrl` exported from same file as the verifier integration

No drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-frontend-lint-phase-4.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
