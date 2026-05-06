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
