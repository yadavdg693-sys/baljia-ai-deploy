# Browser smoke tests

Playwright-driven UI tests that verify frontend + backend integration by hitting real pages and asserting DB-backed content renders.

## Run

```bash
# All tests (auto-starts dev server on port 3000)
npx playwright test

# Specific test
npx playwright test -g "dashboard renders"

# Against an already-running dev server on a different port
PLAYWRIGHT_PORT=3003 npx playwright test
```

## What's covered

| Test | Checks |
|---|---|
| Public pages › landing | `/` returns 200 with "baljia" in body |
| Public pages › login | `/login` renders email input or OAuth button |
| Public pages › FAQ | `/faq` renders |
| Authenticated UI › onboarding | `/onboarding` shows journey chooser buttons (fresh user with no company) |
| Authenticated UI › dashboard | `/dashboard/{id}` renders the company name + starter tasks from DB |
| Authenticated UI › public company | `/company/{slug}` serves the generated landing HTML |

## Prerequisites

1. `.env.local` populated with `DATABASE_URL`, `AUTH_SECRET`
2. `scripts/smoke-test-onboarding.ts` has run at least once to seed a completed `smoke-test@baljia.app` user + company — or the dashboard/public-company tests will skip

## Auth model

Tests skip the magic-link flow. They sign a JWT directly using `signJWT()` from `@/lib/auth` and set it as a `baljia-session` cookie on the Playwright browser context.

See [helpers/auth.ts](helpers/auth.ts).

## Known issues

- **Next.js 15 on Windows — first compile is slow**: first run of the dashboard test takes ~8 minutes due to cold webpack compilation of the heavy dashboard shell. Occasionally the first compile hits "jest worker encountered child process exceptions" — re-running with a warm cache passes cleanly (verified 1 passed in 8.7m after first-compile crash).
- **Subdomain routing**: local dev doesn't resolve `{slug}.baljia.app` — the public-company test hits `/company/{slug}` explicitly instead.

## Verified results

Full suite run (after warm compile): **6/6 passing** across public pages (landing, login, FAQ) and authenticated UI (onboarding chooser, dashboard render, public company page).
