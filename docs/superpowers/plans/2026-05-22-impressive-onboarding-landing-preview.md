# Impressive Onboarding Landing Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the one-minute onboarding-generated page feel like Polsia understood the founder's idea, created a credible business direction, and produced a visually impressive first artifact.

**Architecture:** Keep the current corpus-driven landing generator, but expand the content contract beyond generic landing sections. Add a founder-preview layer with a business-category template, generated artifact module, and founder-facing next actions for the onboarding shell. Render pages with Baljia-style clarity and Polsia-style first-impression energy, then enforce the engineering-agent design bar with static and visual checks.

**Tech Stack:** TypeScript, Zod, existing onboarding landing generator, existing static HTML renderers, `tsx` smoke scripts, Playwright screenshot verification.

---

## Product Direction

This is not a public conversion landing page. It is a Day-0 onboarding artifact.

The page must answer three founder questions in the first minute:

1. Did Polsia understand my idea?
2. Did Polsia make it feel real?
3. What should I do next inside Polsia?

The generated HTML should feel like a polished preview of the business. The Polsia onboarding UI around it should provide founder actions such as `Continue building`, `Edit preview`, `Generate roadmap`, and `Create starter tasks`.

## Target Experience

**Visual thesis:** A founder gets a cinematic, business-specific preview with one strong product artifact, restrained typography, and just enough motion to feel freshly generated.

**Content plan:**
- Hero: generated brand, direct product promise, concise explanation, dominant artifact preview.
- Snapshot: what Polsia understood: audience, problem, positioning angle, business model.
- Detail: what it does and how it works, written with Baljia-level clarity.
- Difference: grounded market or competitor insight.
- Founder next step: shown by the onboarding shell, not as a fake public waitlist.

**Interaction thesis:**
- Hero artifact appears as a finished deliverable, not a generic mock terminal.
- Generated-status rail shows what was created in one minute.
- Cards are replaced by artifact panels, timelines, split statements, or comparison rows.

## Files

- Modify: `src/lib/services/onboarding/shared/schemas.ts`
  Add preview/artifact/founder-action fields to `LandingContentSchema`.

- Modify: `src/lib/services/onboarding/shared/landing.ts`
  Update `LandingContent`, prompts, validation, sanitation, template-kind selection, and `renderLandingHtml` metadata.

- Modify: `src/lib/services/onboarding/shared/landing-renderer-v2.ts`
  Remove the active rounded card plus colored left-border pattern and add preview-aware utility rendering.

- Modify: `src/lib/services/onboarding/shared/landing-renderer-v2-extras.ts`
  Add artifact modules for non-default families or share preview helper functions.

- Create: `src/lib/services/onboarding/shared/landing-preview-artifacts.ts`
  Render business-specific artifact previews such as job pipeline, local booking, storefront, coaching funnel, SaaS dashboard, or service scope board.

- Create: `src/lib/services/onboarding/shared/landing-template-kind.ts`
  Deterministically map onboarding context and industry tokens to a template kind.

- Modify: `src/scripts/test-landing-v2-render.ts`
  Add preview schema fixtures and screenshot-friendly sample output.

- Create: `src/scripts/audit-onboarding-landing.ts`
  Static audit for engineering-agent UI tells in generated HTML/CSS.

## Content Contract

Add these fields to the landing JSON contract:

```ts
preview: {
  template_kind:
    | 'saas'
    | 'local_service'
    | 'ecommerce'
    | 'content_coaching'
    | 'marketplace'
    | 'existing_business';
  generated_summary: {
    audience: string;
    problem: string;
    positioning: string;
  };
  artifact: {
    kind:
      | 'pipeline_board'
      | 'app_dashboard'
      | 'booking_flow'
      | 'storefront_drop'
      | 'lead_magnet'
      | 'scope_builder';
    title: string;
    items: Array<{
      label: string;
      value: string;
      detail: string;
    }>;
  };
  founder_actions: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
}
```

