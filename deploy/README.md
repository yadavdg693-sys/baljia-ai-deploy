# Baljia Frontend Fixes — Complete Package

## Quick Start

```bash
# 1. Unzip this package
# 2. Copy everything from deploy/ into your baljia-ai-cf repo:

cp -r deploy/src/* /path/to/baljia-ai-cf/src/
cp deploy/public/mascot.png /path/to/baljia-ai-cf/public/mascot.png

# 3. Apply the polsia-shell.css patch (see MANUAL PATCHES section below)

# 4. Test
cd /path/to/baljia-ai-cf
npm run dev
```

## What's In This Package

```
deploy/
├── public/
│   └── mascot.png                          ← Real mascot image for /public
├── src/
│   ├── app/
│   │   ├── globals.css                     ← Unified warm cream + dark mode theme
│   │   ├── layout.tsx                      ← Font loading + anti-flash script
│   │   ├── page.tsx                        ← Landing page redesign + theme toggle
│   │   ├── not-found.tsx                   ← 404 page (warm cream)
│   │   └── (auth)/
│   │       └── login/
│   │           └── page.tsx                ← Login page (warm cream, was dark)
│   ├── components/
│   │   ├── ui/
│   │   │   └── ThemeToggle.tsx             ← NEW: dark/light toggle component
│   │   ├── dashboard/
│   │   │   ├── DashboardShell.tsx          ← 5 critical fixes (see below)
│   │   │   ├── DocumentDialog.tsx          ← JSON content rendering fix
│   │   │   └── DocumentList.tsx            ← is_empty filter fix
│   │   ├── chat/
│   │   │   └── FounderChatRail.tsx         ← "How It Works" copy fix + mascot
│   │   └── mascot/
│   │       └── BaljiaMascot.tsx            ← Real image (was emoji)
│   └── lib/
│       └── services/
│           └── onboarding/
│               └── shared/
│                   └── landing-premium-styles.ts  ← NEW: premium CSS for generated pages
```

## All 14 Fixes Explained

### 🔴 CRITICAL (breaks core functionality)

