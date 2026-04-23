# ADR-002: Split Hosting Strategy — Platform on Render, Founder Apps on Cloudflare

**Status:** Proposed (supersedes ADR-001's "full CF migration" track for v1.0)
**Date:** 2026-04-22
**Deciders:** Solo founder (yadavdg4@gmail.com)
**Supersedes:** none. **Relates to:** ADR-001 (hosting platform evaluation), `docs/cf-migration-plan.md`
**Branch of record:** `cloudflare-spike` (worktree at `baljia-ai-cf/`)

---

## TL;DR — The Design in 6 Lines

1. **Platform app (baljia.ai) stays on Render for v1.0.** Migration work is real (ioredis, txDb advisory locks, Sentry ALS, worker-launcher → Workflows), and the cost win on the platform alone is small.
2. **Founder apps (*.baljia.app) go to Cloudflare Workers.** This is where cost scales linearly on Render and flat on CF — the entire economic case for CF migration lives here.
3. **Engineering agent becomes a CF deploy client.** `landing-deploy.service.ts` and Render-specific tools in `engineering.tools.ts` target the CF API.
4. **Long-running agent execution stays on Render Background Worker.** 4hr watchdog, ioredis queue, `pg_try_advisory_lock` — all continue to work unchanged.
5. **The CF spike's validated pieces (Workflows v2 POC, Neon HTTP refactors, bundle success) are preserved as the future migration path** for when platform scale forces the rewrite. Not thrown away; parked on the branch, referenced in `docs/cf-migration-plan.md`.
6. **Cutover risk at launch is near-zero** because the platform isn't touched; founder apps are greenfield deploys.

**If this ADR is accepted, Phase 0 of `cf-migration-plan.md` is cancelled. Phase 4 (founder-app deploys to CF) becomes the only phase and starts immediately on `cloudflare-spike`.**

---

## Context

### What we are actually building

Baljia AI has **two quite different hosting workloads** that we have been treating as one:

| Workload | What it is | Scale shape | Tech shape |
|---|---|---|---|
| **Platform** (`baljia.ai`) | Next.js 15 app: dashboard, CEO chat, auth, webhooks, API routes, 9-agent orchestration | Flat — one deployment serves all founders | Mature code: 37 services, 40 API routes, streaming SSE, Stripe/Dodo webhooks, Sentry, ioredis queue, `txDb` advisory locks, 4hr agent watchdog |
| **Founder apps** (`*.baljia.app`) | Apps that the Engineering agent *generates* and deploys for each founder company. Tier 1 = landing, Tier 2 = React SPA + API, Tier 3 = full-stack with own Neon DB | Linear in founder count — N founders = N deployments | Greenfield at generation time. Simple surface area. No shared state with platform |

Earlier work (ADR-001, `cf-migration-plan.md`) framed this as a binary: move **everything** to Cloudflare, or stay **entirely** on Render. That framing is what we want to challenge.

### What the CF spike proved (and where it hit friction)

The Day-1 spike work on `cloudflare-spike` (documented in `SPIKE-NOTES.md`) verified:

- ✅ Bundle: 3.2 MiB gzipped, 68% headroom under CF 10 MiB cap
- ✅ Runtime: 8 platform endpoints return 2xx/expected on a deployed Worker (waitlist writes to real Neon, chat module loads, middleware fires, SSR works)
- ✅ Upstash Redis HTTP works on Workers (`Redis connected` in logs)
- ✅ Workflows v2 POC works with REAL Gemini calls (10 steps, crash-recovery observed)
- ✅ Bedrock test script passes (type fix applied)
- ✅ `pg` TCP replaced with Neon HTTP in 3 sites (data.tools, engineering.tools × 2)

Phase 0 audit surfaced **real rewrites still required** on the platform side:

| Blocker | Where | Why it blocks CF Workers | Work to fix |
|---|---|---|---|
| `ioredis` TCP client | `src/lib/redis.ts` (production code, not just scripts) | Workers disallow raw TCP sockets | Swap to `@upstash/redis` HTTP, audit all callers of `getRedis()`, handle pub/sub differently (Workers can't hold persistent subs) |
| `pg_try_advisory_lock` | `src/lib/services/night-shift.service.ts` (lines ~448, ~508) via `txDb` WebSocket Pool | Advisory locks require persistent Postgres session; Neon HTTP closes each request | Replace with Upstash Redis `SETNX`-based lock or a separate session-pool service |
| `@sentry/nextjs` | instrumentation, error boundary, 3 `sentry.*.config.ts` files | Uses Node AsyncLocalStorage patterns that crash intermittently on Workers | Swap to `@sentry/cloudflare`, rewrite instrumentation glue |
| `worker-launcher.ts` watchdog (4hr) | Long-running agent tasks | Workers request has bounded CPU time; cannot run 4hr synchronously | Port to Workflows v2 (validated in POC, still needs real wiring: 11 steps, state passing, tool access, memory layers, verifier, remediation) |
| Streaming SSE (CEO chat) | `/api/chat` route | Works on Workers but requires testing under real load; OpenNext SSE adapter still maturing | Test + profile |

**None of these are dealbreakers.** They are each solvable in 1-3 days. But summed: **6-10 days of platform rewrite** to get to functional parity with Render — on a solo team with a 1-2 month launch window and no active users yet to generate cost pressure.

### The cost argument, re-examined

The original push for CF was cost. Let's look at where the cost actually lives:

**At v1.0 scale (0-100 founders):**

| Component | On Render | On CF |
|---|---|---|
| Platform Web Service (Starter $7 or Standard $25) | $25/mo | $5/mo (Paid plan) |
| Platform Background Worker (for agent runs) | $25/mo (Standard, 2GB RAM for LLM + browser) | $0 (bundled if Workflows) or $0 if stays on Render |
| 3 cron jobs | Included | Included |
| Neon (platform + founder DBs) | Same | Same |
| Upstash Redis | Same | Same |
| R2 / S3 | Same | R2 cheaper egress |
| **Founder apps** (Tier 2 = $7/mo Render static+API; Tier 3 = $7-25/mo full-stack) | **$7 × N_founders** | **~$0 marginal per founder** (wildcard Worker) |

At **10 paying founders**: Render ≈ $50 (platform) + $70 (founder apps) = **$120/mo**. CF full migration ≈ $5 + ~$0 = **$5/mo**. Savings: ~$115/mo, but migration takes 6-10 days.

At **100 paying founders**: Render ≈ $50 + $700 = **$750/mo**. CF full migration ≈ **$20-50/mo** (with usage). Savings: **~$700/mo**.

At **1000 paying founders**: Render ≈ $50 + $7000 = **$7050/mo**. CF full migration ≈ **$100-200/mo**. Savings: **~$6900/mo**.

**Observation:** The cost savings are dominated by the founder-apps term. The platform term is ~$45/mo saved. Moving founder apps alone captures **96%+** of the CF economic value.

### The risk argument, re-examined

What we are optimizing:

- **Time-to-launch:** 1-2 months. Every platform bug discovered post-cutover is a launch risk.
- **Team:** one founder, with an AI pair. No dedicated ops.
- **User base today:** zero paying founders. The cost curve above is *future* savings, not current burn.
- **Reversibility:** once founders are onboarded, migrating the platform underneath them is hard (session invalidation, DB connection changes, webhook URL rewrites, DNS).

**Asymmetry:** platform migration risk is paid at v1.0 regardless of whether we ever reach 1000 founders. Founder-app CF savings accrue only if we do reach that scale — but capturing them doesn't require touching the platform.

---

## Decision

**Deploy a split-hosting architecture.** Platform on Render (unchanged). Founder apps on Cloudflare Workers (new deploy target for the Engineering agent).

```
                           ┌─────────────────────────────────┐
  Founder (browser) ─────► │  baljia.ai (Render Web Service) │
                           │  - Next.js 15 app               │
                           │  - CEO chat, dashboard, auth    │
                           │  - Stripe/Dodo webhooks         │
                           │  - Governance, memory, verifier │
                           └────────┬────────────────────────┘
                                    │
                                    │ enqueue
                                    ▼
                           ┌─────────────────────────────────┐
                           │  Render Background Worker       │
                           │  - worker-launcher.ts           │
                           │  - 4hr watchdog                 │
                           │  - ioredis queue (stays)        │
                           │  - txDb advisory lock (stays)   │
                           │  - agent-factory.ts             │
                           └────────┬────────────────────────┘
                                    │
                                    │ Engineering agent tools
                                    ▼
                           ┌─────────────────────────────────┐
                           │  Cloudflare API (new target)    │
                           │  - Workers Scripts Write        │
                           │  - DNS wildcard *.baljia.app    │
                           │  - R2 asset uploads             │
                           └────────┬────────────────────────┘
                                    │
                                    │ deploys
                                    ▼
                           ┌─────────────────────────────────┐
                           │  Founder apps on CF Workers     │
                           │  - acme.baljia.app (Tier 1/2/3) │
                           │  - wildcard route, 1 Worker,    │
                           │    routed by Host header        │
                           │  - per-founder Neon DB binding  │
                           └─────────────────────────────────┘
```

**Branch / folder mapping:**

- `baljia-ai/` (main branch, Render) = platform. **Untouched by this ADR.**
- `baljia-ai-cf/` (cloudflare-spike branch) = now repurposed. It is **not** a platform replacement; it becomes:
  - The CF Worker **template** that founder-app deploys are generated from
  - The home of the `cf-deploy` client library that platform services import via a shared package or npm link (decide in Action Item 3)
  - The home of the `cf-workflow-poc/` which is **parked** for a future platform migration but not shipped in v1.0

---

## Options Considered

### Option A: Full Cloudflare Migration (original plan)

Move platform + founder apps to CF. Workflows v2 hosts agent runs. Swap ioredis → Upstash HTTP. Replace advisory locks. Swap Sentry. Port worker-launcher.

| Dimension | Assessment |
|---|---|
| Complexity | **High** — 6-10 days of rewrites across production code |
| Time-to-ship | **-6 to -10 days** vs Option C |
| Cost at 1K founders | **Best** — ~$100-200/mo total |
| Cost at v1.0 (0-100) | ~$5-50/mo (saves ~$115/mo over Render) |
| Risk at launch | **High** — every platform rewrite (redis, locks, Sentry, workflows) is a new bug surface |
| Reversibility if it fails | **Low** — hard to undo once founders are in |
| Team fit (solo) | **Poor** — 6-10 days is significant when we have no ops team to debug production incidents |

**Pros:** Lowest long-term cost. Single deploy target. Workflows v2 crash-recovery semantics are a better match for agent runs than Render's Background Worker (no crash-recovery there).

**Cons:** Rewrites touch the highest-value, hardest-to-test code paths (queue, locks, watchdog) at the moment we can least afford production regressions. Cost win at v1.0 scale is small.

### Option B: Full Render (stay)

Keep everything on Render, including founder apps. No migration work. `landing-deploy.service.ts` keeps hitting Render API.

| Dimension | Assessment |
|---|---|
| Complexity | **None** — status quo |
| Time-to-ship | **Fastest** |
| Cost at 1K founders | **Worst** — ~$7050/mo |
| Cost at v1.0 | ~$50-120/mo |
| Risk at launch | **Lowest** |
| Reversibility | **N/A** |
| Team fit | **Good** — zero migration burden |

**Pros:** Zero work. Launches fastest.

**Cons:** Founder-app cost becomes unsustainable well before 1K founders. We would hit this wall within 6 months of a successful launch — and at that point we would need to do Option C anyway, from a position of production load and on-call pressure.

### Option C: Split Hosting — Platform on Render, Founder Apps on CF ⭐ **RECOMMENDED**

Platform stays on Render. Engineering agent deploys founder apps to CF Workers via API. Wildcard routing on `*.baljia.app`. No platform rewrites.

| Dimension | Assessment |
|---|---|
| Complexity | **Medium** — 3-5 days of engineering-agent rewrite + CF deploy client + wildcard routing + per-tenant isolation |
| Time-to-ship | **+3-5 days** vs Option B, **-5-7 days** vs Option A |
| Cost at 1K founders | **~$100-300/mo** (captures ~95% of Option A's savings) |
| Cost at v1.0 | **~$30/mo** (platform Render Starter + CF Workers Paid) |
| Risk at launch | **Low** — platform code unchanged, only new code paths are in founder-app deploy tool |
| Reversibility | **High** — if CF deploys break, tools fall back to Render API (keep both code paths for 1 release) |
| Team fit | **Good** — isolated, testable, no shared-state concerns |

**Pros:**
- Platform untouched = launch risk unchanged from today
- Captures 95%+ of long-term cost win
- Reuses all CF spike work (Neon HTTP, wrangler.toml, bundle discipline) applied to the right surface (founder apps)
- Engineering agent gets a clean, modern deploy target
- Workflows v2 POC is preserved for future platform migration (Option A later) without blocking launch

**Cons:**
- Two hosting providers to monitor (but this is already true — Neon, Upstash, R2, Sentry, Stripe are all separate)
- Founder-app debugging is separated from platform debugging (mitigated by unified logging: pipe CF logs to Sentry + Axiom)
- If we ever want advisory locks *from* a founder-app Worker against the platform DB, we need an HTTP endpoint (trivial)

### Option D: Platform on CF, Agent Worker on Render Background Worker

Move platform SSR + API routes to CF. Keep agent execution on Render Background Worker via queue dispatch.

| Dimension | Assessment |
|---|---|
| Complexity | **High-ish** — still need redis/Sentry rewrites, plus dispatch plumbing |
| Cost | Similar to Option C |
| Risk | **Medium-High** — ioredis, txDb, Sentry all still need solving on the platform side |
| Team fit | **Worst of both worlds** — two providers AND migration pain |

**Rejected.** Gives us the ops cost of hybrid without the time-to-ship win of Option C.

---

## Trade-off Analysis

### Why not Option A (full CF)?

The CF spike is a **technical success**. The bundle fits, the runtime works, Workflows v2 handles agent patterns. So why not?

Because **technical feasibility ≠ launch-window fit**. The rewrites are real and they touch:

1. **The queue** (`ioredis` → HTTP). Queue bugs cause silent task loss.
2. **The concurrency lock** (`pg_try_advisory_lock` → Redis SETNX). Lock bugs cause duplicate agent runs, duplicate Stripe charges, duplicate LLM spend.
3. **The error pipeline** (`@sentry/nextjs` → `@sentry/cloudflare`). Sentry bugs cause us to not see production incidents.
4. **The agent runtime** (`worker-launcher` → Workflows v2 port). Agent runtime bugs corrupt task state, break watchdog, break remediation.

Each of these is 1-3 days to rewrite and 2-5 days to feel confident about. We don't have that confidence budget 1-2 months from launch with zero customer load to test against.

Option A is the **right** end-state. It is the **wrong** near-term project.

### Why not Option B (stay on Render)?

At 100 paying founders (which is the v1.0 "we have product-market fit" milestone), Render founder-app cost is ~$700/mo — higher than the entire Render platform cost. At 1000 it is ~$7000/mo. That's margin-crushing at Baljia's subscription price point.

We would be forced into Option C anyway within 6 months of successful launch. Doing it now, before founders are onboarded, is **cheaper and safer** than doing it later under load.

### Why Option C specifically

Option C has a **clean ownership split**:

- Render owns: "the app Baljia runs on"
- Cloudflare owns: "the apps Baljia deploys for founders"

These are conceptually different workloads. Merging them into one hosting environment has never been a design requirement — it was an assumption.

The engineering agent already has a concept of "deploy target". Today it points at Render API. Pointing it at the CF API is a **tool-swap**, not a platform rewrite. Unit-testable, feature-flagable, reversible.

### What Option C does NOT solve

- **Platform cost at 10K+ founders.** If we ever hit that, we still need Option A (full CF migration). The spike work is kept on `cloudflare-spike` branch as the prepaid R&D for that future project.
- **4-hour agent tasks on CF.** Stays on Render Background Worker for v1.0. Known to work (Render Background Workers have no HTTP timeout, unlike Render Web Services which have the 100-minute cap — that cap is why we need a Background Worker in the first place, and ADR-001 noted this).
- **Unified logging across Render + CF.** Mitigation: pipe CF Worker logs to Sentry via `@sentry/cloudflare` on the founder-app side, keep Render + `@sentry/nextjs` on the platform. Sentry already unifies. No new tool needed.

---

## System Design — The Founder-App Deployment Surface

### Component responsibilities

```
Platform (Render)
├─ Next.js App
│  └─ /api/webhooks/github → triggers founder-app redeploy
├─ Worker-Launcher (Background)
│  ├─ agent.engineering.ts
│  │  └─ deployLandingPage(tier, spec)  ◄── NEW: targets CF
│  │  └─ deployTier2App(spec)           ◄── NEW: targets CF
│  │  └─ deployTier3App(spec)           ◄── NEW: targets CF (with Neon DB binding)
│  ├─ CF Deploy Client (NEW)
│  │  ├─ scripts.upload(scriptName, bundle)
│  │  ├─ routes.create(pattern, scriptName)
│  │  ├─ dns.createSubdomain(subdomain, zoneId)
│  │  └─ secrets.put(scriptName, secrets)
│  └─ ioredis queue (UNCHANGED)
│
Cloudflare (new)
├─ Workers (one per founder company, or one wildcard with Host-routing)
│  ├─ *.baljia.app/ → Host header routing
│  ├─ Tier 1: serve R2-hosted static HTML + CSS
│  ├─ Tier 2: Next.js-on-Workers via OpenNext + per-founder Neon binding
│  └─ Tier 3: same as Tier 2 + Durable Objects for session state
├─ DNS Zone: baljia.app
│  └─ *.baljia.app CNAME → Worker
└─ R2 Bucket: assets.baljia.app (UNCHANGED)
```

### One Worker vs N Workers — design choice

Two deploy shapes are compatible with this ADR:

**Shape 1 — One Wildcard Worker (simpler, cheaper at scale)**
- Single Worker script bound to `*.baljia.app/*`
- Worker reads `request.headers.Host`, looks up the company in D1 or Neon, loads company-specific config
- Pro: one deploy, flat cost, no per-founder script management
- Con: all founder apps share one bundle. Tier 3 full-stack apps with founder-custom code (future) don't fit.

**Shape 2 — One Worker Per Founder (more flexible)**
- Each founder gets their own Worker script: `baljia-app-acme`, `baljia-app-widgetco`
- Worker-launcher's Engineering agent calls `scripts.upload` with the company-specific bundle
- Requires either Workers for Platforms ($25/mo flat — user declined) or staying under the Workers Paid free-bundle limit (100 Workers on Paid, more on contract)
- Pro: full customization per founder (Tier 3)
- Con: more deploys to manage, at ~100 founders we hit the Workers Paid limit

**Recommendation:** **Start with Shape 1** (one wildcard Worker). Tier 1 and Tier 2 fit cleanly. For Tier 3 founders needing custom code, upgrade to Shape 2 per-founder. This is a deferred decision — we can add Shape 2 without breaking Shape 1.

### Data flow: founder-app creation

```
1. Founder onboards. Engineering agent creates starter-task "build landing page".
2. Platform worker-launcher claims the task (advisory lock, credit charge).
3. Agent runs. Generates HTML/React bundle.
4. Agent calls CF Deploy Client:
   a. Uploads bundle to R2 (tier 1) OR uploads worker script (tier 2/3)
   b. Calls CF DNS API: create CNAME acme.baljia.app → Worker
   c. Calls CF Workers Routes API: register *.baljia.app pattern (one-time, already done)
   d. Writes founder_company.subdomain = "acme" in platform DB
5. Agent calls verifier: "curl https://acme.baljia.app expect 200"
6. Task completes. Founder sees live site in dashboard.
```

No change to platform runtime. Only change: the `deployLandingPage` tool points at CF instead of Render.

### Data flow: founder-app request

```
1. User hits https://acme.baljia.app
2. CF DNS resolves to Worker
3. Worker reads Host: acme.baljia.app, derives company_id = "acme"
4. Worker queries:
   - For Tier 1: fetch static from R2 bucket key "acme/index.html"
   - For Tier 2: fetch from Neon founder DB bound via `env.NEON_URL_ACME` (secret)
5. Worker returns response
```

No platform round-trip for the user request. Platform is only hit when the app itself calls `api.baljia.ai` (e.g., for CEO integration or analytics push).

### Failure modes and mitigations

| Failure | Blast radius | Mitigation |
|---|---|---|
| CF Workers outage | All founder apps down, platform (Render) still up | Dashboard shows "your app is temporarily unreachable"; Baljia platform itself unaffected — founders can still log in, chat with CEO, trigger tasks |
| Render platform outage | Dashboard/chat down, founder apps still live on CF | Revenue-critical user journeys (founder-app visitors buying, subscribing) unaffected |
| Neon founder DB outage | Founder app degrades based on DB dependency | Static tier 1 still renders; tier 2/3 show DB-down page |
| CF DNS misconfig | New deploys fail | Worker-launcher retries; platform remediation loop kicks in |

**Observation:** Split hosting *improves* resilience vs Option A because a single-provider outage doesn't take down both halves.

---

## Consequences

### What becomes easier

- **Launching on time.** No platform rewrites. Platform risk profile unchanged.
- **Iterating on founder apps.** CF Workers deploys are fast (seconds), branchable, testable in isolation.
- **Cost scaling.** Founder-app cost stays flat regardless of founder count.
- **Future full CF migration.** The spike branch is preserved — when platform rewrite is justified, we are not starting from zero.

### What becomes harder

- **Two hosting providers to monitor.** Mitigation: unified Sentry (platform → @sentry/nextjs; founder apps → @sentry/cloudflare, same project).
- **Two deploy pipelines.** Mitigation: platform is GitHub → Render (existing). Founder apps are worker-launcher → CF API (new, documented).
- **Slightly more complex mental model.** "Where does X run?" Documented in `docs/render-architecture.md` + this ADR.

### What we will need to revisit

- **At ~50 paying founders:** re-measure actual Render platform cost vs CF full-migration savings. If the gap justifies a 2-week project, initiate Option A via the parked spike work.
- **At first tier-3 founder with custom code:** decide Shape 1 (wildcard Worker) vs Shape 2 (per-founder Worker). Defer until needed.
- **If ioredis queue ever needs to be read from a founder app:** would require Upstash HTTP proxy endpoint on platform. Not needed now.
- **Sentry strategy:** single project with environment tags (`platform-render`, `founder-app-cf`) vs two projects. Decide in Action Item 4.

---

## Action Items

**Immediate (this week) — to accept this ADR:**

1. [ ] **Cancel Phase 0** of `docs/cf-migration-plan.md` (ioredis swap, txDb rewrite, Sentry swap on platform). Park the work; don't execute.
2. [ ] **Update `docs/cf-migration-plan.md`** with a new header: "SUPERSEDED by ADR-002 for v1.0. Migration phases 0-3 deferred to v1.5."
3. [ ] **Decide CF Deploy Client shape:** (a) separate npm package pulled into both `baljia-ai` and `baljia-ai-cf`, or (b) copy-paste client file into `baljia-ai/src/lib/services/cf-deploy.service.ts`. **Recommend (b) for v1.0** — package management overhead not worth it for one shared file.

**v1.0 work (2-3 weeks, on main branch):**

4. [ ] **Wire `cf-deploy.service.ts`** into platform: wraps CF Workers + DNS + R2 APIs. Auth via `CLOUDFLARE_API_TOKEN` already provisioned.
5. [ ] **Rewrite `engineering.tools.ts` deploy tools:** `deployLandingPage`, `deployTier2App`, `deployTier3App` → call `cf-deploy.service` instead of Render API.
6. [ ] **Rewrite `landing-deploy.service.ts`:** Render-specific logic → CF deploy calls.
7. [ ] **Update `domain.service.ts`** for wildcard `*.baljia.app` routing (single DNS record, per-founder subdomain lookup at Worker level).
8. [ ] **Build the wildcard Worker template** in `baljia-ai-cf/` (repurpose existing CF code): Host-header routing + company lookup + Tier 1/2 render paths.
9. [ ] **Test with one manual deploy** end-to-end: trigger Engineering agent → CF Worker live at `test.baljia.app` → verifier passes.
10. [ ] **Update Sentry:** add `@sentry/cloudflare` to founder-app Worker. Platform keeps `@sentry/nextjs`. Single Sentry project, tag by environment.

**Deferred (v1.5, when scale demands it):**

11. [ ] Execute Option A migration of platform to CF (reuses `cloudflare-spike` branch work: Workflows v2 POC, Neon HTTP refactors, `next.config.ts` hardening, `wrangler.toml`). Timeline: 2-3 weeks when triggered.
12. [ ] Revisit Shape 1 vs Shape 2 per-founder Workers when first tier-3 custom-code founder arrives.

**Never (explicit non-goals):**

- Move 4hr agent execution to Workers in v1.0. Stays on Render Background Worker.
- Replace ioredis, txDb, or Sentry on the platform in v1.0. Deferred to v1.5 with Option A.
- Move Neon, Upstash, R2, Stripe, Dodo, Postmark, Browserbase. These are already multi-provider and unrelated to Render/CF choice.

---

## Open Questions (to resolve before Action Item 4)

1. **Wildcard Worker authentication to platform API.** When a founder app needs to call `api.baljia.ai` (e.g., to log an event), how is it authenticated? Recommend: short-lived JWT baked into Worker secrets at deploy time, rotated on redeploy. Decide + document in implementation.
2. **Per-founder Neon DB secret management.** Each tier-3 founder has their own Neon DB. How is the connection string injected into the Worker? Recommend: CF Secrets API, one secret per founder keyed by `NEON_URL_{company_id}`. Document in `cf-deploy.service.ts`.
3. **CF Cron Triggers vs Render Cron Jobs.** Platform cron (night shift, cleanup) runs on Render today (`render.yaml` has 4 cron entries). Leave there for v1.0 — no reason to migrate. Delete the `wrangler.toml` `[triggers].crons` entries that were added during the spike; they are aspirational for v1.5.

---

## Confidence level

**High** on the split-hosting shape itself. The economic and risk analysis above is straightforward arithmetic. The only part that could invalidate this ADR is if the founder-app deploy flow on CF turns out to be significantly harder than the Render version — which the spike gives us no reason to expect (Workers script upload + DNS + routes are all well-documented, we already have a working CF API token).

**Medium** on the Shape 1 vs Shape 2 question, which this ADR defers.

**High** that this is the right near-term decision even if Option A becomes right at v1.5.

---

## Appendix: What dies if this ADR is rejected

If we go back to Option A (full CF migration):

- Phase 0 resumes: ioredis → @upstash/redis swap in `src/lib/redis.ts`, audit all callers
- `pg_try_advisory_lock` in `night-shift.service.ts` → Redis SETNX lock rewrite
- `@sentry/nextjs` → `@sentry/cloudflare` across 4 files + error boundary
- `worker-launcher.ts` → Workflows v2 port (11 steps, real tool access, memory wiring)
- Streaming SSE profiling on OpenNext
- Estimated: +6-10 days before we can cut over platform. Then DNS cutover. Then a week of bakeoff.

This ADR says: **that's the right project at the wrong time.** Ship v1.0 with the platform we have. Put the CF bet on the surface where it actually matters (founder apps). Earn the right to do Option A later with a working product and real load data.
