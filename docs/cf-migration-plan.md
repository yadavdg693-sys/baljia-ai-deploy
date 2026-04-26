# Cloudflare Migration Plan — Autonomous Execution

**Status:** Ready to execute
**Date:** April 23, 2026
**Working directory:** `C:\Users\Vaishnavi\My_Projects\baljia-ai-cf` (cloudflare-spike branch)
**Main directory:** `C:\Users\Vaishnavi\My_Projects\baljia-ai` (main branch — NOT touched during migration)
**Total estimate:** 10-13 working days of autonomous work, ending at a deployed + tested CF Worker ready for production DNS cutover
**Handoff checkpoints:** clearly marked daily stops where you can review progress before continuing

---

## What I'm solving for

Take the validated CF spike (platform runtime verified, Workflows pattern proven, real Gemini calls succeeded) and deliver a **production-ready Cloudflare Worker deployment** of Baljia that matches Render's current capabilities, is smoke-tested, and is one DNS-cutover away from going live.

## What I can do autonomously (no user involvement)

Using the CF API token already in `baljia-ai-cf/.env.local` (verified Workers:Edit + Zone DNS + Workers Routes permissions):

- All code changes on the `cloudflare-spike` branch
- `wrangler secret put` for all 24 env vars
- `wrangler deploy` to `baljia-cf-spike.*.workers.dev` (free test URL)
- Create Worker Routes for `*.baljia.app/*`
- Create Custom Domain bindings for `baljia.ai` (in staging — **NOT** attached to production traffic until you approve)
- DNS record creation/modification in Cloudflare zones
- Smoke testing via `curl`, `wrangler tail`, local Playwright
- Commit everything to `cloudflare-spike` branch with clear messages
- Write documentation and per-phase status updates

## What I will NOT do without asking you

- Merge `cloudflare-spike` → `main` (you review + approve first)
- Touch anything in `baljia-ai/` main folder
- DNS changes that affect production traffic on `baljia.ai` apex (apex A/CNAME swap)
- Point `*.baljia.app` wildcard away from Render if any production founders exist
- Delete any resources (Render services, old DNS records, etc.)
- Decisions that cost money (Cloudflare Images subscription, new SaaS services)
- Architectural decisions about founder product deployments (Tier 3 — keep on Render vs migrate to Sandboxes)

---

## Phase overview

| Phase | Days | Deliverable | Handoff checkpoint |
|---|---|---|---|
| **Phase 0** | 0.5 | Clean up spike hacks, TS errors, pre-flight | Build passes with strict TS |
| **Phase 1** | 3-5 | `worker-launcher` → Workflows v2 port | Agent task runs end-to-end on CF Workflow (mock or real task via wrangler dev) |
| **Phase 2** | 1 | OpenNext wrapper (fetch + Workflow + scheduled) | One cron fires via `wrangler dev --test-scheduled` + Workflow triggers from /api/worker/launch |
| **Phase 3** | 1 | Sentry/observability workaround | Errors visible in `wrangler tail` or Logflare |
| **Phase 4** | 1 | Wildcard `*.baljia.app` routing | `curl https://testslug.baljia.app/` → correct company landing (staging) |
| **Phase 5** | 1 | Real deploy + secrets upload + smoke test | Live at `baljia-cf-spike.*.workers.dev` with full functionality |
| **Phase 6** | 0.5-1 | Playwright E2E against deployed URL | Test suite passing against live CF Worker |
| **Phase 7** | 0.5 | Docs update + merge plan | PR ready for `cloudflare-spike` → `main`, CLAUDE.md drafted |
| **Final** | — | Wait for your DNS cutover approval | — |

**Total:** 8.5-11 days of focused autonomous work.

---

## Phase 0 — Pre-flight cleanup (0.5 day)

### Goal
Remove spike-specific hacks. Get build passing with strict settings so production doesn't silently ship type errors.

### Tasks

**P0.1: Fix real TypeScript errors in `scripts/`**
- `scripts/check-markmeld.ts` — already fixed in spike
- `scripts/test-bedrock.ts:50` — type predicate error on Anthropic TextBlock
- Any other hidden TS errors surfaced by strict build

**P0.2: Remove spike hacks in `next.config.ts`**
```diff
- typescript: { ignoreBuildErrors: true },
- eslint: { ignoreDuringBuilds: true },
```
Rebuild. Fix any real errors that surface.

