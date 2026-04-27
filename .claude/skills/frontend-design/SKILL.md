# Skill: Frontend design for founder apps

**READ THIS BEFORE building any UI, landing page, dashboard, or HTML output.**

Founder apps render straight from the Worker — there's no separate React build step in most cases. You're producing HTML strings (or Hono JSX) that ship as-is.

## Tooling — Tailwind via CDN is the default

You will not have a build pipeline. Use Tailwind via CDN:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

Pros: zero setup, full Tailwind class set, works immediately.
Cons: ~50 KB hit on first load, no purging. Acceptable for v1 founder apps; not for high-traffic production.

For Tier 2/3 apps that warrant a real build → set up Vite + Tailwind locally, output to a single bundle, ship via R2 (`cf_deploy_app` with `with_r2_assets: true` + a route that serves the bundle).

## The Polsia + Baljia visual language

Match the platform's tone unless the founder explicitly wants something different:

- **Background:** dark warm (`#0E0B07` or near-black). Founder apps default to dark mode.
- **Accent:** gold `#F5A623` (use sparingly — single CTA, key metric, focus ring)
- **Body text:** off-white `#E8E4DD`, body font is sans (Inter / system-ui), display font is serif (Georgia / Source Serif)
- **Mono:** for timestamps, code, data — `JetBrains Mono` or `monospace`
- **Spacing:** 4/8/12/16/24/32 rhythm. No magic numbers.
- **Border radius:** 8px on cards, 12px on dialogs, full on pills/badges.

## Component patterns that work without a build step

### Card

```html
<div class="rounded-xl border border-white/10 bg-white/[0.02] p-5">
  <h3 class="text-sm font-medium text-white/60 mb-2">Revenue today</h3>
  <p class="text-3xl font-semibold tabular-nums">$2,418.00</p>
</div>
```

### Primary button

```html
<button class="rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-medium text-black hover:bg-[#FFB833] transition-colors">
  Save
</button>
```

### Form field

```html
<label class="block">
  <span class="text-sm font-medium text-white/80">Email</span>
  <input
    type="email"
    required
    class="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm focus:border-[#F5A623] focus:outline-none focus:ring-2 focus:ring-[#F5A623]/30"
  />
</label>
```

### Empty state

```html
<div class="text-center py-12">
  <p class="text-sm text-white/50">No items yet.</p>
  <p class="text-xs text-white/30 mt-1">Click "Create" to add your first one.</p>
</div>
```

## Mobile-first — always

```html
<div class="grid grid-cols-1 md:grid-cols-3 gap-4">...</div>
<!-- mobile = 1 column, ≥768px = 3 columns -->
```

If you write `grid-cols-3` without a `md:` prefix, you ship a desktop-only experience. Don't.

## Accessibility — the easy wins

- Every `<button>` and `<a>` gets readable text. No icon-only buttons without `aria-label`.
- Every `<img>` has `alt`. If decorative, `alt=""` (empty, not missing).
- Form labels: use `<label>` (visible) or `aria-label` (icon buttons). Never placeholder-only.
- Focus states: don't `outline: none` without replacing it. Tailwind's `focus:ring-2` is fine.
- Color contrast: gold on near-black hits AAA. Pure white on near-black is fine. White/40 on near-black fails AA — only use it for low-priority text.

## Layout primitives

- **Page max width:** `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`
- **Card grid:** `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- **Stack:** `flex flex-col gap-4`
- **Toolbar:** `flex items-center justify-between gap-4`

## Don't do these

- ❌ External CSS files via `<link rel="stylesheet">` — every extra request slows first paint and Workers caching adds complexity. Inline Tailwind via the CDN tag is fine.
- ❌ `<img>` without `width`/`height` — causes layout shift. Set them or use `aspect-ratio: 16/9`.
- ❌ Custom font files via `@font-face { src: url(...) }` — extra requests + CORS. Use system stacks or Google Fonts CDN if you must.
- ❌ Heavy JS frameworks (React, Vue) without a real build step — Tailwind CDN can't bundle them. If you need React, use a Tier 2 deploy with a proper bundle.
- ❌ Building a "complete design system" before shipping the feature. Use these primitives, ship, iterate.

## What "done" looks like for a UI task

A frontend task is verified when:
1. The page loads (status 200, body > 500 bytes — the platform checks this automatically)
2. The intended elements are present in the rendered HTML (your verify script does `fetch + check for marker text/IDs`)
3. The page renders without console errors (you can't directly check this from a Worker; mention in your report that visual QA is needed)
4. Mobile viewport doesn't break (test in DevTools or note "needs mobile review" in your report)

You CANNOT verify visually from the Worker. Be honest in your task report — say "API and HTML structure verified; visual review needed" rather than "shipping ✅."

## Reference: existing platform UI components

If the founder app should match the platform's look, mirror these classes from `src/components/dashboard/`:
- `.dashboard-shell` — page background + topbar
- `.task-preview-card` — content card
- `.chrome-button` — primary CTA
- `.micro-pill` — status badge
- `.thought-row` — chat bubble
