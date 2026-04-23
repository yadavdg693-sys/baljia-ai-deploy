# Cloudflare Founder-App Runbook

**Scope:** Deploy, operate, and troubleshoot founder apps at `*.baljia.app` running on Cloudflare Workers + R2.
**Architecture:** See [ADR-002 Split Hosting Strategy](./adr-002-split-hosting-strategy.md).
**Branch:** This runbook describes work committed to `cloudflare-spike`. The platform on `main` remains on Render.

---

## 1. What this covers

Per ADR-002, the split-hosting architecture puts **founder apps** on Cloudflare Workers while the **platform itself** stays on Render. This runbook is specifically for the founder-app half:

- **`baljia-founder-apps`** — a single wildcard Worker that serves every founder's landing page from R2 by Host-header routing. Location: `baljia-ai-cf/founder-app-worker/`.
- **`cf-deploy.service.ts`** — the platform-side client the Engineering agent uses to push landing HTML into R2. Location: `baljia-ai-cf/src/lib/services/cf-deploy.service.ts`.
- **Engineering agent tools** (`cf_deploy_landing`, `cf_verify_founder_app`, `cf_delete_founder_app`) — the agent-callable surface. Location: `baljia-ai-cf/src/lib/agents/tools/engineering.tools.ts`.

Not covered (intentional v1.0 scope):
- Tier 2/3 full-stack founder apps with custom code per founder
- Per-founder Workers (Shape 2 per ADR-002)
- Platform migration to Cloudflare — deferred to v1.5 (see `cf-migration-plan.md` on main)

---

## 2. First-time setup (one-time, runs on the Cloudflare side)

These steps produce a working deploy environment. Required once per Baljia CF account.

### 2.1 Verify required env vars

On the platform (Render) side, these env vars must be populated:

```
CLOUDFLARE_API_TOKEN      # scoped: Workers Scripts Write, Workers Routes, Zone DNS, R2 Read/Write
CLOUDFLARE_ACCOUNT_ID     # the CF account ID (32-char hex)
CLOUDFLARE_ZONE_ID_APP    # zone ID for baljia.app
R2_ACCOUNT_ID             # same as CF account ID, used by S3 SDK endpoint URL
R2_ACCESS_KEY_ID          # R2 API token access key
R2_SECRET_ACCESS_KEY      # R2 API token secret
R2_BUCKET_NAME            # bucket name, e.g. "baljia-assets"
```

Quick sanity check:

```bash
# From platform repo:
node -e "console.log({
  token: !!process.env.CLOUDFLARE_API_TOKEN,
  acct:  !!process.env.CLOUDFLARE_ACCOUNT_ID,
  zone:  !!process.env.CLOUDFLARE_ZONE_ID_APP,
  r2:    !!process.env.R2_BUCKET_NAME
})"
```

All four should be `true`.

### 2.2 Create the R2 bucket (once)

```bash
# Requires wrangler logged in to the correct CF account
cd baljia-ai-cf/founder-app-worker
npx wrangler r2 bucket create baljia-assets
```

Or use the CF dashboard: R2 → Create Bucket → name: `baljia-assets` → location: auto.

### 2.3 Deploy the wildcard Worker (once, and on updates)

```bash
cd baljia-ai-cf/founder-app-worker
npx wrangler deploy
```

Requires **Workers Paid plan ($5/mo)** on the Cloudflare account. Deploy registers the Worker script `baljia-founder-apps` and the route `*.baljia.app/*`.

Verify:
```bash
npx wrangler deployments list
# Should show baljia-founder-apps with status=deployed
```

### 2.4 Create the wildcard DNS record (once)

In the Cloudflare dashboard:

1. Go to DNS → baljia.app → Add record
2. Type: `CNAME`, Name: `*`, Target: `baljia-founder-apps.<your-subdomain>.workers.dev`, Proxy: ON (orange cloud)
3. Save

Or via CF API (not automated in code — one-time):
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"*","content":"baljia-founder-apps.workers.dev","proxied":true,"ttl":1}'
```

### 2.5 Smoke-test the deployed Worker

```bash
# Expect 404 "Not ready yet" page with Baljia branding
curl -I https://anything.baljia.app
# Headers should include: x-baljia-tier: 0, x-baljia-subdomain: anything
```

If you see CF's default error page instead of the Baljia-branded 404, the wildcard route isn't bound to the Worker — recheck 2.3 / 2.4.

---

## 3. Normal deploy flow (every founder)

This happens automatically when the Engineering agent runs the `cf_deploy_landing` tool. Manual sequence for reference or direct invocation:

### 3.1 Engineering agent's path

```
Onboarding step: generate_landing_page
  → produces landingHtml (string, ≤5 MB)
