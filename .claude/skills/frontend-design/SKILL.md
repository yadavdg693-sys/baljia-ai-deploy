# Skill: Frontend design for founder apps

**READ THIS BEFORE building any UI, landing page, dashboard, or in-app screen.**

The default deploy is a Git-backed Render web service. For anything a real user sees, the default stack is **Next.js 15 + shadcn/ui + Tailwind + Better Auth + Drizzle + Neon**, and the default visual foundation is **one of the 149 design-language references** in the design-systems catalog. Express + hand-rolled HTML is the fallback only for backend-only services.

## Step 0 — pick your stack BEFORE writing code

| If the task is… | Stack | First tool |
|---|---|---|
| Any landing page, dashboard, chat UI, signup flow, founder app | **Next.js + shadcn/ui** | `github_fork_skeleton` |
| Pure JSON API, webhook receiver, cron worker — NO user-facing pages | Express + Node | `fork_express_skeleton` |
| Internal admin tool only the founder uses, no auth, ≤2 pages | Either — Next.js is still cleaner | `github_fork_skeleton` |

If you forked Express on a task that has any UI: stop, restart with `github_fork_skeleton`. The completion gate will block the task otherwise.

## Step 1 — pick a design language

Call `match_design_system` with the founder app brief. Use its top matches as the shortlist, then pick ONE name whose category + tagline matches the founder's product:

| Category match | Strong picks |
|---|---|
| Fintech / payments / banking | `stripe`, `coinbase`, `wise` |
| AI / LLM / chat product | `linear-app`, `claude`, `openai`, `replicate` |
| Developer tools / infra | `vercel`, `linear-app`, `github`, `hashicorp` |
| Productivity / SaaS / project mgmt | `linear-app`, `notion`, `framer` |
| Marketplace / consumer / e-commerce | `airbnb`, `shopify` |
| Editorial / content / publishing | `editorial`, `notion`, `mintlify` |
| Internal dashboard / ops tool | `dashboard`, `mission-control`, `huggingface` |
| Bold / brutalist / creative agency | `brutalism`, `neobrutalism`, `bold` |
| Luxury / premium / hardware | `apple`, `bmw`, `tesla` |

Then call `get_design_system(name)` and READ the spec (~18KB). Apply the **conventions** — exact palette hex codes, font family + weight + letter-spacing values, shadow stacks, border-radius scale, motion vocabulary.

**Apply the conventions, not the brand identity.** Borrow Stripe's "weight 300 at display sizes with -1.4px letter-spacing"; do NOT reuse Stripe's exact `#533afd` on a competing fintech product. Rename palettes to fit the founder's brand. If the system lists "Stripe Purple", call it "Brand Indigo" in the founder's app.

If no system matches, default to `linear-app` for dark SaaS or `vercel` for light dev-tools. Don't invent a palette from scratch.

## Step 2 — use the components that already exist

Every `github_fork_skeleton` fork ships with 14 shadcn/ui components at `components/ui/` (button, card, input, label, dialog, badge, dropdown-menu, tabs, textarea, scroll-area, skeleton, sonner, etc.).

- Call `list_components` to see the catalog.
- Call `read_component(name)` to see exact props before importing.
- **Hand-rolling `<button>` / `<div className="card">` / `<input>` is a quality-bar violation.** Import from `@/components/ui/...`.

For icons, use `lucide-react`. Monoline at 1.6-1.8px stroke, default 24px. Never emoji in `<h*>`, button text, or icon slots.

## Step 3 — Frontend Quality Bar (hard fails)

These are P0. If any are present, `design_audit` + `design_critique` will block task completion:

1. **No Tailwind default indigo** (`#6366f1`, `#4f46e5`, `from-indigo-*`). Use the resolved design system's accent.
2. **No two-stop trust gradients** (purple→blue, indigo→pink, blue→cyan on hero). Flat surface + typography wins.
3. **No emoji in `<h1>` / `<h2>` / `<button>` / icon slots.** Use lucide-react.
4. **No filler copy** — `lorem ipsum`, `feature one / two / three`, `placeholder text`, `sample content`. Either real product copy or rework the section.
5. **No `text-center max-w-2xl mx-auto` hero** — the AI-default tell. Left-align with intentional anchor (illustration, code preview, screenshot) OR center only when typography justifies it.
6. **No symmetric `grid grid-cols-3 gap-8` feature grid** — use `grid-cols-2` or asymmetric (`md:grid-cols-[2fr_1fr]`).
7. **No "rounded card with colored left-border accent."** Drop the radius or drop the left border; keep one.
8. **No invented metrics** — "10× faster", "99.9% uptime", "3× more productive" without a cited source.
9. **No API documentation, curl examples, or HTTP method badges on a public user landing.** Those belong at `/docs`. The `/` route is for end users.

## Step 4 — soul / distinctive choice (P1, fix before stopping)

`design_critique` will flag this as a BLOCKER if absent: at least ONE unconventional move that identifies the page as a specific product, not a template:

- A bold typography choice (the Stripe weight-300 effect, the Linear -1.584px tracking)
- A non-template section (comparison-against-status-quo, inline mini-demo, kbd shortcut wall, custom microcopy block)
- A unique micro-interaction (button depresses 2px, number counts up, focus ring shapes itself to content)

The "Hero → 3-Feature-Grid → Pricing → FAQ → CTA" canonical AI template is a fail. At least one section must break it.

## Mobile state (P0)

- Test at 390×844 in your head. No horizontal scroll. CTAs reachable with thumb. Font size ≥ 16px for body to prevent iOS zoom.
- One column on mobile, columns added at `md:` / `lg:` breakpoints — never the other direction.
- Tap targets ≥ 40px high. No hover-only primary actions.
- Long titles wrap cleanly; no clipped button text.

## Accessibility minimums

- Every input has a `<Label htmlFor>`. Every button has readable text or `aria-label`.
- Every visible button/link-button, select, dropdown trigger, and native `option` row must have readable foreground/background contrast. White text on white/light buttons, black text on dark cards, and default white native dropdown menus in dark UIs are blocker bugs.
- For dark themes, style both `select` and `option` explicitly, for example dark option background plus light foreground. Do not rely on browser default dropdown colors.
- Focus state must be visible (`focus-visible:ring-ring` is built into shadcn — don't override).
- Error messages say what failed AND how to recover.
- Keyboard-only navigation must work end-to-end.

## Verification — when is the task done

A frontend task is done when ALL of:

1. `render_get_deploy_status` returns `live`.
2. `render_get_logs` shows no `error` / `fatal` lines on startup or first request.
3. `check_url_health` returns 2xx on `/` (and `/api/health` if it exists).
4. `verify_user_journey` returns PASS on the highest-value flow (register → reach dashboard → submit form → see result → log out → log in → still there).
5. `design_audit` returns CLEAN (0 HIGH findings) on the deployed URL.
6. `design_critique` returns score ≥ 7 with 0 BLOCKERs on the deployed URL.

If any of (4)-(6) fails: read the failure detail, fix the underlying code, push, redeploy, re-run. Do NOT mark complete with open BLOCKERs.

## Common anti-patterns this skill defends against

- **Hand-rolled buttons / cards / inputs** with inline `style="..."` → use `@/components/ui/...`.
- **Default Tailwind palette as accent** → use the design system's resolved accent token.
- **Bare centered hero `<h1>` + `<p>` + `<button>`** → introduce a visual anchor or left-align.
- **`<div className="border rounded-lg p-4">` content block** → use `<Card>`.
- **`<input>` without `<Label>`** → import both, every time.
- **Emoji as feature icons** → `lucide-react` monoline.
- **"Coming soon" or "feature one" placeholder content** → don't ship the section until you have real copy.