**P0.3: Audit `ioredis` dependency**
- Grep for actual production usage
- If only in scripts → remove from package.json
- If in production → document the single use case (Redis TCP on Render only; remove for CF)

**P0.4: Audit `txDb` WebSocket Pool usage (critical)**
- `src/lib/db/client.ts:18` creates `drizzleWs(pool, ...)` for advisory locks
- Grep for `txDb` usage across `src/`
- For each use: verify the call works on CF Workers runtime (WebSocket Pool from `@neondatabase/serverless` should work)
- If WebSocket Pool is broken on CF: replace with HTTP-based alternative
  - For advisory locks: use PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` or Upstash Redis lock
- Document findings in SPIKE-NOTES

**P0.5: Verify Sentry config works**
- `sentry.server.config.ts`, `sentry.client.config.ts`, `instrumentation.ts`
- Current build includes `@sentry/nextjs` but has known AsyncLocalStorage issues on Workers
- Decision gate: keep & workaround, OR swap to `@sentry/cloudflare`, OR disable for first launch

### Checkpoint artifacts
- `baljia-ai-cf/` build passes with `typescript.ignoreBuildErrors: false`
- Commit: "Phase 0: cleanup spike hacks, strict build passes"

### Risks
- Hidden TS errors might reveal real bugs → prioritize fixing vs stubbing
- `txDb` incompatibility on Workers → would need pattern change; may add half-day

---

## Phase 1 — Port `worker-launcher.ts` → Workflows v2 (3-5 days)

### Goal
Replace the monolithic `launchTask()` HTTP handler with a Cloudflare Workflow that orchestrates agent execution as checkpointed steps. This is the biggest and highest-risk piece.

### Mapping

Current `worker-launcher.launchTask(taskId)` does (approximately) 11 operations. Each becomes a `step.do()`:

```
launchTask(taskId):
  1. getTask(taskId)                  →  step.do('load-task', ...)
  2. check company lifecycle          →  step.do('check-lifecycle', ...)
  3. canExecuteTask (guardrail)       →  step.do('check-guardrail', ...)
  4. circuit breaker retry count      →  step.do('check-retry-budget', ...)
  5. routeTask (agent selection)      →  step.do('route-agent', ...)
  6. claimSlotAndCharge               →  step.do('claim-credit', ...)
  7. buildContextPacket               →  step.do('build-context', ...)
  8. buildPermissionSnapshot          →  step.do('build-permissions', ...)
  9. executeAgent (agent loop)        →  step.do('execute-agent', ...)  [may split]
  10. verifyAndUpdate                 →  step.do('verify-output', ...)
  11. processTaskLearnings + stage    →  step.do('post-execution', ...)