Rules:
- `preview.generated_summary` must be derived from onboarding and market context.
- `preview.artifact` must look like something Polsia created, not a decorative placeholder.
- `founder_actions` are for the onboarding shell. Do not render them as public customer CTAs inside the standalone page unless the shell explicitly opts in.

## Engineering-Agent Design Bar

The generated preview must obey these rules from `src/lib/agents/agent-factory.ts`:

- No Tailwind default indigo or purple as primary accent.
- No two-stop purple-blue/blue-cyan hero gradients.
- No emoji in headings, buttons, or icon slots.
- No rounded card with colored left-border accent. Drop the radius or drop the left border.
- No generic “feature one / feature two / feature three” placeholder structure.
- Cap obvious accent color usage per screen.
- Run `design_audit` and `design_critique` on deployed UI tasks when the engineering agent builds a page.

For this generator, mirror those rules in `src/scripts/audit-onboarding-landing.ts`.

## Task 1: Extend the Landing Schema

**Files:**
- Modify: `src/lib/services/onboarding/shared/schemas.ts`
- Modify: `src/lib/services/onboarding/shared/landing.ts`

- [ ] **Step 1: Add Zod schema fields**

Add `preview` to `LandingContentSchema` after `hero`.

```ts
const previewItemSchema = z.object({
  label: nonEmpty,
  value: nonEmpty,
  detail: nonEmpty,
});

const landingPreviewSchema = z.object({
  template_kind: z.enum([
    'saas',
    'local_service',
    'ecommerce',
    'content_coaching',
    'marketplace',
    'existing_business',
  ]),
  generated_summary: z.object({
    audience: nonEmpty,
    problem: nonEmpty,
    positioning: nonEmpty,
  }),
  artifact: z.object({
    kind: z.enum([
      'pipeline_board',
      'app_dashboard',
      'booking_flow',
      'storefront_drop',
      'lead_magnet',
      'scope_builder',
    ]),
    title: nonEmpty,
    items: z.array(previewItemSchema).min(3).max(5),
  }),
  founder_actions: z.object({
    primary: nonEmpty,
    secondary: nonEmpty,
    tertiary: nonEmpty,
  }),
});
```

- [ ] **Step 2: Update `LandingContent` interface**

Add the matching `preview` type to `src/lib/services/onboarding/shared/landing.ts`.

- [ ] **Step 3: Update sanitization**

Sanitize every preview string with the existing `s()` helper and clamp `artifact.items` to five items.

- [ ] **Step 4: Update validation**

Require `preview.template_kind`, `preview.artifact.kind`, and at least three `preview.artifact.items`.

- [ ] **Step 5: Run schema smoke**

Run:

```bash
npx tsx --env-file=.env.local src/scripts/test-landing-v2-render.ts
```

Expected: existing sample generation still completes after fixtures are updated.

## Task 2: Classify the Preview Template Kind

**Files:**
- Create: `src/lib/services/onboarding/shared/landing-template-kind.ts`
- Modify: `src/lib/services/onboarding/shared/landing.ts`

- [ ] **Step 1: Create deterministic classifier**

Create `resolveLandingTemplateKind(ctx, tokens)` that maps:
- job tools, AI apps, productivity tools -> `saas`
- agencies, clinics, services, restaurants, salons -> `local_service`
- product brands, merch, DTC, retail -> `ecommerce`
- coaching, courses, creator, newsletter -> `content_coaching`
- multi-sided services -> `marketplace`
- `grow_my_company` journey -> `existing_business`

- [ ] **Step 2: Pass classifier into the prompt**

Add `TEMPLATE KIND: ${templateKind}` near industry classification in both Build/Surprise and Grow prompts.

- [ ] **Step 3: Lock the LLM to the selected kind**

Prompt rule:

```text
preview.template_kind MUST exactly equal TEMPLATE KIND. Do not invent another category.
```

- [ ] **Step 4: Add smoke assertions**

In `src/scripts/test-landing-v2-render.ts`, assert that a CareerOps/job-search fixture resolves to `saas` and uses `pipeline_board`.

