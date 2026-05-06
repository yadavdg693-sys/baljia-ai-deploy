# Frontend Craft Rules — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Engineering agent (id 30) ship visibly better frontend on the first try by inlining curated craft rules from `nexu-io/open-design` (Apache 2.0) into its system prompt, plus vendoring the source craft `.md` files for deep-dive `read_skill` lookups.

**Architecture:** Two surfaces change. (1) Eight new files under `.claude/skills/craft-frontend/` (vendored content + index + README). (2) The Engineering agent prompt in `src/lib/agents/agent-factory.ts` gets a new "Frontend Quality Bar" section + one new row in its skill-matrix table. No new tools, no DB changes, no other agents touched.

**Tech Stack:** Markdown vendoring, TypeScript constant editing (`agent-factory.ts`), Vitest for filesystem + prompt-content assertions, Apache 2.0 attribution.

**Spec:** [docs/superpowers/specs/2026-05-06-frontend-craft-phase-1-design.md](../specs/2026-05-06-frontend-craft-phase-1-design.md)

**Pinned upstream commit:** `2afb002a6285f92ec80e6cee97f867dc7a680a77` (resolved at plan-write time on 2026-05-06 against `nexu-io/open-design` `main`). Every vendored file's attribution header references this SHA.

---

## File Structure

**Create:**
- `.claude/skills/craft-frontend/README.md` — top-level attribution + adaptation summary
- `.claude/skills/craft-frontend/SKILL.md` — index that `list_skills` and `read_skill` return
- `.claude/skills/craft-frontend/anti-ai-slop.md` — vendored, adapted
- `.claude/skills/craft-frontend/color.md` — vendored, adapted
- `.claude/skills/craft-frontend/typography.md` — vendored, adapted
- `.claude/skills/craft-frontend/state-coverage.md` — vendored, adapted
- `.claude/skills/craft-frontend/form-validation.md` — vendored, adapted
- `.claude/skills/craft-frontend/accessibility-baseline.md` — vendored, adapted
- `.claude/skills/craft-frontend/animation-discipline.md` — vendored, adapted
- `src/lib/agents/agent-factory.frontend-craft.test.ts` — Vitest assertions on directory + prompt content

**Modify:**
- `src/lib/agents/agent-factory.ts` — add skill-matrix row + "Frontend Quality Bar" section inside the Engineering agent prompt (key 30, currently lines 61–102)

**Out of scope (Phase 1):**
- No new skeleton-aware workflow skills (Phase 2)
- No token catalog in `src/lib/services/onboarding/shared/landing-design-tokens.ts` (Phase 3)
- No post-deploy HTML lint enforcement (Phase 4)
- No changes to non-Engineering agents
- No changes to onboarding-time landing renderer

---

## Adaptation Rules (apply to every vendored craft file)

When vendoring each file from upstream, apply these substitutions and keep them consistent across all 7 files:

1. **`DESIGN.md` → skeleton tokens.** Anywhere upstream says "the active `DESIGN.md`" or "DESIGN.md tokens", rewrite to reference the skeleton's `app/globals.css` shadcn/ui CSS variables (`--primary`, `--accent`, `--ring`, `--background`, `--foreground`, `--muted`, `--border`) consumed via Tailwind classes (`bg-primary`, `text-accent-foreground`, `ring-ring`, etc.).
2. **Drop `data-od-id` rules.** We don't have comment-mode tagging. Delete sentences/checklist items that require this attribute.
3. **Drop `lint-artifact` references.** Upstream has an auto-linter that blocks P0 patterns. We don't (yet — Phase 4). Where upstream says "auto-enforced by the daemon's `lint-artifact`", rewrite to "guidance for the agent and the verifier; not auto-enforced today".
4. **Replace OD-specific paths.** Anywhere upstream points at `apps/daemon/src/lint-artifact.ts` or other OD-internal files, drop the path reference but keep the rule itself.
5. **Preserve nested attribution.** If a vendored file already credits an upstream-of-upstream (e.g. anti-ai-slop credits `refero_skill`), preserve that line — Apache 2.0 requires keeping the chain intact.
6. **Preserve concrete checkable lists.** The hex code list, emoji list, image-CDN list, etc. are the meat — do not abridge them.
7. **Each vendored file gets this exact 4-line header at the very top** (above the original H1):

