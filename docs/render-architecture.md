# Render Architecture (Platform + Per-Company Hosting)

**Audience:** Engineers, DevOps, founders deciding hosting strategy
**Companion to:** [DEPLOYMENT.md](./DEPLOYMENT.md) (ops-level deploy guide)
**Scope:** 3-tier architecture, cost model, lifecycle management, deployment flow

---

## TL;DR — The Three Tiers

Baljia runs on Render with three distinct service tiers:

```
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: Platform (Baljia's own Next.js app)                 │
│   - One service for the entire platform                     │
│   - Repo: yadavdg693-sys/Balaji                             │
│   - Domain: baljia.ai                                       │
│   - Plan: Starter ($7/mo) + 6 cron jobs ($1/mo each)        │
│   - Total: $13/mo                                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Tier 2: Founder landing pages (static HTML)                 │
│   - One static site per onboarded company                   │
│   - Repo: BALAJIapps/{slug}-site                            │
│   - Domain: {slug}.baljia.app                               │
│   - Plan: FREE tier (100GB bandwidth/mo)                    │
│   - Auto-provisioned at onboarding completion                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Tier 3: Founder product deployments (full web services)     │
│   - One service per founder who builds a web app            │
│   - Repo: BALAJIapps/{slug}                                 │
│   - Domain: app.{slug}.baljia.app OR founder's custom domain│
│   - Plan: Starter ($7/mo per active product)                │
│   - Provisioned LAZY — only when engineering agent builds   │
│     a web app (not for every founder)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Tier 1: Platform Service

### Purpose

Host the Baljia Next.js app (`yadavdg693-sys/Balaji`). This is the founder-facing dashboard, CEO/chat, onboarding pipeline, agent orchestration, API routes, and webhook handlers.

### Configuration

- **Type:** Render Web Service
- **Plan:** Starter ($7/mo) — always-on, required for 4-hour agent runs
- **Region:** Oregon (`us-west` — low latency to OpenAI + Anthropic APIs)
- **Health check:** `/api/health` (configured in `render.yaml`)
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Auto-deploy:** From `main` branch on every push

### Cron jobs (6 total, $1/mo each = $6/mo)

| Cron | Schedule | Purpose |
|---|---|---|
| `baljia-night-shift` | `0 2 * * *` (2am UTC daily) | Run night shift orchestration for all active companies |
| `baljia-recurring` | `0 */6 * * *` (every 6 hours) | Materialize recurring task instances |
| `baljia-trial-expiry` | `0 3 * * *` (3am UTC daily) | Suspend expired trials / past-due subs |
| `baljia-platform-ops` | `*/15 * * * *` (every 15 min) | Platform ops monitoring, regression guard |
| `baljia-credit-renewal` | `0 4 * * *` (4am UTC daily) | Safety-net: missed Stripe webhook credit grants |
| `baljia-onboarding-cleanup` | `*/5 * * * *` (every 5 min) | Sweep stuck onboarding rows |

### Total cost

- **Web service:** $7/mo (Starter)
- **6 crons:** $6/mo ($1/mo each)
- **Total:** **$13/mo** — fixed, doesn't scale with users

### Deployment process

1. **Dashboard step (one-time, ~10 min):** Render dashboard → New Blueprint → connect GitHub `yadavdg693-sys/Balaji` → accept blueprint proposal (1 web + 6 crons) → paste ~24 env vars → deploy
2. **API step (automated):** `scripts/deploy-platform.ts` adds:
   - Cloudflare DNS: `baljia.ai @` + `www` → `onrender.com` hostname
   - Cloudflare DNS: `baljia.app @` + `*` (wildcard) → same hostname
   - Render custom domains: `baljia.ai`, `www.baljia.ai`, `baljia.app`, `*.baljia.app`
3. **Verification:** `curl https://baljia.ai/api/health` → 200 OK

See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step runbook.

---

## Tier 2: Founder Landing Pages

### Purpose

Every onboarded company gets a public landing page at `{slug}.baljia.app`. Example: `amendly.baljia.app`, `markmeld.baljia.app`. This is pure HTML generated during onboarding by the content/branding agent.

### Configuration

- **Type:** Render Static Site
- **Plan:** **FREE tier** (100GB bandwidth/mo, no compute cost)
- **Repo:** `BALAJIapps/{slug}-site` (one repo per company in the platform-owned GitHub org)
- **Build:** `:` (no-op; pure static HTML) + `staticPublishPath: ./`
- **Deploy:** Auto-provisioned on onboarding completion via `src/lib/services/landing-deploy.service.ts`

