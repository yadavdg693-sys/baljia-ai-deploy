---
name: build-fullstack-cf-app
description: Use when a founder task requires deploying a full-stack app (API + DB + frontend) to Cloudflare Workers at {subdomain}.baljia.app. Covers the proven pattern: vanilla-JS Worker → Neon HTTP DB → cf_deploy_app. Choose this over cf_deploy_landing whenever the app needs dynamic logic, DB reads/writes, signup/login, or API endpoints.
---

# Build a full-stack app on Cloudflare Workers + Neon

This skill exists because the engineering agent's `cf_deploy_app` tool takes a **single ES-module string** as `script_content`. There is no bundler at the agent layer — the script you generate is the script that runs.

The proven, working pattern uses two pieces:
1. A **single-file Worker** with vanilla `fetch` + `URL.pathname` routing (no Hono, no bundler)
2. **Neon's HTTP `/sql` endpoint** for DB access — pure `fetch`, no `@neondatabase/serverless` import

This is the pattern that lets the agent ship a working app today via one tool call.

---

## When to use this skill

Use it when a founder task requires:
- API endpoints (`/api/users`, `/api/orders`, etc.) that read/write a DB
- Signup / login / sessions
- Customer-facing forms that persist to DB
- Multi-route SPAs with dynamic data

**Don't** use it for:
- Marketing-only landing pages (use `cf_deploy_landing` — Tier 1, R2-backed, simpler)
- Long-running customer ops (>30s of CPU per request — book generation, video transcode, multi-minute AI flows). Those need CF Queues / Workflows or a callback to the platform agent stack. See `### Long-running operations` below.

---

## The whole pattern in one Worker (proven working)

This exact shape was deployed end-to-end on `cffullstack.baljia.app` and verified: GET / returned HTML, GET /api/health hit Neon (290ms), POST /api/signup wrote a row, GET /api/users read it back. Use this as the canonical template — adapt route handlers, keep the structure.

```javascript
// Worker entrypoint — single ES module. No imports, no bundler.
// Bindings injected by cf_deploy_app:
//   env.NEON_URL          — Neon connection string (with_neon_db: true)
//   env.COMPANY_SUBDOMAIN — this founder's subdomain
//   env.PLATFORM_API_BASE — "https://baljia.ai" — for callbacks to platform
//   env.<KEY>             — anything passed via additional_secrets

const HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Sign up</title>
<style>body{font-family:system-ui;max-width:480px;margin:40px auto;padding:0 16px}</style></head>
<body>
<h1>Welcome</h1>
<form id="f"><input name="email" type="email" required placeholder="email">
<input name="name" required placeholder="name"><button>Sign up</button></form>
<div id="users"></div>
<script>
async function load(){const r=await fetch('/api/users');const d=await r.json();
document.getElementById('users').innerHTML=(d.users||[]).map(u=>'<div>'+u.email+' — '+u.name+'</div>').join('')}
document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();
const fd=new FormData(e.target);await fetch('/api/signup',{method:'POST',
headers:{'content-type':'application/json'},body:JSON.stringify({email:fd.get('email'),name:fd.get('name')})});
e.target.reset();load()});load();
</script></body></html>`;