```markdown
> Adapted from [nexu-io/open-design](https://github.com/nexu-io/open-design) `craft/<filename>` (Apache License 2.0).
> Upstream: https://github.com/nexu-io/open-design/blob/2afb002a6285f92ec80e6cee97f867dc7a680a77/craft/<filename>
> Local adaptations: skeleton-native language (shadcn CSS tokens via Tailwind classes), drop data-od-id, drop lint-artifact references.
> Upstream attribution preserved below where applicable.

```

(replace `<filename>` with the actual file name including `.md`)

---

## Task 1 — Scaffold the craft-frontend skill directory + README + tests

**Files:**
- Create: `.claude/skills/craft-frontend/README.md`
- Create: `src/lib/agents/agent-factory.frontend-craft.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/agents/agent-factory.frontend-craft.test.ts` with this exact content:

```typescript
// Filesystem + prompt-content assertions for the craft-frontend skill
// vendored from nexu-io/open-design (Apache 2.0) and inlined into the
// Engineering agent's system prompt.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const skillDir = resolve(repoRoot, '.claude/skills/craft-frontend');
const promptFile = resolve(repoRoot, 'src/lib/agents/agent-factory.ts');

const CRAFT_FILES = [
  'anti-ai-slop.md',
  'color.md',
  'typography.md',
  'state-coverage.md',
  'form-validation.md',
  'accessibility-baseline.md',
  'animation-discipline.md',
];

const TAILWIND_INDIGO_HEXES = [
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
  '#8b5cf6', '#7c3aed', '#a855f7',
];

describe('craft-frontend skill — directory structure', () => {
  it('directory exists', () => {
    expect(existsSync(skillDir)).toBe(true);
  });

  it('README.md exists with Apache 2.0 attribution', () => {
    const path = resolve(skillDir, 'README.md');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf-8');
    expect(body).toMatch(/Apache License 2\.0/);
    expect(body).toMatch(/nexu-io\/open-design/);
  });

  it('SKILL.md exists and lists every craft file', () => {
    const path = resolve(skillDir, 'SKILL.md');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf-8');
    for (const f of CRAFT_FILES) {
      expect(body, `SKILL.md must list ${f}`).toContain(f);
    }
  });
});

describe('craft-frontend skill — vendored craft files', () => {
  for (const f of CRAFT_FILES) {
    it(`${f} exists with attribution header`, () => {
      const path = resolve(skillDir, f);
      expect(existsSync(path), `missing ${f}`).toBe(true);
      const body = readFileSync(path, 'utf-8');
      expect(body, `${f} missing upstream attribution`).toMatch(/nexu-io\/open-design/);
      expect(body, `${f} missing Apache 2.0 reference`).toMatch(/Apache License 2\.0/);
      expect(body, `${f} missing pinned commit`).toContain('2afb002a6285f92ec80e6cee97f867dc7a680a77');
    });
  }
});

describe('Engineering agent prompt — Frontend Quality Bar', () => {
  const promptSource = readFileSync(promptFile, 'utf-8');

  it('contains the Frontend Quality Bar section header', () => {
    expect(promptSource).toContain('Frontend Quality Bar');
  });

  it('lists craft-frontend in the skill matrix', () => {
    expect(promptSource).toContain('craft-frontend');
  });

  it('forbids every Tailwind-default indigo hex by name', () => {
    for (const hex of TAILWIND_INDIGO_HEXES) {
      expect(promptSource, `prompt should name forbidden hex ${hex}`).toContain(hex);
    }
  });

  it('forbids lorem ipsum filler copy', () => {
    expect(promptSource.toLowerCase()).toContain('lorem ipsum');
  });

  it('caps accent token usage at 2 per screen', () => {
    expect(promptSource).toMatch(/2 (visible )?(uses?|times?) per screen/i);
  });
});
```