### Lifecycle

```
Onboarding completes
  ↓
landing-deploy.service.ts runs:
  1. Create GitHub repo BALAJIapps/{slug}-site (private)
  2. Push index.html (generated landing HTML from onboarding agent)
  3. Push minimal render.yaml
  4. Create Render static site pointing at repo
  5. Save repo + render_service_id to companies table
  6. Swap DNS: {slug}.baljia.app parking CNAME → real Render hostname
```

### Cost at scale

- **1 company:** $0 (free tier)
- **100 companies:** $0 (still within free bandwidth)
- **1,000 companies:** $0 (still within free bandwidth for most)
- **10,000 companies:** $0 if each uses <100GB/mo (which landing pages do)

**Tier 2 is essentially free forever** — Render's static site free tier handles this scale.

### When Tier 2 breaks

- Render discontinues free static sites (unlikely; they've committed to free tier)
- A single company's landing page exceeds 100GB bandwidth/mo (implausible for HTML)
- Render imposes per-account static site count limit (not currently)

---

## Tier 3: Founder Product Deployments

### Purpose

When a founder approves an engineering task that builds a web app (not just content/marketing), the engineering agent creates a full Render Web Service for that product. Examples:
- Founder Sarah builds Notely (note-taking SaaS)
- Founder Mark builds Amendly (revision checklist tool)
- Founder Priya builds Planaut (planning tool)

Each is a real web service with its own backend, DB connection, deployed at its own URL.

### Configuration

- **Type:** Render Web Service
- **Plan:** Starter ($7/mo per service)
- **Repo:** `BALAJIapps/{slug}` (separate from landing page repo)
- **Domain:** `app.{slug}.baljia.app` (or founder's custom domain if configured)
- **Provisioning:** LAZY — only when founder approves "build a web app" engineering task

### Why lazy provisioning

**Pre-revenue:** most founders haven't committed to actually running a product yet. Creating a Tier 3 service for every onboarded founder = $7/mo × every signup = unsustainable burn.

**Lazy model:**
- Day 0: Founder onboards → gets Tier 2 landing + Tier 1 dashboard → **$0 marginal cost**
- Day N: Founder approves engineering task → Tier 3 service created → **+$7/mo marginal**
- Founder cancels subscription → Tier 3 service deleted → **-$7/mo**

This ties Tier 3 cost to revenue-generating founders, not signups.

### Cost at scale

| Founders | With subscribed status | Tier 3 services | Tier 3 monthly cost |
|---|---|---|---|
| 10 onboarded | 3 paid (30%) | 3 × $7 = | $21/mo |
| 100 onboarded | 30 paid (30%) | 30 × $7 = | $210/mo |
| 1,000 onboarded | 300 paid (30%) | 300 × $7 = | $2,100/mo |

**Tier 3 cost scales linearly with active paying customers** — which is acceptable because those customers are generating revenue.

### Revisiting at scale

At 100+ paying customers (Tier 3 cost $700+/mo), consider:

1. **Move Tier 3 to Fly.io** — scale-to-zero built in (~$1-2/app with idle suspend). Cost cut 70-80%.
2. **Cloudflare Workers** — if founder apps are mostly stateless / API-only, Workers is pennies.
3. **Shared container pool** — one Render instance hosting many founder apps via container isolation. Requires re-architecture.

**Current recommendation:** stay on Render until $500+/mo Tier 3 cost, then evaluate migration.

---

## Multi-Tier DNS Architecture

### Domains used

- **`baljia.ai`** — platform (Tier 1)
- **`baljia.app`** — founder subdomain parent (Tiers 2 and 3)
  - `{slug}.baljia.app` — landing pages (Tier 2 static sites)
  - `app.{slug}.baljia.app` — full product deployments (Tier 3 when exists) — OR founder's custom domain

### Cloudflare DNS records

```
Zone: baljia.ai
  A / CNAME @  → onrender.com (platform hostname)
  CNAME www    → baljia.ai
  MX / TXT for SPF/DKIM/DMARC (Postmark email setup)

Zone: baljia.app
  A / CNAME @  → onrender.com (fallback landing page)
  CNAME *      → onrender.com (wildcard — catches {slug}.baljia.app for all founders)
  MX / TXT for SPF/DKIM/DMARC (per-company email sending via {slug}@baljia.app)
```

### Routing at Render / Next.js

Platform (`baljia.ai`) and subdomains (`*.baljia.app`) hit the same Render service. Next.js middleware (`src/middleware.ts`) routes based on `host` header:

- `host === 'baljia.ai'` → serve dashboard / app routes
- `host === 'www.baljia.ai'` → redirect to apex
- `host === '{slug}.baljia.app'` → lookup `companies.slug` → serve `documents.landing_page` HTML
- `host === 'app.{slug}.baljia.app'` → proxy to founder's Tier 3 service (if exists)
- Unknown subdomain → 404

This architecture means **wildcard DNS `*.baljia.app` catches ALL founder subdomains automatically** — no per-founder DNS work.

---

## Hosting State Machine (SPEC-BILL-104)

Every company has a `hosting_state` field that tracks Tier 2 + Tier 3 status:

```
  ┌─────────────────┐
  │   not_hosted    │  ← no Render services yet
  └────────┬────────┘
           │ onboarding completes
           ▼
  ┌─────────────────┐
  │  landing_live   │  ← Tier 2 static site provisioned
  └────────┬────────┘
           │ engineering agent builds web app
           ▼
  ┌─────────────────┐
  │   product_live  │  ← Tier 3 service provisioned
  └────────┬────────┘
           │ subscription lapses / churned
           ▼
  ┌─────────────────┐
  │    suspended    │  ← Tier 3 service paused (kept in Render)
  └────────┬────────┘
           │ 7-day grace period
           ▼
  ┌─────────────────┐
  │     archived    │  ← Tier 3 service deleted (saves $7/mo)
  └────────┬────────┘  ← Tier 2 static remains (free)
           │ founder resubscribes
           ▼
  ┌─────────────────┐
  │   reactivating  │  ← Tier 3 recreated from repo
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │   product_live  │
  └─────────────────┘
```

### Lifecycle cron (to be built)

File: `src/app/api/cron/hosting-lifecycle/route.ts` (to be added to `render.yaml`)
Schedule: daily

```typescript
export async function runLifecycleCron() {
  // Find companies where subscription lapsed 7+ days ago
  const lapsed = await db.select().from(companies)
    .where(and(
      eq(companies.hosting_state, 'suspended'),
      lt(companies.suspended_at, sql`now() - interval '7 days'`),
    ));

  for (const co of lapsed) {
    // Delete Render service
    if (co.render_service_id) {
      await renderApi.deleteService(co.render_service_id);
    }

    // Mark archived
    await db.update(companies).set({
      hosting_state: 'archived',
      render_service_id: null,
    }).where(eq(companies.id, co.id));

    // Keep GitHub repo (cheap to retain; needed for reactivation)
    // Keep Tier 2 landing page (free tier; stays)
    // Keep Neon DB (scale-to-zero; costs pennies)

    await eventService.emit(co.id, 'hosting_archived', {});
  }
}
```

### Reactivation flow (founder resubscribes after archive)

```typescript
export async function reactivateHosting(companyId: string) {
  const [co] = await db.select().from(companies)
    .where(eq(companies.id, companyId));

  if (co.hosting_state !== 'archived') return;

  // Recreate Render service from existing GitHub repo
  const service = await renderApi.createService({
    repo: co.github_repo,
    branch: 'main',
    plan: 'starter',
    // ... config from company record
  });

  await db.update(companies).set({
    hosting_state: 'product_live',
    render_service_id: service.id,
  }).where(eq(companies.id, companyId));
}
```

---

## Cost Model at Different Scales

### Day 0 (pre-launch)

- Tier 1: $13/mo (platform + crons)
- Tier 2: $0 (no companies yet)
- Tier 3: $0 (no products yet)
- **Total: $13/mo**

### 10 companies (3 subscribed, 1 built web app)

- Tier 1: $13/mo
- Tier 2: 10 × $0 = $0
- Tier 3: 1 × $7 = $7
- **Total: $20/mo**

### 100 companies (30 subscribed, 10 built web apps)

- Tier 1: $13/mo
- Tier 2: 100 × $0 = $0
- Tier 3: 10 × $7 = $70
- **Total: $83/mo**

### 1,000 companies (300 subscribed, 150 built web apps)

- Tier 1: $13/mo
- Tier 2: 1,000 × $0 = $0
- Tier 3: 150 × $7 = $1,050
- **Total: $1,063/mo**

### 10,000 companies (3,000 subscribed, 1,500 built web apps)

- Tier 1: $13/mo (still same — platform doesn't scale)
- Tier 2: 10,000 × $0 = $0 (might push Render free tier limits; could require paid static)
- Tier 3: 1,500 × $7 = $10,500
- **Total: $10,513/mo**

At this scale, **Tier 3 migration** becomes critical cost lever:
- Fly.io with scale-to-zero: 1,500 × $1-2 = $1,500-3,000 (70-85% savings vs Render)
- Cloudflare Workers: $1,500 × $0.30 = $450 (if apps are API-only) — 96% savings

---

## Alternative Architectures Considered

### A. Shared Render service (one service hosts many founder apps)

Other AI proposal: one Render service running a reverse proxy, routes by domain, all apps in one Node process.

**Rejected because:**
- Shared process = shared crash (one bad founder code kills fleet)
- Shared memory = security blast radius (one apps' env vars accessible to others)
- Shared deps = can't support Python founder apps alongside Node apps
- Shared deploy cycle = one founder's change redeploys all 1000
- Resource contention = one founder's spike starves others
- For paying customers, this is unacceptable isolation level

### B. Render cluster with K8s

- Overkill for pre-revenue
- Operational complexity (cluster management) > savings
- Revisit at $10K+ monthly compute cost

### C. AWS / GCP / Azure

- More flexibility but much higher setup cost
- Render already works; don't migrate prematurely
- Revisit if Render pricing/reliability becomes a constraint

---

## Operational Considerations

### Render account limits

- Render free tier: unlimited static sites (up to 100GB bandwidth/mo each)
- Render Starter: no hard limit on number of services per account, but $7/mo each adds up
- API rate limits: 1000 requests/hour (sufficient for our provisioning volume)

### GitHub org (BALAJIapps)

- Platform-owned GitHub org for per-founder repos
- Each founder has 2 repos: `{slug}-site` (Tier 2) + `{slug}` (Tier 3 if built)
- PAT with `repo` + `admin:org` scope stored as `GITHUB_TOKEN` env var
- Free for the organization at our scale

### Secrets per-Tier-3 service

When engineering agent provisions Tier 3, it needs to pass:
- `DATABASE_URL` → founder's Neon DB (company-specific)
- `AUTH_SECRET` → generated per-company
- Founder's payment provider creds (if connected via Flow 2)
- Any other service-specific env vars the generated code needs

Stored as Render env vars on each Tier 3 service, `sync: false`.

### Monitoring

- Tier 1 health: `/api/health` endpoint + Render dashboard
- Tier 2 uptime: part of Render static site SLA; near-100%
- Tier 3 health: each service should have own `/api/health` + Sentry
- Platform ops cron monitors all 3 tiers every 15 min

---

## Integration with Payment System

Hosting lifecycle ties into payment lifecycle (see [baljiapayment.md](./baljiapayment.md)):

| Payment event | Hosting action |
|---|---|
| Subscription created (trial → active) | No change — Tier 2 already live from onboarding |
| Subscription renewed | No change |
| First engineering task approved ("build a web app") | Tier 3 provisioned |
| Subscription past-due | `hosting_state = suspended`, Tier 3 paused (optional) |
| Subscription cancelled | `hosting_state = suspended` starts 7-day grace |
| Grace period expired | `hosting_state = archived`, Tier 3 deleted |
| Subscription resubscribed (within 30 days) | `hosting_state = reactivating` → Tier 3 recreated from repo |
| Account deleted (DPDP delete) | All tiers deleted: repo + Render service + Neon DB purged |

---

## Why This Architecture

### Isolation

Each founder gets their own service (Tier 3). One founder's crash / deploy / resource spike cannot affect another founder's app. Different founders can run different stacks (Node, Python, Go — each Tier 3 is independent).

### Cost efficiency

- Tier 2 free for all founders = $0 for signup
- Tier 3 lazy = no cost until founder commits to a product
- No runaway cost on unconverted trials (archived after 7-day grace)

### Operational simplicity

- Wildcard DNS means founder subdomain setup is 0 manual steps
- Platform-owned GitHub org keeps Render connections simple
- Three tiers are easy to explain and monitor

### Scalability

- Tier 1 scales vertically within Render's Starter → Standard → Pro tiers
- Tier 2 infinitely scalable (free static sites)
- Tier 3 scales linearly with paying customers — cost tied to revenue

---

## Related Docs

- [DEPLOYMENT.md](./DEPLOYMENT.md) — one-time Render deploy runbook
- [baljiapayment.md](./baljiapayment.md) — payment architecture (hosting ties into subscription lifecycle)
- [payment-operations-runbook.md](./payment-operations-runbook.md) — includes provider freeze + hosting lifecycle response

---

*Last updated: April 2026*
*Architecture stable from Day 0; revisit at $500+/mo Tier 3 spend (migration candidate point)*