```

### Tasks

**P1.1: Create the Workflow class**
- New file: `src/lib/agents/workflows/agent-execution.workflow.ts`
- Export `class AgentExecutionWorkflow extends WorkflowEntrypoint<Env, Payload>`
- Implement `run(event, step)` with all 11 steps
- Type the `Env` interface to include: `DATABASE_URL`, `AUTH_SECRET`, LLM keys, etc.
- Type the payload: `{ taskId: string }`

**P1.2: Extract step handlers from `worker-launcher.ts`**
- Current `launchTask()` function body contains inline logic
- Extract each block as a named function: `loadTaskStep()`, `checkLifecycleStep()`, etc.
- Each handler takes `{taskId, previousStepResults}` and returns serializable data
- Keep `worker-launcher.ts` as the module exporting these handlers

**P1.3: Handle the `execute-agent` step specifically**
- This is the 4-hour loop with 200 max turns
- Options:
  - **Option A (first pass):** one big step wrapping `executeAgent()` — works if LLM I/O dominates CPU (likely)
  - **Option B (fallback):** split per-agent-turn as individual steps (200 steps max per instance)
- Start with Option A. If CPU cap hits (5min per step), split.

**P1.4: Replace watchdog with Workflow semantics**
- Current `watchdog.ts`: turn count, idle detection, loop detection, 4hr cap
- Workflow steps have: retry config, per-step CPU cap, timeout, crash recovery
- Map:
  - Turn count → Workflow step count (if per-turn) or custom counter in agent step
  - 4hr cap → Workflow instance timeout (Workflows v2 "runs forever" so this is a soft cap via counter)
  - Loop detection → keep in-memory (reset per Workflow step invocation)
  - Retry logic → per-step `step.do(name, { retries: {...} }, ...)`

**P1.5: Modify `/api/worker/launch/route.ts`**
- Current: directly calls `launchTask(taskId)` and awaits Promise (long HTTP)
- New: creates Workflow instance via `env.AGENT_EXECUTION_WORKFLOW.create({ params: { taskId } })`
- Returns instance ID immediately (< 1 second response)
- HTTP client polls `/api/worker/status?id=X` for completion

**P1.6: New status endpoint**
- `src/app/api/worker/status/route.ts`
- GET with `?id=<instanceId>` returns Workflow status + step outputs

**P1.7: Test via `wrangler dev` with real task**
- Create a test task in Neon DB (or use existing todo task)
- POST to `/api/worker/launch` with taskId
- Poll status endpoint
- Verify: workflow completes, task status → 'completed', verification runs, credit deducted

### Checkpoint artifacts
- `src/lib/agents/workflows/agent-execution.workflow.ts` — new
- `src/lib/agents/worker-launcher.ts` — refactored into step-handler exports
- `src/app/api/worker/launch/route.ts` — triggers Workflow
- `src/app/api/worker/status/route.ts` — polls Workflow status
- Commit: "Phase 1: port worker-launcher to Workflows v2"

### Risks
- `execute-agent` step might hit 5min CPU cap on heavy tool use → half-day to split into per-turn steps
- Watchdog loop detection in Workflow context may need rethink → half-day to adapt
- Existing tasks in DB might have stale data that workflow can't handle → test + fix edge cases

### Success criteria
- End-to-end: create a task → approve → workflow runs → task completed on Neon via workflow
- `wrangler tail` shows step-by-step execution
- No regressions in existing task execution semantics

---

## Phase 2 — OpenNext wrapper for Workflow + scheduled (1 day)

### Goal
OpenNext generates `.open-next/worker.js` with only a `fetch` handler. We need to ADD: (a) exported Workflow class, (b) `scheduled(event)` handler for crons, (c) Workflow binding access from fetch handler.

### Tasks

**P2.1: Create `cf-worker-entry.ts` wrapper**
```typescript
// baljia-ai-cf/cf-worker-entry.ts
import openNextWorker from './.open-next/worker.js';
export { AgentExecutionWorkflow } from './src/lib/agents/workflows/agent-execution.workflow';

