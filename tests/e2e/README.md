# Browser E2E tests

Playwright-driven UI tests that verify frontend + backend integration by hitting real pages and asserting DB-backed content renders.

## Two suites

- **`browser-smoke.spec.ts`** — public pages + auth + dashboard rendering (6 tests, fast)
- **`ceo-tools.spec.ts`** — full chat → CEO tool → DB → frontend loop for all 40 CEO tools (12 tests, ~10min)

## Run the CEO-tools suite

```bash
# All CEO-tool tests (auto-starts dev server on port 3000)
npx playwright test ceo-tools

# Single test
npx playwright test ceo-tools -g "create_task"

# Against an already-running dev server on a different port
PLAYWRIGHT_PORT=3003 npx playwright test ceo-tools
```

## What ceo-tools.spec.ts covers

11 chat-driven tests (real LLM, real DB, real frontend) + 1 direct-API regression that exercises all 40 tools:

| Test | What it proves |
|---|---|
| create_task | Chat → LLM → tool → DB → dashboard refresh in ~20ms (validates the on-action refresh hook in `DashboardShell`) |
| edit_task | Chat → DB rename, UI shows after reload (edit_task doesn't emit a ChatAction, so 30s polling fallback applies) |
| reject_task | Chat → DB status='rejected' (same polling fallback) |
| update_link | Chat → `dashboard_links` insert (note: dashboard's Links section currently renders hardcoded URLs, doesn't surface this table — known product gap) |
| get_credit_balance | Chat returns current balance |
| get_context | Chat returns company info / plan |
| list_available_modules + list_mcp_servers | Chat enumerates worker agents and integrations |
| find_best_agent | Chat routes a description to the right agent |
| web_search | Chat searches via Tavily and cites sources |
| get_tasks | Chat lists current task queue |
| read_memory | Chat reads memory layer 1 |
| **all 40 tools (direct-API regression)** | Runs `src/scripts/test-all-ceo-tools.ts` inline, asserting `40 PASS · 0 FAIL · 0 SKIP` |

## Helpers

- `helpers/chat.ts` — `sendChat(page, message)` types into the FounderChatRail input, presses Enter, waits for the streaming response to settle, and returns the final assistant reply
- `helpers/dashboard.ts` — `getTaskCount`, `waitForTaskByTitle`, `waitForLinkByLabel`, etc. for asserting against rendered dashboard state
- `helpers/fixture.ts` — `pickTestCompany` (most-recent completed company), `authenticateAs` (sets `baljia-session` cookie), `ensureCredits` (tops up via `creditService.addCredit`), `resetChatSession` (deactivates current chat session so each test starts with fresh LLM context)

## Why each test resets the chat session

Long chat histories cause the LLM to hallucinate replies — claiming "I've created the task..." without actually invoking the tool. `resetChatSession` deactivates the current session in `beforeEach` so every test starts with a clean prompt context. This eliminated the most common source of test flakiness.

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

- `browser-smoke.spec.ts` (after warm compile): **6/6 passing** across public pages and authenticated UI.
- `ceo-tools.spec.ts` (warm dev server): **12/12 passing in ~9.7 min**. create_task → dashboard refresh measured at 17–88ms (vs. up-to-30s before the fix).