Engineering agent task: deploy landing
  → calls cf_deploy_landing({ html: landingHtml })
  → tool resolves company.subdomain from DB
  → tool calls uploadLandingHtml({ subdomain, html })
  → R2 key written: founder-apps/{subdomain}/index.html
  → DB updated: company.subdomain + company.custom_domain
  → returns URL: https://{subdomain}.baljia.app
Engineering agent verifier:
  → calls cf_verify_founder_app()
  → HTTP GET the live URL, expects 200 + body snippet
```

### 3.2 Direct deploy via script (for manual tests)

```bash
cd baljia-ai-cf
npx tsx scripts/test-cf-deploy.ts acme "<html>...</html>"
# Uses cf-deploy.service.ts directly; no agent, no DB writes
```

(Script not yet written — add if manual deploys become common.)

### 3.3 Idempotency guarantee

`uploadLandingHtml` always overwrites. Calling it twice with the same subdomain + different HTML is safe and produces the latest version. The R2 object's ETag changes so downstream caches (CF + browser) invalidate via the `etag`/`if-none-match` flow in the Worker.

---

## 4. Verifying a founder app is live

Three layers of verification:

### 4.1 Fast: HTTP check
```bash
curl -sI https://acme.baljia.app | head -5
# HTTP/2 200
# content-type: text/html; charset=utf-8
# x-baljia-tier: 1
# x-baljia-subdomain: acme
```

### 4.2 Full: body inspection
```bash
curl -s https://acme.baljia.app | head -20
# Should render the actual generated landing HTML (<!DOCTYPE html>...)
```

### 4.3 Cache + CDN sanity
```bash
curl -sI https://acme.baljia.app | grep -iE "cf-ray|cf-cache-status|etag"
# cf-ray:  <id>-<colo>          ← confirms CF edge served it
# etag:    "<hash>"               ← should change on every redeploy
```

---

## 5. Incident response

### 5.1 Founder app returns 404 "Not ready yet"

Meaning: R2 has no content at `founder-apps/{subdomain}/index.html`.

Diagnose:
```bash
# From a dev machine with R2 creds:
npx wrangler r2 object get baljia-assets/founder-apps/acme/index.html --pipe | head -5
# If "object not found": deploy didn't run or failed silently
```

Fix:
```bash
# Option A: re-run the onboarding deploy step (preferred)
# Option B: manual force-deploy
npx tsx scripts/force-cf-redeploy.ts <companyId>
```

### 5.2 Founder app returns 502 "Storage error"

Meaning: R2 bucket binding broke or R2 service is degraded.

Diagnose:
1. Check CF status: https://www.cloudflarestatus.com
2. Tail Worker logs: `npx wrangler tail baljia-founder-apps --format=pretty`
3. Look for `R2 get error` log lines with the key that failed

Fix:
- If R2 outage: wait for CF recovery (no action needed; Worker returns branded error page, no data loss)
- If binding broken: redeploy the Worker (`npx wrangler deploy` from `founder-app-worker/`)

### 5.3 Founder app serves stale content after redeploy

Cache-Control on Tier 1 is `max-age=60, stale-while-revalidate=300`. A redeploy should flush within ~60s.

Force-flush:
```bash
# Purge CF edge cache for one URL
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"files":["https://acme.baljia.app/","https://acme.baljia.app/index.html"]}'
```

### 5.4 Wrong content served after redeploy

Meaning: R2 key written with unexpected subdomain, or DB `company.subdomain` diverged.

Check:
```bash
# Platform-side query
SELECT id, subdomain, custom_domain FROM companies WHERE id = '<company_id>';