**Fix 1: globals.css — Unified theme**
- WAS: Dark surfaces (#0A0A0B) — login/onboarding/404 all dark, dashboard light = jarring
- NOW: Warm cream (#FCFBF8) light + rich dark (#14110D) dark, togglable via body.dark class
- All colors use CSS custom properties (--bg, --ink, --text-muted, etc.)

**Fix 2: layout.tsx — Font loading**
- WAS: Satoshi + General Sans referenced but never imported → system font fallback
- NOW: Newsreader + Inter + JetBrains Mono loaded via Google Fonts
- Also: anti-flash script prevents white flash on dark-mode page load
- Also: mascot.png as favicon

**Fix 3: DashboardShell.tsx — 5 fixes in one file**
- FIX A: `handleApprove` now calls `/api/tasks/{id}/approve` (was local-state only)
- FIX B: `handleReject` now calls `/api/tasks/{id}/reject` (was local-state only)
- FIX C: `DocumentSuggestionPanel` wired in (was imported but never rendered)
- FIX D: Documents filter shows docs with content even if `is_empty` flag is stale
- FIX E: Auto-refresh every 30s via `/api/dashboard?company_id=X`

**Fix 4: DocumentDialog.tsx — JSON content rendering**
- WAS: Market research stored as JSON renders as raw `{"competitors":[...]}`
- NOW: Auto-detects JSON content, formats into readable markdown sections
- Handles: market_research (competitors table, demand signals, etc.), mission (3-section)

**Fix 5: DocumentList.tsx — Filter fix**
- WAS: `documents.filter(d => !d.is_empty)` — misses docs where is_empty wasn't updated
- NOW: `documents.filter(d => !d.is_empty || (d.content && d.content.trim().length > 0))`

### 🟡 IMPORTANT (wrong content / broken UX)

**Fix 6: FounderChatRail.tsx — "How It Works" copy**
- WAS: Describes browser agent sessions ("Agent opens a real browser session...")
- NOW: Describes Baljia workflow ("Tell Baljia what you want... CEO scopes... agent executes...")
- Also: Real mascot image in chat header + message bubbles

**Fix 7: BaljiaMascot.tsx — Real mascot image**
- WAS: Emoji rendering (👁️⚡🧠) in a rounded box
- NOW: `/mascot.png` with state-driven glow effects (gold for listening, purple for planning, etc.)

**Fix 8: page.tsx (landing) — Full redesign**
- WAS: Bare-bones title + paragraph + button
- NOW: Hero with mascot + console, features grid, how-it-works timeline, stats, footer
- Matches waitlist page aesthetic (warm cream + gold)
- Includes ThemeToggle for dark/light switching

**Fix 9: login/page.tsx — Warm cream theme**
- WAS: Dark background (#0A0A0B) with dark cards — jarring transition from landing
- NOW: Warm cream background matching the rest of the app
- Same functionality: Google OAuth + magic link

**Fix 10: not-found.tsx — Warm cream theme**
- WAS: Dark background with dark surface colors
- NOW: Warm cream with mascot image, gold 404 heading

### 🟢 NEW FEATURES

**Fix 11: ThemeToggle.tsx — Dark/light mode**
- NEW component at `src/components/ui/ThemeToggle.tsx`
- Persists to localStorage as `baljia-theme`
- Respects `prefers-color-scheme` on first visit
- Sun/moon icons, rotates on hover
- Add `<ThemeToggle />` to any nav/header to enable

**Fix 12: landing-premium-styles.ts — Premium generated landing pages**
- NEW file at `src/lib/services/onboarding/shared/landing-premium-styles.ts`
- Adds to GENERATED founder landing pages (not the Baljia site itself):
  - Ambient aurora gradient background
  - Grain texture overlay
  - Scroll-reveal animations (IntersectionObserver)
  - Dark mode support (prefers-color-scheme)
  - Card hover micro-interactions
  - Branded "Built by Baljia AI" footer with mascot
- See MANUAL PATCHES section for wiring instructions

## MANUAL PATCHES (can't be copy-pasted)

### Patch A: polsia-shell.css (lines 1-14)

Open `src/styles/polsia-shell.css` and replace the first `:root` block (lines 1-14) with:

```css
:root {
  color: #1E1A16;
  background: #FCFBF8;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  line-height: 1.45;
  font-weight: 400;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  --bg: #FCFBF8;
  --ink: #1E1A16;
  --muted: #5C5147;
  --line: #DED6CA;
  --line-dark: #B8AC9D;
  --panel: #F4F2EC;
  --panel-strong: #EAE5DD;
  --orange: #D97706;
  --danger: #B91C1C;
  --shadow: 0 18px 36px rgba(24, 18, 10, 0.10);
}
```

Also find the `.serif, h1, h2, h3` block (~line 54) and change to:
```css
.serif, h1, h2, h3 {
  font-family: 'Newsreader', Georgia, "Times New Roman", serif;
}
```

Also find `.site-shell, .dashboard-shell` (~line 62) and change background to:
```css
.site-shell, .dashboard-shell {
  min-height: 100vh;
  background: #FCFBF8;
}
```

### Patch B: Wire premium styles into landing.ts (OPTIONAL)

1. Copy `landing-premium-styles.ts` to `src/lib/services/onboarding/shared/`
2. In `landing.ts`, add import:
   ```ts
   import { getPremiumBaseStyles, getPremiumRootExtras, getPremiumScript } from './landing-premium-styles';
   ```
3. In `renderRootStyles()`, before closing `}` of `:root`, add:
   ```ts
   ${getPremiumRootExtras()}
   ```
4. In `renderLandingHtml()`, add after `renderBaseStyles()`:
   ```ts
   ${getPremiumBaseStyles(tokens.accent)}
   ```
5. In `renderLandingHtml()`, add before `</body>`:
   ```ts
   ${getPremiumScript()}
   ```

## Pre-requisites

- Copy `mascot.png` to `public/mascot.png` (the image from your waitlist page)
- Ensure `ANTHROPIC_API_KEY` is set in `.env.local` for CEO chat to work
- Run `npm run dev` to verify everything compiles

## What These Fixes DON'T Change

- No database schema changes
- No API route changes
- No backend logic changes
- No new npm dependencies
- No changes to: onboarding flow, task execution, agent system, billing, auth
- All changes are frontend-only (except the optional landing-premium-styles.ts)