## Task 3: Rewrite Prompt Around Founder Delight

**Files:**
- Modify: `src/lib/services/onboarding/shared/landing.ts`

- [ ] **Step 1: Replace the current public-landing framing**

Replace:

```text
This page is INFORMATIONAL only — NO call-to-action button, NO email capture, NO waitlist.
```

With:

```text
This is a Day-0 founder preview generated during onboarding. It must impress the founder by making the idea feel understood, specific, and buildable. Do not write public customer CTAs. Instead, return founder_actions for the Polsia onboarding shell.
```

- [ ] **Step 2: Add Baljia clarity rules**

Prompt rules:
- Hero says what the business does in one glance.
- Avoid vague AI/startup words unless they are central to the product.
- Every section must be understandable by scanning headings.
- `what_it_does` must describe concrete capabilities.
- `what_makes_different` must include one market or competitor contrast when available.

- [ ] **Step 3: Add Polsia energy rules**

Prompt rules:
- `preview.artifact` must make the idea tangible.
- Artifact items should look like real product/business output.
- Include one generated positioning insight in `preview.generated_summary.positioning`.

- [ ] **Step 4: Keep anti-fabrication rules**

Continue banning testimonials, user counts, ratings, phone numbers, real screenshots, pricing, funding, and exact launch dates unless present in onboarding data.

## Task 4: Build Artifact Renderers

**Files:**
- Create: `src/lib/services/onboarding/shared/landing-preview-artifacts.ts`
- Modify: `src/lib/services/onboarding/shared/landing-renderer-v2.ts`
- Modify: `src/lib/services/onboarding/shared/landing-renderer-v2-extras.ts`

- [ ] **Step 1: Create `renderPreviewArtifact`**

Export:

```ts
export function renderPreviewArtifact(
  preview: LandingContent['preview'],
  esc: (s: string) => string,
): string
```

Render by artifact kind:
- `pipeline_board`: scored opportunity rows, status chips, next action.
- `app_dashboard`: metric rail, task list, insight panel.
- `booking_flow`: service, slot, intake, confirmation.
- `storefront_drop`: product/drop rows, inventory cue, launch note.
- `lead_magnet`: promise, outline, capture preview without a fake form.
- `scope_builder`: request, estimate, deliverables, next step.

- [ ] **Step 2: Use semantic HTML**

Use `<figure>`, `<figcaption>`, `<ol>`, `<dl>`, `<section>`, and `<article>` where appropriate. Do not use emoji icons.

- [ ] **Step 3: Add artifact CSS**

Add CSS classes that avoid the engineering-agent forbidden pattern:
- No `.card { border-left + border-radius }`.
- Use flat panels, divider rows, tabular layouts, or borderless typographic groups.

## Task 5: Redesign the First Viewport

**Files:**
- Modify: `src/lib/services/onboarding/shared/landing-renderer-v2.ts`
- Modify: `src/lib/services/onboarding/shared/landing-renderer-v2-extras.ts`

- [ ] **Step 1: Make brand louder**

The first viewport order should be:
- brand name
- hero headline
- one-sentence subhead
- generated artifact
- small generated-status rail

- [ ] **Step 2: Add generated-status rail**

Render labels such as:
- `Brand direction`
- `Positioning`
- `Product preview`
- `Next tasks`

This rail is proof of work, not a public CTA.

- [ ] **Step 3: Mobile viewport rule**

On `390x844`, the first viewport must show brand, headline, short subhead, and the top of the artifact. Avoid making the hero longer than the screen before the artifact appears.

## Task 6: Replace Generic Cards

**Files:**
- Modify: `src/lib/services/onboarding/shared/landing-renderer-v2.ts`

- [ ] **Step 1: Remove active left-border card treatment**

Replace:

```css
border-left: 3px solid var(--accent);
border-radius: 0 var(--radius) var(--radius) 0;
```

With either:

```css
border-left: 3px solid var(--accent);
border-radius: 0;
```

