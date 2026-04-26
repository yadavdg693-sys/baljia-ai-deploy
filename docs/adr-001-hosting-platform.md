# ADR-001: Hosting Platform for Baljia AI

**Status:** Proposed — awaiting founder sign-off
**Date:** April 22, 2026
**Deciders:** Baljia founder (solo decision)

---

## Context

Baljia AI (Indian Pvt Ltd) is a SaaS platform that uses AI agents to autonomously build and operate companies for founders. Launching in 1-2 months, pre-revenue.

The current hosting choice is **Render** (per `render.yaml`: 1 Starter Web Service + 6 Cron Jobs = $13/mo). Founder has been delayed on the one-time Render dashboard OAuth step for weeks, prompting re-evaluation. **Cloudflare Agents Week 2026** (April 13-17) launched new primitives specifically designed for AI agent workloads: Workflows v2, Sandboxes GA, Durable Objects with Facets, Dynamic Workers.

Forces at play:

1. **Runtime constraint**: `src/lib/agents/watchdog.ts:11` hardcodes `MAX_EXECUTION_MS = 4 hours`. Agent tasks can run up to 4 hours continuously.
2. **🚨 HIDDEN BUG IN CURRENT SETUP**: Render Web Services cap HTTP requests at **100 minutes**. The current `render.yaml` CANNOT actually run 4-hour agent tasks. This is a latent production bug that affects BOTH hosting options — it's not a "migrate to fix" issue.
3. **Pre-revenue, solo founder, 1-2 month launch window** — operational complexity is more expensive than hosting cost at this stage.
4. **Indian Pvt Ltd, target customers are global + India** — latency from US-West (Render Oregon) to India adds 220ms per SSR request.
5. **6 cron schedules** need to run reliably.
6. **Streaming CEO chat** (SSE LLM streaming) must work.
7. **Per-founder product deployments** — engineering agent currently creates new Render services ($7/mo each idle cost).

---

## Decision

**Stay on Render for launch. Fix the 100-minute agent-execution bug immediately. Front `baljia.ai` + `*.baljia.app` with Cloudflare CDN for India latency. Re-evaluate full Cloudflare migration in Q3 2026 when (a) 50+ founder product deployments exist and (b) Cloudflare Sandboxes + Workflows v2 have a 6-month stability track record.**

Specifically:

1. **Week 1 (critical):** Add a Render Background Worker service to `render.yaml` that polls Neon for `status='todo'` tasks and runs `launchTask()`. This fixes the 100-minute HTTP cap and is required regardless of hosting choice.
2. **Week 1 (critical):** Complete the Render dashboard OAuth + Blueprint deploy + env var paste. ~15 minutes.
3. **Week 1:** Put Cloudflare in front of both domains as CDN/proxy (free — zones already owned). Caches static assets at edge, cuts India latency by ~80%.
4. **Q3 2026:** Pilot Cloudflare Sandboxes for the Tier 3 per-founder product deployment use case (replaces per-founder Render services at active-CPU pricing).
5. **Not this quarter:** Full Cloudflare Workflows migration for the platform. Revisit as budgeted 3-week project when Workflows v2 has ≥6 months operational maturity.

---

## Options Considered

### Option A: Stay on Render (recommended)

| Dimension | Assessment |
|---|---|
| Complexity | **Low** — `render.yaml` is 95% written, shallow ops learning curve |
| Cost at 10 customers | $34/mo (Web $7 + Crons $6 + Background Worker $0-25 + ~3 Tier 3 services $21) |
| Cost at 100 customers | $266/mo (scales linearly with Tier 3) |
| Cost at 1,000 customers | $2,366/mo (Tier 3 dominates) |
| Scalability | Linear per Tier 3 service ($7/mo each) — gets expensive at scale |
| Team familiarity | Very high — standard Node process model |
| Latency to India | Bad — Oregon region adds 220ms; mitigate with CF CDN in front |
| Lock-in | Low — runs standard Node, rehost easy |
| Time to ship | 2-3 days (1 day for Background Worker + OAuth + deploy) |

**Pros:**
- Shallowest path to production
- Already matches current architecture
- Node runtime = no bundle size pressure, no `fs` module restrictions, no dependency audits
- Mature ecosystem, predictable failure modes, clean logs
- Sentry works first-class (no AsyncLocalStorage bugs)
- Streaming SSE works natively

