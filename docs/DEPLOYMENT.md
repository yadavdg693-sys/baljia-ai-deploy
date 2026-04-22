# Baljia Platform Deployment Guide

One-time setup to make `baljia.ai` (platform) and `*.baljia.app` (founder landing pages) reachable on the public internet.

## What already works in code

- ✅ `render.yaml` — full blueprint: web service + 6 cron jobs + env var declarations
- ✅ `src/middleware.ts` — subdomain routing: `{slug}.baljia.app` → looks up `companies.slug` → serves `documents.landing_page`
- ✅ Platform domain (`baljia.ai`) serves the dashboard + app
- ✅ Per-company subdomain (`{slug}.baljia.app`) serves founder landing pages from DB
- ✅ DKIM/SPF/Return-Path for `baljia.app` email (done earlier)

**What's missing is pure ops: deploy to Render + configure Cloudflare DNS.**

---

## Step 1: Deploy to Render

### 1a. Connect the repo

1. Log in at https://dashboard.render.com
2. New → Blueprint → connect GitHub org `yadavdg693-sys` → select `Balaji` repo
3. Render reads `render.yaml` and proposes: 1 web service (`baljia-ai`) + 6 cron jobs
4. Accept the blueprint

### 1b. Set the secret env vars

Render shows a form for all `sync: false` env vars. Fill from your `.env.local`:

| Env var | Source |
|---|---|
| `DATABASE_URL` | Neon platform DB (your main Baljia DB, not per-company) |
| `AUTH_SECRET` | 32-byte random string (generate: `openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console OAuth app |
| `GOOGLE_CLIENT_SECRET` | Same |
| `ANTHROPIC_API_KEY` | From Anthropic Console |
| `POSTMARK_SERVER_TOKEN` | From Postmark server |
| `NEXT_PUBLIC_APP_URL` | `https://baljia.ai` (after DNS is pointed) |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | From Stripe dashboard |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | From Upstash console |
| `TAVILY_API_KEY` | From Tavily |
| `CRON_SECRET` | Any long random string (used by cron jobs to auth against the platform) |
| `ADMIN_EMAILS` | Comma-separated emails that get admin access |
| `NEON_API_KEY` | From Neon account settings |
| `RENDER_API_KEY` | From Render account settings (used by engineering agent to create founder Render services) |
| `GITHUB_TOKEN` | Fine-grained PAT with `Administration: R/W` + `Contents: R/W` on `BALAJIapps` org |
| `ENCRYPTION_KEY` | 32-byte random string (AES key, separate from AUTH_SECRET) |
| `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` | From Browserbase (browser agent) |

Plus the new additions:
| Env var | Value |
|---|---|
| `GITHUB_ORG` | `BALAJIapps` (already set in render.yaml as a non-secret) |
| `IPINFO_TOKEN` | From ipinfo.io (GeoIP enrichment) |
| `LATEDEV_API_KEY` | From late.dev (launch tweets) — optional; skip until signed up |

### 1c. Deploy

Render auto-deploys on first blueprint creation. Watch the build log. First build takes ~4-6 min (`npm install && npm run build`).

When green: your app is live at `https://baljia-ai-xxxx.onrender.com` (Render assigns a subdomain).

### 1d. Note the Render hostname

From the web service's dashboard, copy the onrender.com hostname — you'll need it for DNS.

---

## Step 2: Configure Cloudflare DNS

Assumes both `baljia.ai` and `baljia.app` zones exist in Cloudflare (since DKIM/SPF for `baljia.app` is already set up there).

### 2a. Platform domain: `baljia.ai`

Add these records in the `baljia.ai` zone:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` (apex) | `baljia-ai-xxxx.onrender.com` | Proxied (orange cloud) |
| CNAME | `www` | `baljia.ai` | Proxied |

*(If Cloudflare rejects CNAME at apex, use their "CNAME flattening" feature or convert to A records pointing at Render's IPs — ask Render support for current IPs.)*

### 2b. Company landing domain: `baljia.app`

Add these records in the `baljia.app` zone:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` (apex) | `baljia-ai-xxxx.onrender.com` | Proxied |
| CNAME | `*` (wildcard) | `baljia-ai-xxxx.onrender.com` | Proxied |

**The `*` wildcard record is critical** — it makes `amendly.baljia.app`, `markmeld.baljia.app`, and every future founder subdomain resolve to the Render app. The Next.js middleware then looks up the slug and serves the right landing page.

### 2c. Add custom domains in Render

Render service → Settings → Custom Domains → add:
- `baljia.ai`
- `www.baljia.ai`
- `baljia.app`
- `*.baljia.app`

Render issues Let's Encrypt certs for each. Wildcard cert requires DNS-01 challenge; Render will tell you if you need to add an `_acme-challenge` TXT record temporarily.

---

## Step 3: Verify

After DNS propagation (5-30 min):

```bash
# Platform
curl -I https://baljia.ai/
# Expect: 200, HTML

# Specific founder landing page (replace with a real completed onboarding slug)
curl -I https://amendly.baljia.app/
# Expect: 200, HTML of the generated landing page

# Health check
curl https://baljia.ai/api/health
# Expect: 200, {"status":"ok"}
```

---

## What this unblocks

- `{slug}.baljia.app` resolves for every completed onboarding → founder shares real URL with the world
- Engineering agent's Render-created services work (their subdomains are platform-managed or Render-managed, not blocked by DNS)
- Cron jobs hit `$NEXT_PUBLIC_APP_URL` routes successfully
- Stripe webhooks can reach `$NEXT_PUBLIC_APP_URL/api/webhooks/stripe`
- Postmark webhooks can reach inbound email route

## Cost

- Render Starter (web service): **$7/mo** for the platform
- Render cron jobs: **$1/mo each × 6 = $6/mo**
- Cloudflare DNS: **$0** (free plan)
- Neon platform DB: likely **$0** on free tier until scale

**Total deployment baseline: ~$13/mo.**

## After deployment

- Every onboarding's `{slug}.baljia.app` will actually resolve
- Engineering agent firing on a founder company produces a real deployed product
- Ready to fire the MVP value-path smoke test against a real URL
