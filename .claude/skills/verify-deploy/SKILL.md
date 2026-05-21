# verify-deploy

**Read this skill after every deployment.** This is the systematic QA checklist
the Engineering Agent runs to confirm a newly built or updated app is fully
functional — frontend, backend, auth, database, and integrations.

Use `check_url_health` for each URL below. Use `query_company_db` to verify
DB state. Use `render_get_logs` if anything fails.

---

## The Verification Sequence

Run these checks in order. If any step fails, stop and fix before moving on.

---

### Step 1 — Render Service is Live

```
Tool: check_url_health
URL:  https://<app-slug>.onrender.com/health
```

**Expected:** `{ "status": "ok" }` with HTTP 200.

**If 404:** The `/health` route is missing — add it to `app/api/health/route.ts`.
**If 502:** App crashed at startup — run `render_get_logs` and check for:
  - `Cannot find module` → missing `pnpm install` or bad import
  - `Invalid environment variables` → required env var not set in Render
  - `ECONNREFUSED` on DB → `DATABASE_URL` not set or Neon project not provisioned
**If still deploying:** Wait 2 minutes, then retry.

---

### Step 2 — Frontend Loads

```
Tool: check_url_health
URL:  https://<app-slug>.onrender.com/
```

**Expected:** HTTP 200 with HTML body (not a JSON error).

```
Tool: check_url_health
URL:  https://<app-slug>.onrender.com/sign-in
```

**Expected:** HTTP 200. Sign-in page renders.

**If 500:** Next.js build error. Run `render_get_logs` with `log_type: deploy`.

---

### Step 3 — Auth Routes Work

```
Tool: check_url_health
URL:  https://<app-slug>.onrender.com/api/auth/get-session
```

**Expected:** HTTP 200, body `{ "session": null }` (not logged in yet — that's fine).

**If 500:** Better Auth is misconfigured. Check:
  - `BETTER_AUTH_SECRET` is set in Render env vars (min 32 chars)
  - `BETTER_AUTH_URL` matches the actual deploy URL exactly
  - `DATABASE_URL` is valid and schema has been pushed (run `run_drizzle_push`)

---

### Step 4 — Database Schema is Correct

```
Tool: query_company_db
SQL:  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
```

**Expected tables** (from the Balaji skeleton):
- `user`
- `session`
- `account`
- `verification`
- `subscription` *(if Stripe is wired)*
- Any app-specific tables you added

**If tables are missing:** Run `run_drizzle_push` to sync the schema.

---

### Step 5 — AI Gateway (if used)

```
Tool: check_url_health
URL:  https://<app-slug>.onrender.com/api/chat    (or wherever the AI route is)
Method note: just checking it returns 405 Method Not Allowed on GET is fine
             — it means the route exists but needs POST
```

**Expected:** HTTP 200 or 405 (route exists). 404 = route not created yet.

If the app uses `lib/ai.ts` from the skeleton, verify these env vars are set in Render:
- `AI_GATEWAY_URL`
- `AI_GATEWAY_TOKEN`

---

### Step 6 — Stripe (if used)

```
Tool: check_url_health
URL:  https://<app-slug>.onrender.com/api/webhooks/stripe
```

**Expected:** HTTP 400 with body `{ "error": "Invalid signature" }`.
This is correct — it means the endpoint exists but (rightly) rejected the unsigned GET request.

**If 404:** Webhook route missing.
**If 200:** ⚠️ Signature verification is broken — fix immediately.

Check Render env vars:
- `STRIPE_SECRET_KEY` — starts with `sk_`
- `STRIPE_WEBHOOK_SECRET` — starts with `whsec_`

---

### Step 7 — Email (if used)

No automated check possible. Verify manually:
- `POSTMARK_API_TOKEN` is set in Render env vars
- Trigger a test email via the app's sign-up flow

---

### Step 8 — Final Log Scan

```
Tool: render_get_logs
log_type: service
```

Scan for:
- Any `Error:` lines at startup
- `UnhandledPromiseRejection` — means a missing `.catch()` somewhere
- `Cannot read properties of undefined` — null-safety bug
- `connect ECONNREFUSED` — DB or external service unreachable

**If logs are clean and all 6 URL checks pass → deployment is verified. ✅**

---

## Quick Reference: What Each Failure Means

| Symptom | Likely Cause | Fix |
|---|---|---|
| `/health` → 502 | App crashed at start | Check logs for startup error |
| `/health` → 404 | No health route | Add `app/api/health/route.ts` |
| `/api/auth/get-session` → 500 | Bad `BETTER_AUTH_SECRET` | Check env vars |
| DB tables missing | Schema not pushed | Run `run_drizzle_push` |
| Stripe webhook → 200 on GET | Signature check missing | Fix webhook handler |
| AI route → 404 | Route not created | Create the API route |
| All routes → 503 | Render free plan sleeping | Wait 30s and retry |

---

## Verification Report Template

After completing all steps, report to the user:

```
✅ Deployment Verified — <app-name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Live URL:      https://<slug>.onrender.com
🏥 Health:        ✅ 200 OK
🖥️  Frontend:     ✅ Loads
🔐 Auth:          ✅ /api/auth/get-session returns 200
🗄️  Database:     ✅ X tables present
💳 Stripe:        ✅ Webhook returns 400 (signature check active)
🤖 AI Gateway:    ✅ Route exists
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ready for founder use.
```

If any check failed, replace ✅ with ❌ and describe the error.