**Cons:**
- 4-hour agent task CANNOT run via HTTP (100-min Web Service cap). Requires Background Worker pattern (additional config, 1 day work).
- US-West region adds India latency
- Tier 3 per-founder services at $7/mo idle = cost lever that grows linearly with customer count
- No native edge/global distribution

---

### Option B: Migrate to Cloudflare (Workers + Workflows + Sandboxes)

| Dimension | Assessment |
|---|---|
| Complexity | **High** — multi-primitive architecture (Workers + Workflows + Durable Objects + Sandboxes + Queues) |
| Cost at 10 customers | ~$19/mo |
| Cost at 100 customers | ~$152/mo |
| Cost at 1,000 customers | ~$1,520/mo |
| Scalability | Sub-linear — active-CPU pricing on Sandboxes beats per-service pricing at scale |
| Team familiarity | Low — new paradigms (step functions, Durable Objects, edge runtime) |
| Latency to India | Excellent — global edge, Workers run near user |
| Lock-in | Medium-High — Workflows step functions are CF-specific |
| Time to ship | **12-18 working days full migration**, or 3-5 days for hybrid (CF front-door + Render workers) |

**Pros:**
- ~40% cheaper at all scales (real money at 100+ customers)
- Purpose-built for AI agents (Workflows v2 rearchitected April 2026 specifically for this use case)
- Durable execution — agent crash = automatic resume from last step (vs losing 2hr of work on Render)
- Sandboxes for per-founder deploys = beats Render services on price + gives agent shell access
- Global edge = India latency solved natively
- Single $5/mo Workers Paid covers platform + all 6 crons