export default {
  fetch: openNextWorker.fetch,
  async scheduled(event, env, ctx) {
    const cronToUrl: Record<string, string> = {
      '0 2 * * *':    '/api/cron/night-shift',
      '0 */6 * * *':  '/api/cron/recurring',
      '0 3 * * *':    '/api/cron/trial-expiry',
      '*/15 * * * *': '/api/cron/platform-ops',
      '0 4 * * *':    '/api/cron/credit-renewal',
      '*/5 * * * *':  '/api/cron/onboarding-cleanup',
    };
    const path = cronToUrl[event.cron];
    if (!path) return;
    await openNextWorker.fetch(
      new Request(`https://baljia.ai${path}`, {
        method: 'POST',
        headers: { 'x-cron-secret': env.CRON_SECRET },
      }),
      env, ctx
    );
  },
};
```

**P2.2: Update `wrangler.toml`**
- `main = "cf-worker-entry.ts"` (instead of `.open-next/worker.js`)
- Add Workflow binding:
  ```toml
  [[workflows]]
  name = "agent-execution"
  binding = "AGENT_EXECUTION_WORKFLOW"
  class_name = "AgentExecutionWorkflow"
  ```
- Keep existing crons + assets

**P2.3: Test scheduled handler locally**
```bash
wrangler dev --port 8787 --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=*/5+*+*+*+*"
```
Verify the right cron endpoint gets hit via internal fetch.

**P2.4: Test Workflow trigger from OpenNext fetch handler**
- POST /api/worker/launch → should create Workflow instance via `env.AGENT_EXECUTION_WORKFLOW.create()`
- Verify instance ID returned, workflow runs

### Checkpoint artifacts
- `cf-worker-entry.ts` wrapper
- Updated `wrangler.toml`
- Build: `npx opennextjs-cloudflare build` still produces functional output
- Commit: "Phase 2: OpenNext wrapper with Workflow + scheduled handlers"

### Risks
- OpenNext's worker.js export format might not allow clean re-export → may need custom build hook
- Scheduled handler might not get full env bindings (same pattern as Workflow env issue) → test and document

---

## Phase 3 — Sentry / Observability workaround (4-8 hours)

### Goal
Error tracking works on Cloudflare Workers. Either via `@sentry/cloudflare`, or via `wrangler tail` + Logflare, or via a custom transport.

### Decision tree

**Option A: `@sentry/cloudflare`**
- Swap `@sentry/nextjs` → `@sentry/cloudflare` in Worker
- Keep `@sentry/nextjs` for Pages-rendered client side
- Pro: best-in-class error capture
- Con: two Sentry SDKs, more bundle surface

**Option B: Logflare for errors + `wrangler tail` for ops**
- Strip Sentry entirely from Worker
- Use structured `console.error()` → Logflare catches via HTTP transport
- Pro: minimal bundle, reliable
- Con: no breadcrumb aggregation, no performance monitoring

**Option C: Disable Sentry temporarily**
- Ship without, rely on `wrangler tail` live + Neon query logs
- Pro: fastest
- Con: no persistent error log; not production-grade

### Tasks

**Recommended: Option A first, fall back to B if issues persist.**

**P3.1: Install `@sentry/cloudflare`** (if Option A)
- `npm install @sentry/cloudflare`
- Update `sentry.server.config.ts` to use the Cloudflare variant
- Ensure `instrumentation.ts` doesn't crash on Worker

**P3.2: Wire errors into Worker**
- Add global try/catch in `cf-worker-entry.ts` around fetch and scheduled
- Capture unhandled exceptions via Sentry
- Test: intentionally throw from an API route, verify Sentry receives it

**P3.3: Fallback to Logflare if Option A breaks**
- Create Logflare account (free tier, 12MB/mo)
- Add `sendErrorToLogflare()` helper in Worker
- Update error handling

### Checkpoint artifacts
- Working error capture on deployed Worker
- Test error successfully visible in Sentry dashboard OR Logflare
- Commit: "Phase 3: Sentry CF-compatible OR Logflare fallback"

### Risks
- `@sentry/cloudflare` might have its own edge cases → fall back to Logflare within 4 hours

---

## Phase 4 — Wildcard `*.baljia.app` routing (1 day)

### Goal
Founder subdomains (`amendly.baljia.app`, `markmeld.baljia.app`, etc.) resolve to the Worker which renders their landing page via middleware. Must work without per-founder config.

### Tasks

**P4.1: Add Worker Route via CF API**
- Route pattern: `*.baljia.app/*`
- Target: Worker service `baljia-cf-spike` (or final name)
- Scripted via CF API, saved to `scripts/deploy-cf-routing.ts`

**P4.2: Update DNS**
- `*.baljia.app` CNAME → Worker hostname (temporary: `baljia-cf-spike.{subdomain}.workers.dev`)
- Eventually changes to point at Workers custom domain once apex is configured

**P4.3: Update `provisionSubdomain()` in `domain.service.ts`**
- Current code adds per-company CNAME pointing to a per-founder Render service
- **Decision point:** keep per-founder Render services (Tier 3), OR migrate founder subdomains to be served directly by the CF Worker via middleware?
- **Recommendation:** simplest for now — ALL founder subdomains hit the CF Worker via wildcard, middleware serves landing page from DB. Founder product deployments (Tier 3) can remain on Render for now.
- Remove per-founder CNAME logic (wildcard handles it)
- Keep: writing `render_service_id` to company for Tier 3 links

**P4.4: Test locally via spoofed Host header**
```bash
curl -H "Host: testslug.baljia.app" http://127.0.0.1:8787/
```
Verify: middleware extracts slug, rewrites to `/company/testslug`, correct landing page renders.

**P4.5: Test on deployed staging Worker**
- Once Phase 5 deployed: `curl https://testslug.baljia.app/` (via test DNS entry)
- Verify same behavior from real CF edge

### Checkpoint artifacts
- `scripts/deploy-cf-routing.ts` — adds Worker Route + DNS records via API
- Updated `src/lib/services/domain.service.ts` — wildcard-based, no per-founder CNAME
- Commit: "Phase 4: wildcard subdomain routing"

### Risks
- CF Worker Custom Domain doesn't support wildcards (known, using Routes instead) — confirmed in ADR research
- Existing per-founder DNS records on Render might conflict → audit and clean up obsolete records
- Scale limit: Workers Routes support ~1000 patterns per account; wildcard covers all founders in one

---

## Phase 5 — Real deploy + secrets + smoke test (1 day)

### Goal
Worker live at `baljia-cf-spike.*.workers.dev`. All secrets uploaded. Core endpoints tested from real CF edge.

### Tasks

**P5.1: Upload all 24 secrets via `wrangler secret put`**
- Script: `scripts/upload-cf-secrets.ts`
- Reads `.env.local`, filters production-relevant keys
- Uploads each via `echo <value> | wrangler secret put KEY`
- Skips non-secret `[vars]` (those go in wrangler.toml)

**P5.2: First real deploy**
- `wrangler deploy`
- Note the assigned `*.workers.dev` URL
- Verify worker appears in CF dashboard → Workers & Pages

**P5.3: Smoke test via `curl`**
Check 10 endpoints on deployed URL:
1. `GET /api/health` → 200
2. `GET /login` → 200 with HTML
3. `GET /faq` → 200 static page
4. `POST /api/waitlist` → 200 + DB write
5. `GET /dashboard/abc` → 307 redirect
6. `POST /api/chat` → 401 (no auth) — proves pi-ai loaded
7. `GET /api/auth/logout` → 405 (wrong method)
8. `GET /` → 200 homepage
9. `POST /api/auth/magic-link` → 500 if no valid email OR 200 if real
10. `POST /api/worker/launch` → 200 with instance ID

**P5.4: Test wildcard subdomain**
- Use temporary DNS: `curl -H "Host: testslug.baljia.app" https://baljia-cf-spike.{sub}.workers.dev/`
- OR add real test subdomain via Cloudflare dashboard
- Verify: middleware rewrites, correct company page renders

**P5.5: Test Cron Triggers**
- `wrangler cron trigger baljia-cf-spike --cron '*/5 * * * *'`
- Watch with `wrangler tail`
- Verify the right `/api/cron/*` endpoint fires, responds 200