Or:

```css
border: var(--border-w) solid var(--line);
border-radius: var(--radius);
```

Prefer the first only for editorial quote-like blocks and the second only for actual repeated items.

- [ ] **Step 2: Reduce card grid dominance**

Use one of:
- split explanation plus artifact
- numbered timeline
- comparison rows
- typographic statements
- product-output preview

Avoid making the page feel like a generic SaaS card stack.

## Task 7: Add Static Audit Script

**Files:**
- Create: `src/scripts/audit-onboarding-landing.ts`
- Modify: `package.json` only if scripts are already organized there.

- [ ] **Step 1: Implement HTML/CSS checks**

Audit generated HTML for:
- `href="#"`
- forbidden indigo/purple accent hexes
- `bg-gradient-to-r from-`
- emoji characters in headings, buttons, or icon slots
- `border-left` and `border-radius` on the same card selector
- missing `<h1>`
- missing generated artifact marker
- excessive accent usage in first viewport CSS selectors

- [ ] **Step 2: Run audit on generated samples**

Run:

```bash
npx tsx --env-file=.env.local src/scripts/test-landing-v2-render.ts
npx tsx src/scripts/audit-onboarding-landing.ts tmp-landing-v2-samples
```

Expected: audit exits `0` and prints all samples clean.

## Task 8: Visual Verification

**Files:**
- Modify: `src/scripts/test-landing-v2-render.ts`

- [ ] **Step 1: Generate fixtures**

Generate at least:
- CareerOps/job-search SaaS
- local clinic/service
- ecommerce product
- coaching/content business
- grow-company existing business

- [ ] **Step 2: Capture screenshots**

Run Playwright screenshots at:
- desktop `1440x1000`
- mobile `390x844`

- [ ] **Step 3: Manual acceptance checklist**

Each sample must pass:
- Brand is unmistakable in first viewport.
- Artifact appears above or near the fold.
- Copy clearly explains the business.
- Page does not look like a generic card template.
- No fake proof is invented.
- Mobile does not hide the product artifact too far below the fold.

## Task 9: Onboarding Shell Actions

**Files:**
- Search first for the onboarding preview UI that displays `ctx.landingPageBrief`.
- Likely modify the onboarding result/mission page component after locating it with `rg "landingPageBrief|Continue building|starter tasks|landing_url" src`.

- [ ] **Step 1: Show founder actions outside the generated HTML**

Render:
- `Continue building`
- `Edit this preview`
- `Generate roadmap`
- `Create starter tasks`

- [ ] **Step 2: Show one-minute work summary**

Render a compact checklist:
- Brand direction created
- Positioning drafted
- Preview published
- Starter tasks prepared

- [ ] **Step 3: Keep generated page clean**

Do not inject app controls into the hosted public preview unless it is inside a Polsia-only wrapper.

## Acceptance Criteria

- CareerOps-style sample has Baljia-level clarity and Polsia-level first impression energy.
- First viewport contains brand, clear promise, and a tangible artifact preview.
- Generated content includes founder-preview summary and artifact data.
- Active renderer no longer ships rounded cards with colored left borders.
- Static audit catches engineering-agent forbidden visual tells.
- Playwright screenshots show clean desktop and mobile layouts.
- Existing smoke scripts still pass:

```bash
npx tsx src/scripts/test-design-corpus.ts
npx tsx --env-file=.env.local src/scripts/test-landing-render.ts
npx tsx --env-file=.env.local src/scripts/test-landing-v2-render.ts
npx tsx --env-file=.env.local scripts/landing-pattern-calibration.ts
```

## Execution Order

1. Schema and type expansion.
2. Template-kind classifier.
3. Prompt rewrite.
4. Artifact renderer.
5. First-viewport redesign.
6. Generic-card cleanup.
7. Static audit.
8. Screenshot verification.
9. Onboarding shell founder actions.

This order keeps the generator valid at every checkpoint and lets visual work proceed from a stronger content contract rather than patching surface CSS first.