**Cons:**
- **Workflows v2 is 10 days old** (April 15, 2026). Early adopter tax on CF's own primitive.
- **Sandboxes GA is 10 days old** (April 13, 2026). SDK surface will evolve.
- Open Sentry + OpenNext bugs (AsyncLocalStorage: [#14931](https://github.com/getsentry/sentry-javascript/issues/14931), [#18842](https://github.com/getsentry/sentry-javascript/issues/18842), [#18843](https://github.com/getsentry/sentry-javascript/issues/18843)).
- Next.js 15.2 Node.js middleware not supported on OpenNext (we're on 15.1 — OK for now).
- 10 MiB gzipped bundle cap — Baljia's SDK-heavy deps (AWS S3, Browserbase, Anthropic, OpenAI, Google, Stripe, Sentry) could squeeze; must measure first.
- Custom Domains don't support wildcard DNS — requires two routes + dynamic dispatch for `*.baljia.app`.
- `ioredis` (TCP Redis) won't work on Workers — must remove/replace with `@upstash/redis` (HTTP).
- `worker-launcher.ts` + `agent-factory.ts` + `watchdog.ts` require ground-up rewrite into Workflows step functions with per-step CPU budgets.
- Debugging edge runtime is meaningfully harder than `render logs tail`.

---

### Option C: Hybrid — Render for agents, Cloudflare for front-door

| Dimension | Assessment |
|---|---|
| Complexity | Medium — two platforms to manage |
| Cost at 10 customers | ~$30/mo (overlapping base costs) |
| Cost at 100 customers | ~$200/mo |
| Cost at 1,000 customers | ~$1,800/mo |
| Time to ship | 3-5 days |
| Latency to India | Good (CF edge for static) |
| Lock-in | Low |

**Pros:**
- India latency improvement without migration
- Keeps Node process model where it matters most (agent execution)
- Cloudflare CDN in front is free + takes a day

**Cons:**
- Two vendors to manage, two billing surfaces, two monitoring dashboards
- Deployment pipeline complexity (CF Pages for front + Render for back)
- For solo founder, two-system debugging is painful

---

## Capability Matrix (verified against primary sources)

| Baljia requirement | Render | Cloudflare (W+WF) | Notes |
|---|---|---|---|
| 4-hour long-running agent task | ⚠️ Requires Background Worker (not Web Service — 100min cap) | ❌ Requires Workflows v2 port with 5-min CPU per step | [CF Workers limits](https://developers.cloudflare.com/workers/platform/limits/); [Render AI chat infra](https://render.com/articles/real-time-ai-chat-websockets-infrastructure) |
| Streaming CEO chat (LLM SSE) | ✅ native persistent process | ✅ OpenNext supports streaming | — |
| 6 cron schedules | ✅ ($1/mo each = $6) | ✅ included in Workers Paid | 250 triggers/acct cap on CF |
| Platform-ops cron (15 min) | ✅ | ⚠️ 30s CPU cap for sub-hour crons | — |
| Next.js 15 App Router + SSR | ✅ native | ⚠️ OpenNext adapter, 15.1 works, 15.2 middleware does NOT | [OpenNext CF](https://opennext.js.org/cloudflare) |
| Drizzle + `@neondatabase/serverless` | ✅ | ✅ HTTP driver designed for Workers | [Neon CF guide](https://neon.com/docs/guides/cloudflare-workers) |
| `jose` JWT auth | ✅ | ✅ with `nodejs_compat` flag | — |
| `@sentry/nextjs` | ✅ first-class | ⚠️ AsyncLocalStorage bugs open | [sentry-javascript #14931](https://github.com/getsentry/sentry-javascript/issues/14931) |
| Stripe/Dodo/Razorpay webhooks | ✅ | ✅ standard route handlers | — |
| Wildcard `*.baljia.app` | ✅ single Web Service + middleware | ⚠️ Custom Domains don't wildcard — need 2 routes + dispatch | [CF Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) |
| Per-founder app deployment | ⚠️ New Render service each ($7/mo) | ✅ Sandboxes GA, active-CPU pricing | [Sandbox GA](https://blog.cloudflare.com/sandbox-ga/) |
| Bundle size fit (~40 routes, 15+ SDKs) | ✅ no limit | ⚠️ 10 MiB gzipped cap — must measure | [CF Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| `ioredis` (TCP Redis, in `package.json`) | ✅ | ❌ TCP not supported — must remove | — |
| India latency | ❌ US-West only | ✅ global edge | — |
| Sentry error tracking | ✅ | ⚠️ open bugs | — |

---

## Cost Modeling at Three Scales

Assumptions: blended hosting only (LLM/DB/Redis identical either way). "Per-founder deployment" = 30% of customers trigger a web-app build. 1 active founder ≈ 10 agent tasks/day × 30s CPU each.

| Line item | 10 customers ($490 MRR) | 100 customers ($4,900 MRR) | 1,000 customers ($49,000 MRR) |
|---|---|---|---|
| **RENDER** | | | |
| Web Service (Starter → Standard at 100+ → Pro Plus) | $7 | $25 | $175 |
| 6 Cron Jobs ($1/mo each) | $6 | $6 | $6 |
| Background Worker (required for 4hr agents) | $0-25 | $25 | $85 |
| Per-founder Tier 3 (30% × Starter $7) | $21 | $210 | $2,100 |
| **Render subtotal** | **$34/mo** | **$266/mo** | **$2,366/mo** |
| **CLOUDFLARE** | | | |
| Workers Paid base | $5 | $5 | $5 |
| Request overage (10M included) | $0 | $0 | ~$30 |
| CPU ms (30M included, $0.02/M over) | $0 | ~$0 | ~$15 |
| Workflows storage | $0 | $0-2 | $5-10 |
| Durable Objects | ~$0 | ~$5 | ~$30 |
| Sandboxes active CPU (30% × founders) | ~$9 | ~$90 | ~$900 |
| Sandbox memory/disk provisioning | ~$5 | ~$50 | ~$500 |
| Egress (1 TB NA/EU included) | $0 | $0 | ~$25 |
| **Cloudflare subtotal** | **~$19/mo** | **~$152/mo** | **~$1,520/mo** |
| **Delta (Render − CF)** | $15/mo | $114/mo | $846/mo |

**Observation:** cost delta is noise at launch ($15/mo), modest at 100 customers ($114/mo = $1,400/yr), real at 1,000 customers ($846/mo = $10K/yr). Cost is not a Q2 launch driver.

**Uncertainty flags:**
- Sandbox per-instance memory/disk provisioning cost is weakest estimate (charged continuously, not active-only)
- Workflows CPU assumption of 30s/step is generous; real agent steps are mostly I/O waits — likely lower cost
- Render Background Worker tier not in current `render.yaml` — must add for either platform choice

---

## Migration Effort (if Cloudflare chosen)

| Work item | Files | Estimate | Risk |
|---|---|---|---|
| `wrangler.toml` + `open-next.config.ts` | new | 2h | Low |
| Port 6 crons → `[[triggers.crons]]` | `wrangler.toml` | 1h | Low |
| Refactor agent execution to Workflows v2 | `worker-launcher.ts`, `agent-factory.ts`, `watchdog.ts`, `api/worker/launch/route.ts` | **3-5 days** | **High** |
| Port watchdog semantics to per-step checkpoints (5min CPU cap) | `watchdog.ts` | 1 day | Medium |
| Drizzle per-request client pattern | `src/lib/db/client.ts` | 4h | Low |
| `nodejs_compat` flag + jose/crypto verification | `wrangler.toml` | 2h | Low |
| Sentry AsyncLocalStorage workaround | `sentry.server.config.ts`, `instrumentation.ts` | 4h | Medium (upstream bug) |
| Replace Render API with Sandbox SDK in per-founder deploy | `github.service.ts`, new `sandbox.service.ts` | 2 days | High (SDK is 10 days old) |
| Wildcard domain routes + dispatch | `middleware.ts`, `wrangler.toml` | 1 day | Medium |
| Bundle size measurement + potential code-split | multiple | 1-3 days if > 10 MiB | Unknown |
| Streaming chat E2E validation | `api/chat/route.ts` | 4h | Low |
| Remove `ioredis`, replace with `@upstash/redis` HTTP | any caller | 2-4h | Low |
| Playwright suite re-run on Workers | `tests/` | 1 day | Medium |
| **Total realistic** | | **12-18 working days** | |

**Hybrid option (CF front-door + Render agents): 3-5 days** — move SSR pages + webhooks + 5 of 6 crons to Workers, keep agent execution on Render Background Worker.

---

## Migration Effort (if staying on Render — still required work)

| Work item | Files | Estimate |
|---|---|---|
| Add Render Background Worker service to `render.yaml` | `render.yaml` | 1h |
| Refactor `worker-launcher` invocation from HTTP to queue-poll pattern | `worker-launcher.ts`, `event.service.ts`, possibly QStash | 1-2 days |
| Validate 4-hr agent task runs end-to-end on Background Worker | testing | 4h |
| Complete dashboard OAuth + Blueprint + env vars | (you do) | 15 min |
| Put CF in front of baljia.ai + *.baljia.app as CDN | Cloudflare dashboard | 1h |
| **Total** | | **2-3 days** |

---

## Risk Matrix

### Render

| Risk | Severity | Detail |
|---|---|---|
| 100-min Web Service cap breaks 4hr agent | **HIGH — active bug** | Must add Background Worker; not in current `render.yaml` |
| Oregon region → India latency | Medium | ~220ms per request; mitigate with CF CDN in front (free) |
| Mature ops, low surprise | Low positive | Shallow learning curve, predictable billing |
| Tier 3 cost grows linearly | Medium | $210/mo at 100 customers, $2,100/mo at 1,000 |
| Lock-in | Low | Standard Node processes, portable |
| Ecosystem | Low | Stable, no 2026 repricing signals |

### Cloudflare

| Risk | Severity | Detail |
|---|---|---|
| Workflows v2 is 10 days old | **Medium-High** | Rearchitected April 15, 2026 for agentic workloads. Could rearchitect again in 2027. |
| Sandboxes GA is 10 days old | Medium | SDK surface will evolve; per-founder deploy code depends on evolving API |
| Sentry + OpenNext open bugs | Medium | AsyncLocalStorage issues unresolved; affects observability in production |
| Paradigm shift for solo founder | **High** | Each new primitive (Workers, Workflows, DO, Sandboxes, Queues, R2, KV) = new failure surface |
| Bundle size 10 MiB cap | Medium | Must measure; risk of post-migration surprise requiring code-split |
| Lock-in (Workflows step functions) | Medium-High | Porting back is harder than porting forward was |
| Debug complexity | Medium | Edge runtime logging/stepthrough more painful than `render logs tail` |
| India latency | Positive | Global edge solves this natively |

---

## Trade-off Analysis

### Why "stay on Render" wins for the launch

1. **Shipping beats optimizing.** Pre-revenue solo founder + 1-2 month launch window. The $15/mo cost delta at 10 customers is invisible; the 12-18 day migration is the most expensive line item in the company's runway right now.

2. **The 100-min bug is forcing a change regardless.** Whichever platform is chosen, `worker-launcher.ts` needs a background-execution pattern. On Render that's a Background Worker (1 day). On Cloudflare that's a Workflows v2 port (3-5 days + ripple effects). The minimum-viable fix is shorter on the platform we already have code for.

3. **Cloudflare's compelling piece is the Tier 3 replacement, not the platform itself.** Sandboxes vs per-founder Render services is where the architectural + cost argument is strongest. But Tier 3 only matters when founders exist and are triggering engineering-agent product builds — not a launch-week concern.

4. **Operational familiarity is a solo-founder multiplier.** Render's "it's a Linux box running your code" model means any Node developer can debug it. Workers + Workflows + Sandboxes is five new abstractions to learn simultaneously, each with their own deploy/log/debug story. For a solo founder, this compounds into real operational load.

5. **Change-my-mind conditions exist and are clear.** This isn't "Render forever" — it's "Render now, Cloudflare in Q3 when the new primitives have track record and the cost delta is real."

### Why "migrate to Cloudflare now" loses

- Migration cost (12-18 days) > cost savings over 3 months ($45-$300)
- Workflows v2 + Sandboxes being 10 days old is a genuine early-adopter risk — not a hypothetical
- Solo founder debugging edge runtime + multiple new primitives during launch crunch = operational risk

### Why "Hybrid" loses

- Doesn't solve the 4-hour agent problem (still need Render Background Worker for that)
- Adds vendor #2 without reducing the vendor #1 dependency
- Complexity beats cost savings at launch scale

### What could change this analysis

- **If Render rejects Baljia's Pvt Ltd account** or requires verification Baljia can't provide: forced to Cloudflare anyway.
- **If bundle size measurement shows Baljia comfortably under 10 MiB:** one less migration risk, but doesn't change launch-timing math.
- **If Sentry + OpenNext bugs close before Q3:** removes a migration blocker.
- **If Workflows v2 has been stable for 6 months with no further rearchitecture:** reduces early-adopter risk.

---

## Consequences

**What becomes easier:**

- Ship in 2-3 days (Render Background Worker + OAuth + deploy)
- Debug in production using familiar tools
- Node.js ecosystem — no `fs` restrictions, no bundle-size limits, no cross-runtime compatibility audits
- Sentry observability works first-class
- Keep existing `render.yaml`, `scripts/deploy-platform.ts`, `landing-deploy.service.ts`

**What becomes harder:**

- Per-founder Tier 3 cost scales linearly — at 100 customers, $210/mo goes to per-founder Render services. At 1,000, $2,100/mo. Must plan Sandboxes migration for Tier 3 in Q3.
- India founder latency remains until CF CDN is fronted (free, 1 hour work)
- Single-region exposure to Render's Oregon DC
- Tier 3 reactivation-after-churn requires Render API orchestration (vs Sandbox on-demand)

**What we'll need to revisit:**

- **Q3 2026:** Cloudflare Sandboxes for Tier 3 per-founder deployments. Budgeted 3-week project. Trigger: 50+ active founder product deployments on Render.
- **Q4 2026 / H1 2027:** Full Cloudflare migration for platform. Trigger: Workflows v2 + Sandboxes have 6+ months operational maturity AND open Sentry bugs closed AND bundle fits under 10 MiB.
- **Immediately:** Fix the 100-minute HTTP cap by adding Background Worker. This is required regardless of future hosting choice.

---

## Action Items

### This week (critical path — the 100-min bug is real)

1. [ ] **Add Render Background Worker service** to `render.yaml`. File: `C:\Users\Vaishnavi\My_Projects\baljia-ai\render.yaml`. ~1h.
2. [ ] **Refactor `launchTask()` invocation** from "HTTP handler blocks until done" to "HTTP handler enqueues, Background Worker polls + runs." Files: `src/lib/agents/worker-launcher.ts`, `src/app/api/worker/launch/route.ts`, possibly add `@upstash/qstash` publish. ~1-2 days.
3. [ ] **Validate end-to-end** a 4-hour agent task on Background Worker via sandbox test.
4. [ ] **User completes Render dashboard OAuth** + Blueprint deploy + env var paste via https://dashboard.render.com/blueprints. 15 min.
5. [ ] **User sends `*.onrender.com` hostname** to Claude.
6. [ ] **Run `scripts/deploy-platform.ts`** to add DNS + custom domains. ~30s.
7. [ ] **Verify** `curl https://baljia.ai/api/health` returns 200 + `{slug}.baljia.app` for a prior smoke-test slug resolves.

### This month (latency + lifecycle)

8. [ ] **Front `baljia.ai` and `*.baljia.app` with Cloudflare** CDN proxy (both zones already owned). Free. Cuts India latency ~80%. ~1h.
9. [ ] **Build hosting-lifecycle cron** (SPEC-BILL-104) — delete Tier 3 services on churned subscriptions. Host-agnostic, works with any platform. ~1 day.
10. [ ] **Add `billing_state` guardrail** to `engineering.tools.ts::render_create_service` to prevent Tier 3 provisioning for suspended accounts. ~10 lines.
11. [ ] **Remove `ioredis` dependency** if only used in scripts (audit usage). Keeps CF migration cheaper later. ~2h.

### Q3 2026 (the real Cloudflare decision)

12. [ ] **Pilot Cloudflare Sandboxes** for ONE per-founder deployment. Validate: cost, performance, SDK stability.
13. [ ] **Decide Tier 3 migration**: if pilot successful, plan 2-week Sandboxes migration replacing per-founder Render services.
14. [ ] **Decide full platform migration**: if Workflows v2 stable + Sentry bugs closed + bundle fits, plan 3-week Workers migration.

### Explicitly NOT doing now

- ❌ Full Cloudflare migration pre-launch
- ❌ Rewriting `worker-launcher.ts` as Workflows v2 (yet)
- ❌ Migrating Tier 3 to Sandboxes (not yet piloted, not required at launch)

---

## Uncertainty & Verification

**Items that would strengthen this ADR if verified:**

- [ ] Bundle size measurement on Baljia's actual build (`opennextjs-cloudflare build` dry run) — would confirm/refute 10 MiB risk for Option B
- [ ] Confirm Render Starter supports Background Workers on same plan or requires upgrade
- [ ] Sandboxes pricing: per-memory-hour rate for provisioned instances (docs are lean on this)
- [ ] Test that Neon AP-south connection from Render Oregon adds acceptable latency for dashboard UX

**Research date:** April 22, 2026 — conducted by Backend Architect subagent against primary sources.

---

## Sources

### Cloudflare — primary
- [Rearchitecting Workflows v2 for AI agents](https://blog.cloudflare.com/workflows-v2/) — April 2026
- [Workflows limits reference](https://developers.cloudflare.com/workflows/reference/limits/)
- [Workflows pricing reference](https://developers.cloudflare.com/workflows/reference/pricing/)
- [Workflows concurrency/creation-rate changelog](https://developers.cloudflare.com/changelog/post/2026-04-15-workflows-limits-raised/) — April 15, 2026
- [Workflows step limit increased to 25,000](https://developers.cloudflare.com/changelog/post/2026-03-03-step-limits-to-25k/) — March 3, 2026
- [Agents have their own computers with Sandboxes GA](https://blog.cloudflare.com/sandbox-ga/) — April 2026
- [Containers and Sandboxes GA changelog](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/) — April 13, 2026
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers paid pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- [Sandbox SDK pricing](https://developers.cloudflare.com/sandbox/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cron Triggers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Node.js compatibility in Workers](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Next.js on Workers framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Custom Domains routing](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Agents Week 2026 review](https://blog.cloudflare.com/agents-week-in-review/)

### OpenNext
- [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare)
- [OpenNext troubleshooting](https://opennext.js.org/cloudflare/troubleshooting)

### Neon + Cloudflare
- [Neon with Cloudflare Workers guide](https://neon.com/docs/guides/cloudflare-workers)
- [Hyperdrive + Neon FAQ](https://neon.com/blog/hyperdrive-neon-faq)

### Sentry + Cloudflare (known issues)
- [sentry-javascript #14931 — OpenNext Cloudflare support](https://github.com/getsentry/sentry-javascript/issues/14931)
- [sentry-javascript #18842 — AsyncLocalStorage Next.js error](https://github.com/getsentry/sentry-javascript/issues/18842)
- [Sentry + Cloudflare deployment docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/best-practices/deploying-on-cloudflare/)

### Render — primary
- [Web Services docs](https://render.com/docs/web-services)
- [Cron Jobs docs](https://render.com/docs/cronjobs)
- [Background Workers docs](https://render.com/docs/background-workers)
- [Real-Time AI Chat — confirms 100-min HTTP cap](https://render.com/articles/real-time-ai-chat-websockets-infrastructure)
- [Render pricing](https://render.com/pricing)

### Baljia codebase
- `render.yaml` — current deployment definition
- `src/lib/agents/watchdog.ts:11` — `MAX_EXECUTION_MS = 4 * 60 * 60 * 1000`
- `src/lib/agents/worker-launcher.ts` — long-running execution entry point
- `src/app/api/worker/launch/route.ts` — HTTP handler (the current bug source)
- `src/app/api/chat/route.ts` — streaming handler
- `package.json` — dependency list feeding bundle-size risk

---

*Authored: April 22, 2026. Supersedes any previous implicit hosting decisions in earlier architecture docs. Review trigger: first of — (a) 50+ founder product deployments on Render, (b) 6 months elapsed since Workflows v2 GA, (c) Sentry OpenNext bugs closed.*