**P5.6: Test Workflow via deployed Worker**
- POST to `/api/worker/launch` on deployed URL
- Verify: instance created, Workflow runs in CF (visible in CF dashboard), steps complete
- Check logs via `wrangler tail`

### Checkpoint artifacts
- Worker deployed at `baljia-cf-spike.{sub}.workers.dev`
- All 24 secrets uploaded (verify with `wrangler secret list`)
- All 10 smoke tests pass
- Cron trigger fires on real schedule
- Workflow instance completes on deployed Worker
- Commit: "Phase 5: live CF deploy + smoke test pass"

### Risks
- Some env vars might be Worker-incompatible → catch and fix
- First deploy might hit untested code paths → iterate

---

## Phase 6 — Playwright E2E against deployed Worker (0.5-1 day)

### Goal
Existing smoke test suite runs against the deployed CF Worker. Catches real regressions vs local dev.

### Tasks

**P6.1: Parameterize base URL**
- Update `tests/e2e/` playwright config to read `BASE_URL` env var
- Default to `http://localhost:3000` for local dev
- Override to deployed URL for CF smoke

**P6.2: Run suite**
```bash
BASE_URL=https://baljia-cf-spike.{sub}.workers.dev npx playwright test
```

**P6.3: Triage failures**
- CF-specific: streaming timing, image optimization, cold start timing
- Document or fix each
- Target: ≥90% pass rate (matches current local-dev pass rate)

### Checkpoint artifacts
- Playwright config with `BASE_URL` param
- Test run report against deployed Worker
- Any CF-specific fixes committed
- Commit: "Phase 6: Playwright E2E on deployed CF Worker"

### Risks
- Streaming tests might fail due to CF edge buffering → document workaround
- Image optimization might break → set `next.config.ts` `images.unoptimized: true` OR add Cloudflare Images

---

## Phase 7 — Docs update + merge plan (0.5 day)

### Goal
Clear PR-ready state. User can review everything in one place, decide on merge.

### Tasks

