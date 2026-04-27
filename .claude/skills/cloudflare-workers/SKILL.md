# Skill: Cloudflare Workers (founder-app deploy target)

**READ THIS BEFORE writing or modifying any deploy script for a founder app.**
Founder apps run ONLY on Cloudflare Workers + R2 + Neon. Not Render. Not Vercel. Not AWS Lambda.

## Runtime constraints — your code must fit

| Constraint | Limit | Implication |
|---|---|---|
| CPU per request | 30s (free) / 5min (paid) | No long-running jobs in HTTP handler. For >30s work, use Cron Triggers OR Durable Objects (different deploy path) |
| Memory | 128 MB | Don't load large in-memory state. No giant LLM context buffers. |
| Bundle size | 10 MB gzipped | Tree-shake aggressively. No `node_modules` shipped raw. |
| nodejs_compat | enabled | `Buffer`, `crypto`, `stream`, `process`, `async_hooks` work |
| Subrequests | 50 per request (free) / 1000 (paid) | Each fetch / DB query / API call counts |

## Code shape — non-negotiable

The `script_content` you pass to `cf_deploy_app` must:

1. Be a **single ES-module string** — all imports inlined or bundled (the platform doesn't bundle for you)
2. Export `default { fetch(request, env, ctx) { ... } }`
3. Read bindings via `env.NEON_URL`, `env.ASSETS`, `env.COMPANY_ID`, `env.COMPANY_SUBDOMAIN`, `env.PLATFORM_API_BASE`, plus any `additional_secrets` you passed

**Minimal working Worker:**

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, company: env.COMPANY_SUBDOMAIN });
    }

    return new Response('<!DOCTYPE html><html><body><h1>Hello</h1></body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
```

## Use Hono — it's the right framework for Workers

```js
// imports must be inlined OR bundled into script_content. If you can't bundle,
// write fetch handlers directly per the minimal example above.
import { Hono } from 'hono';

const app = new Hono();
app.get('/', (c) => c.html('<h1>Home</h1>'));
app.get('/api/users/:id', async (c) => {
  const id = c.req.param('id');
  // env is available via c.env
  return c.json({ id });
});

export default app; // Hono's app exposes default { fetch } shape
```

Alternatives (smaller surface):
- `itty-router` — tiny (<1 KB)
- Raw `fetch(request, env, ctx)` — when you have <10 routes

## Frameworks that DO NOT work — never reach for these

| Framework | Why it breaks Workers | What to use instead |
|---|---|---|
| Express, Koa, Fastify, Nest.js, Hapi | Need `http.createServer().listen(port)`. Workers have no port binding. | **Hono** (Workers-native, same mental model) |
| `pg` (TCP) | Workers has no raw TCP. Even with nodejs_compat the connect() succeeds but throws on first query. | `@neondatabase/serverless` (HTTP driver). See `neon-postgres` skill. |
| `ioredis` (TCP) | Same TCP problem | `@upstash/redis` (REST) or skip Redis (most Worker apps don't need it) |
| `mongoose` | No MongoDB TCP driver on Workers | If you really need Mongo, use a REST API wrapper. Better: use Neon. |
| `puppeteer` / `playwright` | Browser binaries can't run in 128 MB | If a task needs a real browser, hand off to the Browser agent (#42) — don't try to run it inside the Worker |
| `nodemailer` (SMTP) | TCP again | `fetch` to Postmark / Resend / SendGrid REST APIs |

## Bindings you get for free (always set on env)

```js
env.COMPANY_ID         // UUID — pass through to /api/* on the platform
env.COMPANY_SUBDOMAIN  // slug — for self-referencing URLs
env.PLATFORM_API_BASE  // https://baljia.ai — call back to the platform
```

Conditional (only if you opted in via `cf_deploy_app` args):
```js
env.NEON_URL           // when with_neon_db: true
env.ASSETS             // R2 binding when with_r2_assets: true
env.<CUSTOM>           // any additional_secrets you passed
```

## Deploy + verify loop — the only "done"

```
1. cf_deploy_app({ slug, script_content, with_neon_db, with_r2_assets, additional_secrets })
2. cf_verify_founder_app({ slug })   ← REQUIRED. Don't skip.
3. If verify fails → cf_get_logs to read the error → fix → redeploy
4. Write a verify script (in your task report) that exercises the actual feature
   via fetch() against the deployed URL — not just "page loads"
```

A task is **NOT done** if:
- You called `cf_deploy_app` and assumed it worked
- The page returns 200 but renders blank
- The feature you built has no test that hits it

## Common pitfalls

- **Forgetting Response headers** — Workers is strict; `new Response('<html>...')` without `content-type` will be served as `text/plain` and the browser shows raw HTML.
- **Using `process.env` for secrets at module top-level** — won't work. Read from `env` inside the handler.
- **CORS on cross-origin fetches** — set `Access-Control-Allow-Origin` if the deployed app is being called from another domain.
- **Build size blow-up from importing the wrong package** — `axios` ships ~150 KB; use `fetch` (built-in, 0 KB).
- **`async_hooks` for context propagation** — works (nodejs_compat) but slow. Prefer explicit `c.set('user', ...)` in Hono middleware.

## When to read which skill alongside this one

- Writing DB code → also read `neon-postgres`
- Building UI / page HTML → also read `frontend-design`
- Adding payments → also read `stripe-payments`
- Storing files → also read `r2-storage`
- Sending email → also read `email-postmark`
