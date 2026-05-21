# __SLUG__

Founder app for **__APP_NAME__**, deployed by Baljia AI's Engineering Agent.

This repository was forked from the Baljia hardened Express skeleton. The framework patterns (boot-time config validation, trust-proxy, Postgres-backed sessions, structured logging, integration health probes, discriminated-union responses, bounded-timeout external calls, and the test scaffold) are pre-wired and intentionally not customized per founder. The Engineering Agent customizes only:

- Hero copy + landing HTML in `landingPage()` of `server.js`
- Feature-specific routes (replacing the placeholder `/api/items` CRUD)
- Feature-specific tables in `db/schema.sql` (additions, not modifications to the framework tables)
- Dashboard rendering in `dashboardPage()`

## Required environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. Must include `?sslmode=require`. |
| `SESSION_SECRET` | Random ≥32 char string. Used to sign session cookies. Rotate to invalidate all sessions. |
| `NODE_ENV` | `production` on Render, `development` locally. Controls `cookie.secure`. |
| `PORT` | Set to `10000` on Render. |
| `STRIPE_API_KEY` | Optional. If set, `/api/health` will probe Stripe. |
| `STRIPE_LINK` | Optional. The payment-link URL shown on `/pricing`. |

The app validates all required variables with Zod at startup. If any are missing or malformed, the process exits with a per-field error before binding to the port — you will not see "deployed successfully" while the app is silently broken.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | none | Landing page (CUSTOMIZE the copy) |
| `GET` | `/register` | none | Registration form |
| `POST` | `/auth/register` | none | Creates user, sets session, redirects `/dashboard` |
| `GET` | `/login` | none | Login form |
| `POST` | `/auth/login` | none | Verifies password, sets session, redirects `/dashboard` |
| `POST` | `/auth/logout` | required | Destroys session, redirects `/` |
| `GET` | `/dashboard` | required | Per-user dashboard (CUSTOMIZE) |
| `POST` | `/api/items` | required | Create a feature record (CUSTOMIZE — rename `items`) |
| `DELETE` | `/api/items/:id` | required | Delete a feature record |
| `GET` | `/pricing` | none | Stripe payment-link button (CUSTOMIZE — delete this route AND the landing CTA if your app has no monetization) |
| `GET` | `/api/events` | required | Server-Sent Events stream for real-time updates. Subscribe with `new EventSource('/api/events')`. Server emits typed events via the `publishEvent(userId, type, payload)` helper. Heartbeat every 25s prevents Render's proxy from dropping the connection. |
| `GET` | `/api/health` | none | Returns 200 with per-dependency check breakdown when all OK; 503 + breakdown when any are degraded |

## Running locally

```bash
npm install
psql "$DATABASE_URL" -f db/schema.sql
SESSION_SECRET=$(openssl rand -hex 32) DATABASE_URL=... npm run dev
```

## Tests

```bash
npm test            # one-shot
npm run test:watch  # rerun on change
```

The test suite covers:

- **`tests/config.test.js`** — Zod schema rejects missing required env vars and malformed values. These tests exist so a regression where a teammate removes `DATABASE_URL` from the schema fails CI rather than failing in production.
- **`tests/auth.test.js`** — register / login / logout flow, including session persistence across requests (the test that catches the trust-proxy bug class).
- **`tests/health.test.js`** — `/api/health` shape: per-check breakdown, conditional 200/503 status code.

If `DATABASE_URL` and `SESSION_SECRET` aren't set in the test env, the auth and health suites skip gracefully.

## Deploying

Render auto-deploys on push to `main`. To force a redeploy via API:

```bash
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys \
  -d '{"clearCache": "do_not_clear"}'
```

After every deploy, the Baljia Engineering Agent runs `verify_user_journey` against the live URL and `verify_db_state` against the Neon DB. The deploy is only marked complete when those return `JOURNEY PASS` and `DB STATE PASS` respectively. If you push a change manually, run the same checks before considering it shipped.

## Design constraints (do not deviate)

These are framework rules — the Engineering Agent treats them as P0 in the Backend Quality Bar:

1. Every `process.env.X` access must go through the validated `config` object.
2. Every external call (DB, Stripe, fetch) must be wrapped in `withTimeout(..., ms, label)`.
3. `/api/health` must probe every integration in use, not just `SELECT 1`.
4. Sessions must use the Postgres-backed `connect-pg-simple` store. `MemoryStore` is forbidden.
5. `app.set('trust proxy', 1)` must run before the session middleware.
6. Handlers that talk to a service return discriminated unions — `ok(data)` or `fail(code, message)`. No `{ data: thing }` / `{ error: 'x' }` mixed shapes.
7. No `catch (err) { return false }` or empty catch blocks. Every catch logs the error structurally.
8. No secrets in source, query strings, or logs. The pino redaction list covers the standard set.
9. Tests must accompany features. Failure-mode tests are mandatory for any handler that talks to an external service.

## Real-time updates (Server-Sent Events)

The skeleton ships with `/api/events` — a per-user SSE stream that works on Render's free tier without a WebSocket plan upgrade. Use it for any "the page should update without polling" requirement: live progress bars, new-item notifications, build-status streams.

Server side, after a state change you care about:

```js
publishEvent(req.session.userId, 'item_created', rows[0]);
```

Client side, in a page rendered to an authenticated user:

```html
<script>
  const es = new EventSource('/api/events');
  es.addEventListener('item_created', (e) => {
    const item = JSON.parse(e.data);
    // re-render the list, append a row, etc.
  });
  es.addEventListener('ready', () => console.log('SSE connected'));
</script>
```

Notes:
- The skeleton's subscriber map is in-process; for multi-instance deployments swap to Postgres `LISTEN/NOTIFY` or Redis pub/sub.
- A 25s heartbeat keeps Render's proxy from dropping the connection (it idle-times out at ~30s).
- SSE keeps the connection open, which prevents Render's free-tier sleep — count this against your 750 free hours/month.
- If your app doesn't need real-time, delete the `/api/events` route and the `publishEvent` calls. CSP allows `connect-src 'self'`, so SSE works without policy changes.