- [ ] **Step 2: Run the new test, confirm every assertion fails**

Run:
```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: 12 failing assertions across 3 `describe` blocks (directory missing, SKILL.md missing, vendored files missing, prompt section missing). This is the red baseline — every later task drives a slice of these green.

- [ ] **Step 3: Create the directory and README**

Create `.claude/skills/craft-frontend/README.md` with this content:

```markdown
# craft-frontend skill

Curated frontend craft rules vendored from
[nexu-io/open-design](https://github.com/nexu-io/open-design) (Apache License 2.0)
at commit `2afb002a6285f92ec80e6cee97f867dc7a680a77`.

These files exist for **deep-dive `read_skill('craft-frontend')` lookups** by
the Engineering agent. The highest-density rules are also inlined directly into
the Engineering agent's system prompt in
[`src/lib/agents/agent-factory.ts`](../../../src/lib/agents/agent-factory.ts) so
they apply on every task without a tool call.

## What's here

| File | What it covers |
|---|---|
| `anti-ai-slop.md` | The 7 P0 cardinal sins (Tailwind indigo, two-stop gradients, emoji icons, lorem ipsum, etc.) plus soft tells and the "soul" rule |
| `color.md` | Palette construction, accent restraint, hex hygiene |
| `typography.md` | Type pairing, scale, hierarchy, display-vs-body discipline |
| `state-coverage.md` | Every interactive element needs hover / focus-visible / disabled / loading |
| `form-validation.md` | Inline error patterns, success affordances, async validation UX |
| `accessibility-baseline.md` | WCAG floor — contrast, focus rings, semantic HTML |
| `animation-discipline.md` | Motion budgets — duration, easing, what to animate |

## Adaptation summary

- Upstream `DESIGN.md` references rewritten to point at the skeleton's
  `app/globals.css` shadcn/ui CSS tokens (`--primary`, `--accent`, `--ring`,
  etc.) consumed via Tailwind classes (`bg-primary`, `text-accent-foreground`).
- `data-od-id` rules dropped — we don't have comment-mode tagging.
- `lint-artifact` references rewritten as "guidance, not auto-enforced today"
  (Phase 4 may add enforcement).
- Nested upstream attributions (e.g. to `refero_skill` inside `anti-ai-slop.md`)
  preserved.

## License

Upstream is licensed under Apache 2.0. See
<https://github.com/nexu-io/open-design/blob/2afb002a6285f92ec80e6cee97f867dc7a680a77/LICENSE>.
This vendored copy carries the same license.
```

- [ ] **Step 4: Re-run the test**

Run:
```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: the "directory exists" and "README.md exists with Apache 2.0 attribution" assertions now pass. Other assertions still fail — that's correct, they get fixed by later tasks.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/craft-frontend/README.md src/lib/agents/agent-factory.frontend-craft.test.ts
git commit -m "test(craft-frontend): add structure tests + scaffold README

Vendoring craft-frontend skill from nexu-io/open-design (Apache 2.0).
Tests assert directory layout, attribution headers on each vendored
file, and prompt-content invariants (forbidden indigo hexes, lorem
ipsum, accent cap). Most assertions still red until subsequent tasks
land the actual content."
```

---

## Task 2 — Vendor 4 craft files (anti-ai-slop, color, typography, state-coverage)

**Files:**
- Create: `.claude/skills/craft-frontend/anti-ai-slop.md`
- Create: `.claude/skills/craft-frontend/color.md`
- Create: `.claude/skills/craft-frontend/typography.md`
- Create: `.claude/skills/craft-frontend/state-coverage.md`

These four are batched together because they share the same vendor-and-adapt workflow.

- [ ] **Step 1: Fetch each upstream file**

For each filename in `anti-ai-slop.md color.md typography.md state-coverage.md`, run:

```bash
gh api repos/nexu-io/open-design/contents/craft/<filename>?ref=2afb002a6285f92ec80e6cee97f867dc7a680a77 \
  --jq '.content' | base64 -d > /tmp/upstream-<filename>
```

Confirm each `/tmp/upstream-<filename>` file is non-empty and contains markdown content (not a JSON error response).

- [ ] **Step 2: Apply the adaptation rules**

For each fetched file, open `/tmp/upstream-<filename>`, then produce `.claude/skills/craft-frontend/<filename>` by:

1. Prepending the 4-line attribution header from the "Adaptation Rules" section above (with `<filename>` substituted to the actual file name).
2. Applying the 7 substitution rules:
   - Replace `DESIGN.md` references with skeleton-native language (shadcn CSS tokens via Tailwind classes — see Adaptation Rule 1).
   - Delete sentences/checklist items that require `data-od-id`.
   - Rewrite `lint-artifact`-auto-enforced wording to "guidance for the agent and the verifier; not auto-enforced today".
   - Drop OD-internal file paths (`apps/daemon/src/lint-artifact.ts` etc.).
   - Preserve nested attribution lines (notably `> Adapted from [refero_skill]...` near the top of upstream `anti-ai-slop.md`).
   - Keep concrete checkable lists (hex codes, emoji list, image-CDN list) verbatim.
   - Keep the original H1, all section H2s, and ordering — do not restructure.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: the four `<filename> exists with attribution header` cases that correspond to the files vendored in this task now pass. The other three vendored-file cases still fail (correct — Task 3 fixes them). Prompt-content cases still fail (Task 4 fixes them).

- [ ] **Step 4: Spot-check the adapted content**

Open each of the 4 newly created files. Confirm:
- The 4-line attribution header is at the very top.
- No occurrence of the literal string `DESIGN.md`, `data-od-id`, or `lint-artifact` remains.
- The hex code list in `anti-ai-slop.md` is intact (`#6366f1`, `#4f46e5`, `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`, `#a855f7`).
- Nested upstream attribution to `refero_skill` is preserved in `anti-ai-slop.md`.

If any of these are wrong, fix them before committing.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/craft-frontend/anti-ai-slop.md \
        .claude/skills/craft-frontend/color.md \
        .claude/skills/craft-frontend/typography.md \
        .claude/skills/craft-frontend/state-coverage.md
git commit -m "feat(craft-frontend): vendor 4 craft files from nexu-io/open-design

anti-ai-slop, color, typography, state-coverage — Apache 2.0,
pinned to upstream 2afb002. DESIGN.md references rewritten to
shadcn CSS tokens; data-od-id and lint-artifact concepts dropped."
```

---

## Task 3 — Vendor 3 remaining craft files (form-validation, accessibility-baseline, animation-discipline)

**Files:**
- Create: `.claude/skills/craft-frontend/form-validation.md`
- Create: `.claude/skills/craft-frontend/accessibility-baseline.md`
- Create: `.claude/skills/craft-frontend/animation-discipline.md`

Same workflow as Task 2; split into a separate task purely so each task stays bite-sized.

- [ ] **Step 1: Fetch each upstream file**

For each filename in `form-validation.md accessibility-baseline.md animation-discipline.md`, run:

```bash
gh api repos/nexu-io/open-design/contents/craft/<filename>?ref=2afb002a6285f92ec80e6cee97f867dc7a680a77 \
  --jq '.content' | base64 -d > /tmp/upstream-<filename>
```

Confirm each fetch returned markdown content.

- [ ] **Step 2: Apply the adaptation rules**

For each fetched file, produce `.claude/skills/craft-frontend/<filename>` following the same procedure as Task 2 Step 2. Substitution rules and attribution header are identical — only the source content differs.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: all 7 `<filename> exists with attribution header` cases now pass. The "SKILL.md exists and lists every craft file" case still fails (Task 4 creates SKILL.md). Prompt-content cases still fail.

- [ ] **Step 4: Spot-check**

Open each of the 3 new files and confirm the adaptation rules were applied (no `DESIGN.md`, `data-od-id`, or `lint-artifact` strings remain; attribution header at top).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/craft-frontend/form-validation.md \
        .claude/skills/craft-frontend/accessibility-baseline.md \
        .claude/skills/craft-frontend/animation-discipline.md
git commit -m "feat(craft-frontend): vendor 3 remaining craft files

form-validation, accessibility-baseline, animation-discipline —
completes the 7-file craft layer from nexu-io/open-design (Apache 2.0,
pinned to 2afb002)."
```

---

## Task 4 — Write SKILL.md index

**Files:**
- Create: `.claude/skills/craft-frontend/SKILL.md`

- [ ] **Step 1: Confirm the test for SKILL.md is currently failing**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts -t "SKILL.md exists and lists every craft file"
```

Expected: 1 failing assertion (file does not exist).

- [ ] **Step 2: Create the SKILL.md index**

Create `.claude/skills/craft-frontend/SKILL.md` with this exact content:

```markdown
# craft-frontend

Curated frontend craft rules. Read this skill BEFORE writing any landing page,
dashboard, or in-app UI for a founder app.

The highest-density rules are already inlined into your system prompt under the
"Frontend Quality Bar" section — they apply on every task. This skill exists
when you need the full rationale and edge cases.

## When to read which file

| If you are... | Read |
|---|---|
| Wondering why your UI looks AI-default | `anti-ai-slop.md` |
| Picking a palette or accent | `color.md` |
| Pairing display + body fonts | `typography.md` |
| Building a button, input, or interactive element | `state-coverage.md` |
| Building any form (login, signup, settings, contact) | `form-validation.md` |
| Shipping a public page | `accessibility-baseline.md` |
| Adding any motion (transitions, micro-interactions) | `animation-discipline.md` |

## Files

- [anti-ai-slop.md](anti-ai-slop.md) — 7 P0 cardinal sins, soft tells, the "soul" rule
- [color.md](color.md) — palette construction, accent restraint, hex hygiene
- [typography.md](typography.md) — type pairing, scale, hierarchy
- [state-coverage.md](state-coverage.md) — hover / focus-visible / disabled / loading on every interactive element
- [form-validation.md](form-validation.md) — inline errors, success affordances, async UX
- [accessibility-baseline.md](accessibility-baseline.md) — WCAG floor (contrast, focus, semantics)
- [animation-discipline.md](animation-discipline.md) — motion budgets, what to animate

## Source and license

Vendored from [nexu-io/open-design](https://github.com/nexu-io/open-design)
`craft/` at commit `2afb002a6285f92ec80e6cee97f867dc7a680a77` under
Apache License 2.0. See [README.md](README.md) for adaptation summary and
attribution.
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: every assertion in the first two `describe` blocks ("directory structure" and "vendored craft files") now passes. The third `describe` block ("Engineering agent prompt — Frontend Quality Bar") still fails — Task 5 fixes that.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/craft-frontend/SKILL.md
git commit -m "feat(craft-frontend): add SKILL.md index"
```

---

## Task 5 — Inline the "Frontend Quality Bar" into the Engineering agent prompt

**Files:**
- Modify: `src/lib/agents/agent-factory.ts` (Engineering prompt at key `30:`, currently lines 61–102)

This is the heart of Phase 1. Two edits to the same prompt: a new row in the existing skill matrix, and a new "Frontend Quality Bar" section appended after the existing Rules section.

- [ ] **Step 1: Confirm the prompt-content tests are currently failing**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts -t "Engineering agent prompt"
```

Expected: 5 failing assertions (no "Frontend Quality Bar" header, no "craft-frontend" in matrix, forbidden hexes not named, no "lorem ipsum", no accent cap clause).

- [ ] **Step 2: Add the new row to the existing skill matrix**

Open `src/lib/agents/agent-factory.ts`. Find the skill matrix table inside the Engineering prompt (currently at lines 75–84). The last row reads:

```
| AI features (LLM calls, agent loops, prompt-template logic) | agent-sdk |
```

Insert this new row immediately after it (one new line):

```
| Frontend craft / quality / state coverage / form a11y / why does my UI look AI-default | craft-frontend |
```

- [ ] **Step 3: Append the "Frontend Quality Bar" section**

Still in the Engineering agent prompt (key `30:`), find the closing backtick that ends the prompt template (currently at line 102, immediately after the bullet ending `"...AND any verification gaps you couldn't close."`). Insert the following content **before** the closing backtick of the template literal so it becomes part of the same prompt string:

````
## Frontend Quality Bar (non-negotiable)

Any landing page, dashboard, or in-app page you produce must clear this bar before you call the task complete. These rules eliminate the most common "AI default" tells. For full ruleset and rationale, call \`read_skill('craft-frontend')\`.

### P0 — do not ship if any of these are present

1. **No Tailwind default indigo as accent.** Never use \`#6366f1\`, \`#4f46e5\`, \`#4338ca\`, \`#3730a3\`, \`#8b5cf6\`, \`#7c3aed\`, or \`#a855f7\` as a primary or accent color. Use the shadcn/ui CSS tokens already defined in the skeleton's \`app/globals.css\` (\`--primary\`, \`--accent\`, \`--ring\`, etc.) via Tailwind classes (\`bg-primary\`, \`text-accent-foreground\`, \`ring-ring\`). Never hardcode hex values for theme colors.

2. **No two-stop "trust" gradients on hero.** Purple→blue, blue→cyan, indigo→pink — these are the AI hero tell. A flat surface plus intentional typography wins.

3. **No emoji as feature icons.** No \`✨ 🚀 🎯 ⚡ 🔥 💡\` inside \`<h*>\`, \`<button>\`, \`<li>\`, or any class containing \`icon\`. The skeleton ships \`lucide-react\`; use 1.6–1.8px-stroke monoline icons with \`currentColor\`.

4. **No sans-serif on display text when a display font is bound.** If \`app/layout.tsx\` declares a display font via \`next/font\`, use it on h1/h2 via the font's CSS variable. Don't hardcode \`system-ui\`, \`Inter\`, or \`Roboto\` for display.

5. **No "rounded card with colored left-border accent."** This is the canonical AI dashboard tile shape. Drop the radius or drop the left border — keep only one.

6. **No invented metrics.** "10× faster", "99.9% uptime", "3× more productive" with no citation = lying. Either cite a real source in copy or use a labelled placeholder.

7. **No filler copy.** No \`lorem ipsum\`, \`feature one / two / three\`, \`placeholder text\`, \`sample content\`. An empty section is a composition problem to solve with structure, not by inventing words.

### P1 — soft tells, fix before finishing

- **No template "Hero → Features → Pricing → FAQ → CTA" sequence.** Introduce one unconventional section: full-bleed testimonial quote, comparison-against-status-quo pricing, inline mini-product-demo, or product-specific reference (kbd shortcut wall, status-badge legend).
- **No external placeholder image CDNs** (\`unsplash.com\`, \`placehold.co\`, \`placekitten.com\`, \`picsum.photos\`). Use the skeleton's placeholder convention.
- **More than ~12 raw hex values outside \`:root\`** means tokens were not honoured.
- **Accent token (\`bg-primary\`, \`text-accent\`, etc.) used 6+ times in one rendered screen.** Cap visible accent uses at 2 per screen.

### Soul rule

Aim for ~80% proven patterns + ~20% distinctive choice. The 20% lives in:
- One bold visual move — typography choice, single color decision, unexpected proportion.
- Voice and microcopy — "Start tracking" beats "Get started".
- One micro-interaction — a button that depresses 2px, a number that counts up.
- One product-specific detail — a kbd shortcut hint, a status badge with product-specific phrasing.

If a screenshot of the page would let an outsider identify which product it's from, the page has soul. If not, it's a template.

### Self-check before declaring complete

Walk through the page and confirm:
- No Tailwind indigo hex anywhere.
- No two-stop hero gradient.
- No emoji in headers, buttons, or icon slots.
- No lorem ipsum or "feature one/two/three".
- Accent token visible ≤ 2 times per screen.
- One unconventional section breaks the template skeleton.
- One distinctive choice is identifiable.
````

**Important:** because the Engineering prompt is a JavaScript template literal (backticks), the example backticks inside the new section above are escaped (`\``). The placeholder code-fence wrapping the section (the outer ` ```` ` block) is purely for plan readability — when you paste the content into `agent-factory.ts`, paste only the inner content from `## Frontend Quality Bar (non-negotiable)` through `One distinctive choice is identifiable.`, with the backslash-escaped backticks intact.

- [ ] **Step 4: Run the prompt-content tests**

```bash
npx vitest run src/lib/agents/agent-factory.frontend-craft.test.ts
```

Expected: every assertion in all three `describe` blocks now passes (12 of 12 green).

- [ ] **Step 5: Run the full test suite as a regression check**

```bash
npm test
```

Expected: all existing tests continue to pass (the 96-test CEO suite plus this new file). No prior tests were touched, so no breakage expected. If anything fails, do not commit — investigate and fix.

- [ ] **Step 6: Self-test by reading the assembled prompt end-to-end**

Open `src/lib/agents/agent-factory.ts` and read the Engineering agent prompt (`AGENT_PROMPTS[30]`) start to finish. Confirm:
- The "Skills" section, "Rules" section, and the new "Frontend Quality Bar" section appear in that order.
- The skill matrix lists `craft-frontend` on its own row.
- No rule in "Frontend Quality Bar" contradicts a rule in "Rules" (e.g. nothing says "use Express" or "use a static site").
- The pointer `read_skill('craft-frontend')` matches the actual skill directory created in Tasks 1–4.

If any inconsistency, fix it before committing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agents/agent-factory.ts
git commit -m "feat(engineering-agent): inline Frontend Quality Bar into prompt

Adds a non-negotiable frontend quality section to the Engineering
agent system prompt with 7 P0 sins (Tailwind indigo, two-stop
gradients, emoji icons, lorem ipsum, etc.), 4 P1 soft tells, the
~80/20 soul rule, and a self-check list. Adds one row to the skill
matrix pointing at the new craft-frontend skill for deep-dive lookups.

Rules distilled from nexu-io/open-design craft/ (Apache 2.0,
pinned to 2afb002). See spec at
docs/superpowers/specs/2026-05-06-frontend-craft-phase-1-design.md."
```

---

## Task 6 — Smoke test (operator-driven)

**Files:** none modified.

This is the only verification step that produces a quality signal — the rest were correctness guards. It is intentionally manual because Phase 1's hypothesis is "does inlining the rules visibly change agent output?" That answer comes from human eyeball, not assertion.

- [ ] **Step 1: Pick a comparison baseline**

Find a recent Engineering task (last 7 days) where the agent built or modified a frontend page. The deployed URL should still be reachable. Take a screenshot of the previous output as the "before" reference.

If no recent comparable task exists, skip this comparison and rely on absolute checks in Step 3 only.

- [ ] **Step 2: Trigger one new Engineering frontend task**

Use whichever path is most convenient:

- Real founder request, if one is queued.
- The 3-agent test runner: `npx tsx --env-file=.env.local src/scripts/test-3-agent-tasks.ts` (creates an engineering-tagged task, waits for execution).
- Manually create a task via the chat UI on a test company asking for a frontend page (e.g. "build a pricing page" or "redesign the dashboard hero").

Wait for the task to complete and the deploy to go live.

- [ ] **Step 3: Eyeball the deployed page against the P0 list**

Open the live URL and confirm in the browser:
- [ ] No Tailwind indigo in any visible accent (use DevTools → Computed → search for `#6366f1` etc.; or visually confirm the accent isn't the default purple-blue).
- [ ] No two-stop hero gradient.
- [ ] No emoji rendered inside any header, button label, or icon slot.
- [ ] No lorem ipsum visible.
- [ ] Count the visible uses of the accent color on the rendered page; should be ≤ 2.
- [ ] At least one section breaks the textbook Hero→Features→Pricing→FAQ→CTA template.

- [ ] **Step 4: Record the result**

Open `docs/superpowers/specs/2026-05-06-frontend-craft-phase-1-design.md` and append a short results section at the bottom:

```markdown
## Phase 1 smoke test results — <date>

- Task: <task id or description>
- Live URL: <url>
- Baseline (if compared): <url or "n/a">
- P0 checks passed: <count> / 7
- P1 checks passed: <count> / 4
- Verdict: <passed | partial | failed>
- Notes: <one paragraph on what changed vs. baseline; any rule the agent ignored>
```

- [ ] **Step 5: Commit the results**

```bash
git add docs/superpowers/specs/2026-05-06-frontend-craft-phase-1-design.md
git commit -m "docs(spec): record Phase 1 frontend craft smoke test results"
```

- [ ] **Step 6: Decide on next phase**

Read your verdict in Step 4:
- **passed** (≥ 5/7 P0 + ≥ 2/4 P1) → consider scheduling Phase 2 (skeleton-aware workflow skills) via a fresh `/superpowers:brainstorming` session.
- **partial** (3–4 P0) → reframe a few rules; rerun smoke; if still partial, escalate to Phase 4 (lint enforcement) which auto-blocks rather than relying on the agent.
- **failed** (≤ 2 P0) → Phase 4 becomes mandatory. Phase 2 is wasted effort until enforcement is in place. Open a new brainstorm scoped to Phase 4.

This decision is a judgment call by the operator, not part of this plan.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Implemented by |
|---|---|
| §4 Architecture (single-file change to `agent-factory.ts` + vendored `.claude/skills/craft-frontend/`) | Tasks 1–5 |
| §5.1 Vendored craft skill (7 files + adaptation pass) | Tasks 2 + 3 |
| §5.2 SKILL.md index | Task 4 |
| §5.3 Inlined "Frontend Quality Bar" section (~80 lines) | Task 5 |
| §5.4 Skill-matrix row update | Task 5 Step 2 |
| §6 Data flow (unchanged) | Verified by Task 5 Step 5 (`npm test` regression) |
| §7 Risks — adaptation pass rewrites OD-isms | Adaptation Rules section + Tasks 2/3 Step 4 spot-check |
| §8 Testing — self-test, smoke test, regression check | Task 5 Step 5/6 (regression + self-test); Task 6 (smoke) |
| §9 Success criterion (≥3 P0 + ≥1 P1 eliminated) | Task 6 Step 3/4 |
| §10 Out-of-scope | No tasks in this plan touch Phase 2/3/4 surfaces |
| §12 Attribution header (4-line block, pinned SHA) | Adaptation Rules section + Task 1 Step 3 (README) + Tasks 2/3 |

No gaps.

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" left unfilled. Every code/content step shows the actual content. Filenames and the pinned commit SHA are exact, not placeholders.

**3. Type/identifier consistency:**
- The skill name `craft-frontend` is used consistently in: directory path, README, SKILL.md, attribution headers, skill-matrix row, prompt pointer, test assertions.
- The pinned SHA `2afb002a6285f92ec80e6cee97f867dc7a680a77` is identical in: README, attribution-header template, every vendoring `gh api` command, and the test assertion.
- The 7 forbidden hex codes are identical between the test file (`TAILWIND_INDIGO_HEXES`), the prompt content, and the upstream `anti-ai-slop.md` they originate from.
- File list in `CRAFT_FILES` (test) matches `expectedFiles` in spirit and matches the actual fetched/vendored set in Tasks 2 + 3.

No drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-frontend-craft-phase-1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
