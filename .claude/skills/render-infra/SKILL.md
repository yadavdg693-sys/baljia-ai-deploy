# Skill: Render Infrastructure Requirements

**READ THIS BEFORE deploying any app to Render.**

Every app the Engineering Agent deploys runs on Render. This skill documents the non-negotiable requirements, patterns, and pitfalls specific to Render's platform.

---

## MANDATORY: Health check endpoint

Every Render web service MUST expose `GET /health` returning HTTP 200. Render uses this to decide if the deploy succeeded. Without it, deploys appear to succeed but Render marks the service unhealthy and stops routing traffic.

### Express / Node.js
```javascript
// Add this BEFORE your routes, as early as possible
app.get('/health', (req, res) => res.status(200).json({ ok: true }));
```

### Next.js App Router
```typescript
// app/api/health/route.ts
export async function GET() {
  return Response.json({ ok: true });
}
```

### Verification
After deploy, always call `check_url_health` on `https://<service>.onrender.com/health`.
If it returns anything other than 200, the deploy is broken even if `render_get_deploy_status` says "live".

---

## Port binding

Render injects `PORT` as an environment variable. Your app MUST listen on `process.env.PORT`.

```javascript
// ✅ Correct
const port = process.env.PORT || 3000;
app.listen(port);

// ❌ Wrong — hardcoded port will fail on Render
app.listen(3000);
```

Next.js skeleton apps must bind explicitly in the Render start command:
`pnpm exec next start -H 0.0.0.0 -p $PORT`.

---

## Build and start commands

For Next.js on Render, bind explicitly to Render's injected port:
`pnpm exec next start -H 0.0.0.0 -p $PORT`.

For Next.js skeleton services, use Render `healthCheckPath: /` unless the app explicitly creates `/api/health`.

| Framework | buildCommand | startCommand | healthCheckPath |
|---|---|---|---|
| Express / Node.js | `npm install && npm run build` | `npm start` | `/api/health` |
| Next.js 15 (skeleton) | `pnpm install --no-frozen-lockfile --prod=false && pnpm build` | `pnpm exec next start -H 0.0.0.0 -p $PORT` | `/` |
| Next.js 15 (schema already migrated) | `pnpm install --no-frozen-lockfile --prod=false && pnpm build` | `pnpm exec next start -H 0.0.0.0 -p $PORT` | `/` |
| Static HTML | `echo done` | *(not needed for static_site type)* | `/` |

**Always use `pnpm` for skeleton apps.** Express apps can use `npm`.

---

## Ephemeral filesystem — CRITICAL

Render's filesystem is **ephemeral**. Everything written to disk is lost on restart or redeploy.

**Never use local disk for:**
- User-uploaded files → use R2 (see `r2-storage` skill)
- Generated PDFs, images, exports → upload to R2 immediately after generation
- SQLite databases → use Neon Postgres (see `neon-postgres` skill)
- Session storage → use Postgres session store (connect-pg-simple) or Better Auth DB sessions
- Logs → use structured logging to stdout (Render captures it)
- Temp files → write to `/tmp` only if you delete them in the same request

```javascript
// ✅ OK — /tmp is writable but ephemeral within a single request
const tmpPath = `/tmp/${Date.now()}-output.pdf`;
await generatePDF(tmpPath);
const buffer = fs.readFileSync(tmpPath);
await uploadToR2(buffer);          // persist immediately
fs.unlinkSync(tmpPath);            // clean up
```

---

## Environment variables

Set these in `render_create_service` via `env_vars`. Never hardcode secrets.

### Required for every app
```
NODE_ENV=production
PORT=(Render sets this automatically, do not set it yourself)
```

### Required for database
```
DATABASE_URL=<from provision_database / get_database_info>
```

### Required for skeleton (Next.js)
```
DATABASE_URL          → from provision_database
BETTER_AUTH_SECRET    → openssl rand -base64 32
BETTER_AUTH_URL       → https://<slug>.onrender.com
NEXT_PUBLIC_APP_URL   → https://<slug>.onrender.com
AI_GATEWAY_URL        → https://generativelanguage.googleapis.com/v1beta/openai
AI_GATEWAY_TOKEN      → platform Gemini key
AI_TEXT_MODEL         → gemini-2.5-flash
AI_JSON_MODEL         → gemini-2.5-flash
AI_EMBEDDING_MODEL    → gemini-embedding-001
AI_EMBEDDING_DIMENSIONS → 3072
```

### Required for Express + session auth
```
DATABASE_URL          → from provision_database
SESSION_SECRET        → node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Free plan limitations

| Limit | Value | Implication |
|---|---|---|
| Sleep after inactivity | 15 minutes | First request after sleep takes 30-60s |
| Monthly hours | 750 hrs/month | One service can run all month |
| RAM | 512 MB | Keep Node.js heap under 400 MB |
| CPU | 0.1 vCPU | No CPU-intensive tasks (use background jobs) |
| Disk | Ephemeral | See section above |

**For background jobs or cron tasks:** Create a separate Render web service that self-schedules using `node-cron`. Background workers on the free plan are not supported.

---

## Auto-deploy from GitHub

Render watches the `main` branch. Every push to `main` triggers a redeploy automatically. The agent does NOT need to call `render_deploy` manually after every `github_push_file` — Render handles it.

Exception: call `render_deploy` explicitly only if you need to force a redeploy without a code change (e.g., env var update only).

---

## Logging

Render captures all stdout/stderr. Use structured logging:

```javascript
// Express apps — use console.log with JSON
console.log(JSON.stringify({ level: 'info', msg: 'Server started', port }));

// Skeleton apps — logger is already wired via createLogger()
import { createLogger } from '@/lib/logger';
const log = createLogger('MyFeature');
log.info('Something happened', { userId, action });
```

Access logs via `render_get_logs`. For deploy logs use `log_type: 'deploy'`.

---

## Common deploy failures and fixes

| Symptom | Cause | Fix |
|---|---|---|
| Deploy succeeds but site returns 502 | Missing `/health` route | Add `GET /health` returning 200 |
| `npm install` fails | Wrong Node version | Add `"engines": { "node": ">=20" }` to package.json |
| `pnpm` not found | Wrong build command | Use `npm install -g pnpm && pnpm install` or switch to npm |
| App crashes on start | Hardcoded port 3000 | Use `process.env.PORT` |
| File not found after redeploy | Wrote to local disk | Move files to R2 |
| DB connection refused | Missing `ssl: { rejectUnauthorized: false }` | Add SSL option to pg Pool config |
| Sessions lost on restart | In-memory sessions | Use connect-pg-simple or Better Auth |

---

## Verification checklist

A deploy is done when ALL pass:

1. `render_get_deploy_status` → status is `live`
2. `check_url_health` on `/health` → HTTP 200
3. `check_url_health` on `/` (homepage) → HTTP 200 or 301
4. `check_url_health` on the main feature route → HTTP 200
5. Task report includes: service ID, live URL, env vars set (no secret values)
