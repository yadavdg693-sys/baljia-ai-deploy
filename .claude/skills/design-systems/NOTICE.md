# Design Systems Catalog — Attribution & Usage Notice

The 149 `<system>/DESIGN.md` files in this directory are vendored from
[nexu-io/open-design](https://github.com/nexu-io/open-design) under the
Apache License 2.0. Original work © nexu-io and contributors. The
`LICENSE` file in this directory is the upstream Apache 2.0 license.

## What these files are

Each `<name>/DESIGN.md` is a 15-22KB design-language analysis of a real
shipped product (Linear, Stripe, Notion, Vercel, etc.). It documents the
*conventions* that make that product's UI feel distinctive: exact palette
hex codes, font families, type weights, letter-spacing values, shadow
stacks, border-radius scale, accent restraint, motion vocabulary.

## What these files are NOT

- They are **not** licenses to copy a brand wholesale. "Inspired by
  Stripe" means take the typographic conventions (weight 300 at display
  sizes, blue-tinted shadows, navy-not-black headings), NOT clone Stripe's
  identity into a competing fintech product.
- They are **not** wireframes or page layouts. They describe the design
  *grammar*, not the page composition.

## How the Engineering Agent uses them

1. **Call `list_design_systems()`** to see all 149 names with category +
   one-line description.
2. **Call `get_design_system(name)`** to load the full DESIGN.md for a
   specific system before writing landing/dashboard code.
3. **Apply the conventions**, not the brand. Borrow the type weights,
   palette structure, and shadow approach; rename palettes to the
   founder's brand; never reuse a competitor's exact accent without good
   reason.

## Update procedure

Bump the upstream commit referenced below and re-vendor:

```bash
# Upstream source: github.com/nexu-io/open-design, design-systems/
# Vendored: 2026-05-12
# Refresh: download a fresh tarball, replace this directory, keep LICENSE.
```