**P7.1: Update `CLAUDE.md` (draft — uncommitted in both branches)**
- Line 84: `Hosting | Cloudflare Workers | ...`
- Line 384: `billing.service.ts: PaymentProvider abstraction`
- Any other Render references

**P7.2: Write `docs/cf-deployment.md`**
- Runbook: how to deploy, rotate secrets, tail logs, trigger crons, roll back
- Mirrors `docs/DEPLOYMENT.md` but for CF

**P7.3: Update `docs/adr-001-hosting-platform.md`**
- Add postscript: "Cloudflare chosen, spike validated, migration executed in phases 0-7"
- Mark ADR status: Accepted (was Proposed)

**P7.4: Write `docs/cf-migration-summary.md`**
- End state snapshot: what's deployed, what's configured, what remains for user
- Every file changed, every CF API call made, every resource created
- Clear inventory for audit

**P7.5: Commit all docs + push `cloudflare-spike` branch to GitHub**
- Creates PR-ready branch on remote
- You can review via GitHub UI or local diff

### Checkpoint artifacts
- Draft `CLAUDE.md` updates in a separate branch/patch file (not yet merged to main)
- `docs/cf-deployment.md` runbook
- `docs/cf-migration-summary.md` complete inventory
- `cloudflare-spike` branch pushed to origin
- Commit: "Phase 7: migration docs + PR-ready state"

### Stop point
I stop here. Hand off to you for:
1. Review cloudflare-spike branch
2. Decide on merge strategy
3. Approve production DNS cutover

---

## What I need from you at each handoff

### Between phases (silent acceptance OK)
- Just let me keep going. Each commit is a clean checkpoint.
- If you want to pause to review: read SPIKE-NOTES + the commit list, then say "continue" or "stop."

### Before production DNS cutover (explicit approval required)
These actions affect production traffic and I will NOT do without your explicit go:
- Changing `baljia.ai` apex DNS to point at CF Worker
- Changing `*.baljia.app` wildcard CNAME to point at CF Worker (if you have founders already on Render)
- Any deletion of Render services
- Merging `cloudflare-spike` → `main`

### Architectural decisions requiring your input
Each of these blocks a specific phase. I'll ask when I hit them:
1. **Sentry approach (Phase 3):** `@sentry/cloudflare` vs Logflare vs disable
2. **Tier 3 founder product hosting (Phase 4):** keep on Render vs migrate to Sandboxes
3. **Image optimization (Phase 0 or 6):** Cloudflare Images ($5/mo) vs `unoptimized: true`

For all three: I'll make a default choice, flag it, and you can override.

---

## Success criteria — "CF migration done"

When ALL of these are true, migration is ready for production cutover:

- [ ] Worker deploys cleanly via `wrangler deploy`
- [ ] All 24 secrets uploaded
- [ ] `curl https://baljia-cf-spike.*.workers.dev/api/health` returns 200
- [ ] SSR page (`/login`) renders
- [ ] DB write (`/api/waitlist`) succeeds
- [ ] Workflow triggers via `/api/worker/launch`, completes, updates task status in Neon
- [ ] Cron trigger fires via real CF schedule (wait 15 min, check `wrangler tail`)
- [ ] Wildcard routing works: `curl -H "Host: testslug.baljia.app" ...` returns company page
- [ ] Playwright suite ≥90% passing against deployed URL
- [ ] Errors visible in Sentry or Logflare
- [ ] TS strict build passes (no `ignoreBuildErrors`)
- [ ] `cloudflare-spike` branch pushed with clear commits
- [ ] `docs/cf-deployment.md` runbook complete
- [ ] `docs/cf-migration-summary.md` inventory complete

At that point: one DNS cutover (~30 min) moves production traffic to CF.

---

## Risk register (and mitigation)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `execute-agent` step hits 5-min CPU cap | Medium | Medium | Split to per-turn steps; half-day delta |
| OpenNext wrapper doesn't support clean class re-export | Low-Medium | Medium | Fall back to separate Workflow Worker; half-day delta |
| Sentry + OpenNext still broken with `@sentry/cloudflare` | Medium | Low | Logflare fallback; same day |
| CF rate limits trip during bulk secret upload | Low | Low | Sleep between calls; no delta |
| Wildcard routing conflicts with existing Render subdomain CNAMEs | Medium | Low | Audit + cleanup old DNS; half-day |
| `next/image` breaks on Workers | High | Low | `unoptimized: true`; minimal UX loss at launch |
| Playwright streaming tests fail on CF | Medium | Low | Document known-issue; ship anyway |
| Cold start latency > Render | Low | Low | Edge caching of static assets mitigates |
| A dep works locally but not on deployed Worker | Medium | Medium | Catch in Phase 5 smoke test, fix or swap |