# R2-side check
npx wrangler r2 object get baljia-assets/founder-apps/<subdomain>/index.html --pipe | head -5
```

Fix: update `companies.subdomain` to the correct value, then re-run `cf_deploy_landing`.

### 5.5 CF Worker deploy limits reached

Workers Paid includes 100 deploys/day (at the time of writing). If you hit this:
- Investigate: why are we deploying so often? Likely a bug in retry logic or onboarding re-runs.
- Temp fix: wait for the 24h window to reset.
- Permanent fix: add dedup/idempotency at the onboarding pipeline level.

---

## 6. Rollback procedures

### 6.1 Roll back one founder app

If a bad HTML shipped to a single founder:
```bash
# If you have the previous HTML saved (recommended: keep the last 5 versions in a versioned R2 prefix)
npx wrangler r2 object put baljia-assets/founder-apps/acme/index.html --file=good.html
```

There is no built-in version history on R2 objects — if you need history, turn on R2 object versioning per-bucket in the CF dashboard (no code change needed).

### 6.2 Roll back the Worker script

```bash
cd baljia-ai-cf/founder-app-worker
npx wrangler rollback
# or to a specific deployment:
npx wrangler rollback --deployment-id <id>
```

### 6.3 Roll back the entire split-hosting strategy (ADR-002 reversal)

If the split approach proves wrong:
1. Set `RENDER_API_KEY` + `RENDER_OWNER_ID` env vars on the platform
2. Clear `CLOUDFLARE_API_TOKEN` env var
3. `landing-deploy.service.ts` auto-switches to Render legacy path (feature of the dispatcher rewrite)
4. New deploys will go to Render. Existing CF-deployed founders stay on CF until redeployed.

This is intentionally non-destructive — both paths coexist in the code.

---

## 7. Cost and limits

Target envelope at v1.0:

| Resource | Free tier | Paid ($5/mo) | Projected at 100 founders |
|---|---|---|---|
| Worker requests | 100K/day | 10M/mo included, then $0.30/M | ~5M/mo (well within) |
| Worker CPU | 10ms/req | 50ms/req | ~2ms avg (Tier 1 is just R2 read) |
| R2 storage | 10 GB | 10 GB included | ~100 MB (100 × 1 MB landing) |
| R2 Class A ops | 1M/mo free | $4.50/M after | ~1K/mo (deploys) |
| R2 Class B ops | 10M/mo free | $0.36/M after | ~5M/mo (landing views) |

Projected monthly CF cost at 100 paying founders: **$5-10/mo**. At 1000 founders: **$20-50/mo**. See ADR-002 §Trade-off Analysis for the full cost curve.

---

## 8. Local development

### 8.1 Run the Worker locally
```bash
cd baljia-ai-cf/founder-app-worker
npm run dev      # wrangler dev --local with miniflare R2 simulation
```

**Known quirk:** Miniflare's local dev rewrites the `Host` header when wildcard routes are declared in `wrangler.toml`. This prevents straightforward `curl` end-to-end smokes from `localhost`. Use `npm run dev:remote` (hits real CF preview) or rely on the `test-parser.mjs` unit tests to validate routing logic.

### 8.2 Run the parse logic tests
```bash
cd baljia-ai-cf/founder-app-worker
node test-parser.mjs
# Expect: 25 passed, 0 failed
```

### 8.3 Dry-run deploy validation
```bash
cd baljia-ai-cf/founder-app-worker
npx wrangler deploy --dry-run --outdir=dist
# Validates: TypeScript compiles, wrangler.toml parsed, bundle < 10 MB, bindings resolved
```

---

## 9. On-call quick reference

| Symptom | First check | Common fix |
|---|---|---|
| 404 "Not ready yet" | R2 has no content for subdomain | Re-run deploy |
| 502 "Storage error" | CF Status page + Worker logs | Wait or redeploy Worker |
| Wrong content | `companies.subdomain` in DB + R2 key | Fix DB, redeploy |
| CF Worker 500 | `wrangler tail` for JS errors | Roll back Worker |
| DNS not resolving | CF DNS has `*` CNAME proxied | Re-add wildcard CNAME |
| Founder can't reach app | `curl -I https://{sub}.baljia.app` locally | Check whether their subdomain is the reserved list |

Escalate to architecture re-review if: a pattern of outages traces to CF edge issues and not app-level bugs; or cost crosses 2× projection; or Tier 3 custom-code deploys become frequent (triggers Shape 2 re-evaluation per ADR-002).

---

## 10. Appendix — files touched by the split-hosting work

All files below are on branch `cloudflare-spike`, folder `baljia-ai-cf/`. Main folder (`baljia-ai/`) is intentionally untouched.

**New files:**
- `docs/adr-002-split-hosting-strategy.md` — the decision doc
- `docs/cf-founder-app-runbook.md` — this file
- `src/lib/services/cf-deploy.service.ts` — CF API client (R2 + Workers Scripts + Routes + Secrets)
- `founder-app-worker/wrangler.toml`
- `founder-app-worker/package.json`
- `founder-app-worker/tsconfig.json`
- `founder-app-worker/src/index.ts` — the wildcard Worker
- `founder-app-worker/test-parser.mjs` — parseSubdomain unit tests

**Modified files:**
- `SPIKE-NOTES.md` — recorded ADR-002 decision
- `src/lib/services/landing-deploy.service.ts` — CF-first dispatcher, Render legacy fallback
- `src/lib/services/domain.service.ts` — added `provisionWildcardSubdomain`
- `src/lib/agents/tools/engineering.tools.ts` — added 3 CF tools alongside existing Render tools

**Parked (not merged, preserved for v1.5 full-CF migration):**
- `cf-workflow-poc/` — validated Workflows v2 POC with real Gemini
- `wrangler.toml` (root) — platform-on-CF wrangler config
- `open-next.config.ts` — OpenNext CF adapter config
- `next.config.ts` strict mode changes
