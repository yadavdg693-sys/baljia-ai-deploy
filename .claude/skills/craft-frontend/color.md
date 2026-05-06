> Adapted from [nexu-io/open-design](https://github.com/nexu-io/open-design) `craft/color.md` (Apache License 2.0).
> Upstream: https://github.com/nexu-io/open-design/blob/2afb002a6285f92ec80e6cee97f867dc7a680a77/craft/color.md
> Local adaptations: skeleton-native language (shadcn CSS tokens via Tailwind classes), drop data-od-id, drop lint-artifact references.
> Upstream attribution preserved below where applicable.

# Color craft rules

Universal color rules applied on top of the skeleton's `app/globals.css` shadcn/ui CSS variables. The
design system supplies the palette tokens; this file enforces how to
*use* them.

> Adapted from [refero_skill](https://github.com/referodesign/refero_skill)
> (MIT). All examples reference the skeleton's standard tokens
> (`--background`, `--card`, `--foreground`, `--muted`, `--border`, `--accent`),
> consumed via Tailwind classes (`bg-background`, `bg-card`, `text-foreground`,
> `text-muted-foreground`, `border-border`, `bg-accent`, `text-accent-foreground`).

## Palette structure

A coherent palette has four layers. Plan all four before writing any CSS.

| Layer | Share of pixels | Tokens |
|---|---|---|
| **Neutrals** | 70–90% | `--background`, `--card`, `--foreground`, `--muted`, `--border` |
| **Accent** (one) | 5–10% | `--accent` only — never invent a second accent |
| **Semantic** | 0–5% | `--destructive` (danger); extend with `--success`, `--warn` if needed |
| **Effect** | <1% | gradients, glows; rarely justified |

## Accent discipline

The single biggest readability failure in AI-generated UIs is accent
overuse. Hard caps:

- **At most 2 visible uses of `--accent` per screen.** Typical pair:
  one eyebrow / chip + one primary CTA. Or one accent card + one tab
  pill. Pick a pair, not a flood.
- Links count as accent; demote to `--foreground` underline if you also have a
  CTA on the same screen.
- Hover/focus rings count as accent. Ration accordingly.

## Contrast minimums

Run these as gates, not goals:

| Pair | Minimum |
|---|---|
| Body text (≤16 px) on background | **4.5:1** |
| Large text (>18 px or 14 px bold) | **3:1** |
| UI components against adjacent surfaces | **3:1** |

When the brand color clashes (low-contrast indigo on light background is
common), darken the accent to a `600`-level shade for text use; reserve
the brand-bright variant for fills only.

## Dark themes

Avoid pure black and pure white — both cause vibration and eye strain.

| Token | Dark theme | Light theme |
|---|---|---|
| Background | `#0f0f0f` (not `#000`) | `#fafafa` (not `#fff`) |
| Foreground | `#f0f0f0` (not `#fff`) | `#111111` (not `#000`) |

On dark surfaces, prefer **semi-transparent white borders** over solid
dark borders — a 1px `rgba(255,255,255,0.08)` reads as structure
without adding visual noise.

## Semantic color naming

Always name tokens by **purpose**, never by hue:

```css
/* good */
--accent: #2f6feb;
--success: #17a34a;

/* bad — locks you out of theming */
--blue-500: #2f6feb;
--green-500: #17a34a;
```

## Anti-defaults

- **Indigo `#6366f1`** (Tailwind `indigo-500`) is the most reliable
  AI-slop tell. The skeleton's `app/globals.css` provides `--accent`; use it via
  `bg-accent` / `text-accent-foreground`. If the brief truly needs indigo,
  make the user say so explicitly. If the design system encodes indigo as
  `--accent`, that is intentional — the verifier only flags hardcoded hex,
  so `var(--accent)` uses are unaffected even when the resolved color happens
  to be `#6366f1`.
- **Two-stop "trust" gradient** (purple → blue, blue → cyan, etc.) on a
  hero is the second most reliable tell. A flat surface + one
  type-driven hierarchy beats it every time.
- **Decorative gradients with no functional purpose**. Gradients should
  separate hierarchies (header → body, primary CTA → secondary), not
  decorate empty space.