**Total estimated slip buffer: 1-2 days** across risks — factored into the 10-13 day estimate.

---

## Out of scope (explicitly NOT part of this plan)

These are real and important, but tracked elsewhere / need user decisions:

- **Dodo payment integration** — separate track; `docs/baljiapayment.md`
- **12 strategic business questions** — separate decisions
- **Indian compliance** (IEC, GST, Udyam, Grievance Officer, etc.) — user action
- **Founder AUP content** — user + lawyer
- **Refund policy publication** — user decision
- **Render Background Worker setup** — only if we fall back to Render
- **Stripe Atlas decision** — deferred
- **Tier 3 founder product deployments** — remain on Render for now; Sandboxes migration is Q3 item
- **Full Sentry + perf monitoring suite** — post-launch polish

---

## Day-by-day schedule (estimate)

Assuming ~6 hours/day of focused work:

| Day | Phase | Major deliverable |
|---|---|---|
| 1 (AM) | Phase 0 | Spike hacks removed; strict build passes |
| 1 (PM) | Phase 1 | Workflow class skeleton + step 1-5 ported |
| 2 | Phase 1 | Steps 6-11 ported; `/api/worker/launch` updated |
| 3 | Phase 1 | Status endpoint + local test of full workflow via wrangler dev |
| 4 | Phase 1 | `execute-agent` step split if needed; real-task end-to-end test |
| 5 (AM) | Phase 2 | OpenNext wrapper created; wrangler.toml updated |
| 5 (PM) | Phase 2 | Scheduled handler tested; Workflow trigger tested |
| 6 (AM) | Phase 3 | Sentry CF integration attempt |
| 6 (PM) | Phase 3 | Logflare fallback if needed; test error capture |
| 7 (AM) | Phase 4 | Worker Route + DNS script; local middleware test |
| 7 (PM) | Phase 4 | `domain.service.ts` updated; wildcard test |
| 8 | Phase 5 | Secret upload; first deploy; 10-endpoint smoke test |
| 9 | Phase 5 | Cron trigger test; Workflow deploy test; fixes |
| 10 | Phase 6 | Playwright BASE_URL param; run suite; triage |
| 11 (AM) | Phase 7 | Docs + migration summary |
| 11 (PM) | Phase 7 | Push `cloudflare-spike` branch; handoff |

**Realistic best-case: 9 days. Realistic with buffer: 11-13 days.**

---

## Protocol for executing this plan

1. I start with Phase 0 immediately upon your "go."
2. After each phase, I commit with a clear message on `cloudflare-spike`.
3. I update this plan file (this doc) with actual progress + any deltas from plan.
4. If I hit a decision point that's in "What I will NOT do without asking you," I pause and message you.
5. If I hit an unexpected blocker, I pause, document, and ask for guidance.
6. Silence = continue. Don't feel obliged to reply to every checkpoint.
7. At the end of each session, I write a status summary so you can read in bulk.

---

## Rollback plan at any point

If at any phase you want to stop and fall back to Render:

```bash
cd /c/Users/Vaishnavi/My_Projects/baljia-ai
git worktree remove ../baljia-ai-cf
git branch -D cloudflare-spike
```

- Main branch completely untouched
- No CF resources consumed (spike Worker deletable via CF dashboard)
- No DNS changes affecting production
- ~1 hour cleanup

Full cost of full migration attempt → decision to stay on Render: **just the time spent** (no sunk infrastructure cost).

---

## What launches the plan

Your message: *"start"* or *"go with the plan"* or any similar confirmation.

When I receive that:
1. Acknowledge with expected Phase 0 completion time
2. Start Phase 0 immediately
3. Commit + check in after each phase

**Ready when you are.**

---

*Plan authored: April 23, 2026. Status: awaiting execution greenlight. Location: `docs/cf-migration-plan.md` in main folder. Will be updated as phases complete.*
