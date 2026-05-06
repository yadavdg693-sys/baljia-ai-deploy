> Adapted from [nexu-io/open-design](https://github.com/nexu-io/open-design) `craft/anti-ai-slop.md` (Apache License 2.0).
> Upstream: https://github.com/nexu-io/open-design/blob/2afb002a6285f92ec80e6cee97f867dc7a680a77/craft/anti-ai-slop.md
> Local adaptations: skeleton-native language (shadcn CSS tokens via Tailwind classes), drop data-od-id, drop lint-artifact references.
> Upstream attribution preserved below where applicable.

# Anti-AI-slop rules

Concrete, checkable rules that distinguish "designed by a human who has
shipped product" from "default LLM output." Several rules below are
guidance for the agent and the verifier; not auto-enforced today. The
rest are guidance for agents and reviewers and are flagged inline as
"(guidance, not auto-checked)" so the contract with the verifier stays
honest.

> Adapted from [refero_skill](https://github.com/referodesign/refero_skill)
> (MIT), tightened to match Open Design's lint surface.

## The seven cardinal sins

These are the patterns that must be caught and fixed (P0 — must-fix):

1. **Default Tailwind indigo as accent** — exactly `#6366f1`, `#4f46e5`,
   `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`, `#a855f7`. The skeleton's
   `app/globals.css` provides `--accent`; consume it via the Tailwind class
   `bg-accent` / `text-accent-foreground`. Indigo is the textbook AI
   tell. (Flag any of these hardcoded hexes as a solid accent — keep this
   list in sync with the forbidden-hex guidance in the Engineering agent
   prompt.)
2. **Two-stop "trust" gradient on the hero** — purple→blue, blue→cyan,
   indigo→pink. A flat surface + intentional type beats this every
   time.
3. **Emoji as feature icons** — `✨`, `🚀`, `🎯`, `⚡`, `🔥`, `💡`
   inside `<h*>`, `<button>`, `<li>`, or `class*="icon"`. Use
   1.6–1.8px-stroke monoline SVG with `currentColor`.
4. **Sans-serif on display text when the seed binds a serif** — h1/h2
   must use `var(--font-display)`, not a hardcoded Inter / Roboto /
   `system-ui`.
5. **Rounded card with a colored left-border accent** — the canonical
   "AI dashboard tile" shape. Drop either the radius or the left
   border.
6. **Invented metrics** — "10× faster", "99.9% uptime", "3× more
   productive". Either pull from a real source or use a labelled
   placeholder.
7. **Filler copy** — `lorem ipsum`, `feature one / two / three`,
   `placeholder text`, `sample content`. An empty section is a design
   problem to solve with composition, not by inventing words.

## Soft tells (P1 — should fix)

- **Standard "Hero → Features → Pricing → FAQ → CTA" sequence with no
  variation** *(guidance, not auto-checked)*. This is the AI-template
  skeleton; introduce at least one unconventional section (testimonial
  wall as full-bleed quote, pricing as comparison-against-status-quo,
  an inline mini-product-demo).
- **External placeholder image CDNs** (`unsplash.com`, `placehold.co`,
  `placekitten.com`, `picsum.photos`). Fragile and obvious. Use the
  shipped `.ph-img` placeholder class.
- **More than ~12 raw hex values outside `:root`.** Tokens were not
  honoured.
- **`var(--accent)` used 6+ times in the rendered body.** Cap at 2
  visible uses per screen.

## Polish tells (P2 — nice to fix)

- **Decorative blob / wave SVG backgrounds** *(guidance, not
  auto-checked)* — meaningless geometry.
- **Perfect symmetric layout with no visual tension** *(guidance, not
  auto-checked)* — alternating density (one tight section, one
  breathing section) reads as intentional.

## How to add soul without breaking the rules

Aim for **~80% proven patterns + ~20% distinctive choice**. The 20%
should live in:

- One bold visual move — a typography choice, a single color decision,
  an unexpected proportion.
- Voice and microcopy — a button that says "Start tracking" beats one
  that says "Get started".
- One micro-interaction the user will remember — a button press that
  moves 2px, a number that counts up.
- One detail that could only have been put there by someone who used
  the product (a subtle kbd shortcut hint, a status badge with
  product-specific phrasing).

If a reviewer screenshots the artifact and someone outside the project
can identify which product it's from — you have soul. If not, you
shipped a template.
