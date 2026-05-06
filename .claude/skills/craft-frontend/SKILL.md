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