// ── Neon HTTP /sql shim — replaces @neondatabase/serverless with raw fetch ──
// Wire format: POST {host}/sql with body {query, params}
// Auth: Neon-Connection-String header carries the full conn string.
async function neonQuery(connectionString, query, params = []) {
  const u = new URL(connectionString);
  // Strip ?... query like channel_binding=require — Neon HTTP rejects them
  const host = u.hostname;
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': connectionString,
      'Neon-Raw-Text-Output': 'false',
      'Neon-Array-Mode': 'false',
    },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) throw new Error(`Neon HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.rows ?? [];
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      // ── Frontend ──
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }

      // ── Health + DB connectivity ──
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const start = Date.now();
        const rows = await neonQuery(env.NEON_URL, 'SELECT NOW() as ts');
        return json({ ok: true, db_latency_ms: Date.now() - start, db_now: rows[0]?.ts });
      }

      // ── Signup (write) ──
      if (request.method === 'POST' && url.pathname === '/api/signup') {
        const body = await request.json();
        if (!body.email || !body.name) return json({ ok: false, error: 'email and name required' }, 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return json({ ok: false, error: 'invalid email' }, 400);
        const rows = await neonQuery(env.NEON_URL,
          `INSERT INTO users (email, name, created_at) VALUES ($1, $2, NOW())
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, email, name, created_at`,
          [body.email, body.name],
        );
        return json({ ok: true, user: rows[0] }, 201);
      }

      // ── List (read) ──
      if (request.method === 'GET' && url.pathname === '/api/users') {
        const users = await neonQuery(env.NEON_URL,
          'SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 50');
        return json({ ok: true, users, count: users.length });
      }

      return json({ ok: false, error: 'not found', path: url.pathname }, 404);
    } catch (err) {
      return json({ ok: false, error: err.message || String(err) }, 500);
    }
  },
};
```

---

## Required steps in order

The agent must do these in this order or the deploy fails:

### 1. Provision the DB
Call `provision_database`. Without this, `cf_deploy_app({ with_neon_db: true })` fails with "company has no provisioned Neon DB".

### 2. Create your tables
Use `query_company_db` to run `CREATE TABLE IF NOT EXISTS users (...)` against the just-provisioned DB. The Worker won't auto-create tables — your CREATE has to run before the first user signs up.

### 3. Generate the Worker source
Use the template above. **Required structure**: `export default { fetch(request, env, ctx) { ... } }`. The schema validator on `cf_deploy_app` will reject anything missing `export default {`.

### 4. Deploy
```
cf_deploy_app({
  script_content: <your full Worker source as a string>,
  with_neon_db: true,         // injects env.NEON_URL secret
  additional_secrets: {       // optional — Stripe, OpenAI, etc.
    "STRIPE_SECRET_KEY": "sk_..."
  }
})
```

### 5. Verify
Call `cf_verify_founder_app` immediately after — confirms the route propagated and the app responds 200. If it returns 404, the route hasn't taken effect yet (rare; CF route propagation is normally <2s).

### 6. Diagnose with `cf_get_logs`
If the app errors after deploy, call `cf_get_logs({ errors_only: true })`. Returns minute-bucketed counts grouped by HTTP status + outcome (ok / exception / exceededCpu / scriptThrew). This is your only window into per-founder Worker behavior — `console.log` from inside the Worker is not yet captured (would require Tail sessions).

---

## What's automatically wired

`cf_deploy_app` injects these as bindings without you specifying them:
- `env.PLATFORM_API_BASE` = `"https://baljia.ai"`
- `env.COMPANY_ID` = the founder's company UUID
- `env.COMPANY_SUBDOMAIN` = the subdomain (e.g. `"acme"`)

If you pass `with_r2_assets: true`, `env.ASSETS` becomes an R2 bucket binding. Use `await env.ASSETS.get(key)` to read static files.

If you pass `with_neon_db: true`, `env.NEON_URL` is set to the company's Neon connection string. The Worker can query it via the `neonQuery` shim above.

`additional_secrets` lets you inject any extra per-founder secrets (Stripe keys, third-party API keys). Each becomes `env.<NAME>`. Values are masked in CF logs.

---

## Common pitfalls

**1. Forgetting the `export default { fetch }` shape.**
The schema validator regex-checks for `export default {`. If your code is `addEventListener('fetch', ...)` (the legacy service-worker syntax) it'll deploy but fail at runtime — Workers in module mode require the ES-module export.

**2. Using `@neondatabase/serverless` imports.**
You can't. The agent has no bundler. Use the `neonQuery` fetch shim shown above. If you have an existing complex query layer, port it to `neonQuery`-style calls.

**3. Not creating tables before deploy.**
The Worker won't run schema migrations. Use `query_company_db` to `CREATE TABLE IF NOT EXISTS` before deploy. Idempotent — re-running the deploy task won't re-create.

**4. Storing secrets in `script_content`.**
Never inline API keys, DB URLs, or tokens into the source. Always use `with_neon_db` or `additional_secrets`. Source is visible to anyone with CF account access.

**5. Long synchronous handlers.**
A single Worker request has a 30s CPU cap (Workers Paid). If you call an LLM that takes 60s, the request dies. Keep request handlers sub-30s; for longer work see the next section.

**6. Trying to use Node-only APIs.**
The Worker runtime is V8, not Node. `fs`, `path`, `child_process` don't exist. `Buffer` works (compatibility flag is on). Most string/JSON/fetch code runs unchanged. Test against the actual deployed Worker, not local Node.

---

## Long-running operations (the real architectural gap)

If a customer request needs >30s of compute (book generation, video transcode, multi-minute AI flow), the Worker pattern above won't work directly. Three options today:

### Option 1: Async + polling, callback to platform (recommended)
Worker accepts the request, enqueues a task on the platform via `fetch(env.PLATFORM_API_BASE + '/api/founder/{slug}/job', ...)`, returns 202 + job_id. Customer polls `/api/jobs/{id}` on the same Worker, which queries platform for status. Platform's agent runtime does the heavy work.

### Option 2: CF Queues + consumer Worker (not yet wired into cf_deploy_app)
`cf_deploy_app` doesn't currently bind a Queue. To use this path you'd need a Queue created via CF API and a consumer Worker also deployed. Treat as a future enhancement; don't generate code expecting `env.MY_QUEUE` until the binding tool exists.

### Option 3: CF Workflows for durable execution (not yet wired)
Same status as Queues. Documented as future architecture in ADR-002 but not currently bindable through `cf_deploy_app`.

For now: **default to Option 1**. Sub-30s requests on the Worker, hand long jobs back to the platform.

---

## Verification — you proved it works, prove it again per founder

After every `cf_deploy_app`, do:
1. `cf_verify_founder_app` — must return 200 with the expected body snippet
2. `cf_get_logs({ errors_only: true, since_minutes: 5 })` — must show zero error buckets

If either fails, treat the deploy as broken even if `cf_deploy_app` returned success. The founder's customers see the live URL — that's the only ground truth.

---

## When to ask for the bundler tool

If a founder task genuinely needs a complex JS framework (Hono, React SSR, Drizzle ORM, etc.) that can't be reasonably hand-rolled into a single file, the right next move is:
1. Stop trying to fit it into `script_content`
2. File this as a platform request: "we need a `bundle_and_deploy_app` tool that runs esbuild server-side"
3. Until then, the vanilla pattern above covers ~80% of full-stack founder apps

The proof of esbuild-bundled deploys working is in `src/scripts/test-cf-fullstack.ts` — that's the platform-side reference for how the future bundler tool would work.
