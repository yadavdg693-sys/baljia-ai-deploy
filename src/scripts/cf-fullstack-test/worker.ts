// Test full-stack Cloudflare Worker — proves end-to-end CF + Neon pattern.
// Routes: GET / (HTML frontend), GET /api/health, POST /api/signup, GET /api/users
// Bundled by esbuild into a single ES module and uploaded via deployWorkerScript.

import { neon } from '@neondatabase/serverless';

interface Env {
  NEON_URL: string;
  COMPANY_SUBDOMAIN: string;
  PLATFORM_API_BASE: string;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>CF Fullstack Test — Baljia</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 16px; color: #1E1A16; background: #FCFBF8; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #5C5147; font-size: 13px; margin-bottom: 24px; }
  form { display: grid; gap: 8px; padding: 16px; border: 1px solid #DED6CA; border-radius: 8px; background: #FFFDF9; }
  input, button { padding: 8px 12px; font-size: 14px; border-radius: 6px; }
  input { border: 1px solid #DED6CA; }
  button { background: linear-gradient(135deg, #E1B12C, #D97706); color: white; border: none; cursor: pointer; font-weight: 600; }
  pre { background: #F4F2EC; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; }
  .users { margin-top: 16px; }
  .user { padding: 8px 12px; border-bottom: 1px solid #EAE5DD; font-size: 13px; }
</style>
</head>
<body>
<h1>CF Full-Stack Test</h1>
<p class="sub">Worker on cffullstack.baljia.app · Neon DB · Vanilla JS frontend</p>

<form id="f">
  <input name="email" type="email" placeholder="email" required>
  <input name="name" type="text" placeholder="name" required>
  <button type="submit">Sign up</button>
</form>

<div class="users" id="users">Loading users…</div>

<h3>Health</h3>
<pre id="health">…</pre>

<script>
async function loadHealth() {
  const r = await fetch('/api/health'); document.getElementById('health').textContent = JSON.stringify(await r.json(), null, 2);
}
async function loadUsers() {
  const r = await fetch('/api/users'); const d = await r.json();
  const el = document.getElementById('users');
  if (!d.users || d.users.length === 0) { el.innerHTML = '<div class="user">No users yet.</div>'; return; }
  el.innerHTML = d.users.map(u => '<div class="user">' + u.email + ' — ' + u.name + '</div>').join('');
}
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const r = await fetch('/api/signup', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ email: fd.get('email'), name: fd.get('name') }) });
  const d = await r.json();
  if (d.ok) { e.target.reset(); loadUsers(); } else alert(d.error || 'failed');
});
loadHealth(); loadUsers();
</script>
</body>
</html>`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sql = neon(env.NEON_URL);

    try {
      // ── GET / — HTML frontend ──
      if (request.method === 'GET' && url.pathname === '/') {
        return new Response(HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }

      // ── GET /api/health — DB connectivity probe ──
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const start = Date.now();
        const rows = await sql`SELECT 1 as ok, NOW() as ts`;
        return json({
          ok: true,
          subdomain: env.COMPANY_SUBDOMAIN,
          db_latency_ms: Date.now() - start,
          db_now: rows[0]?.ts,
          worker_now: new Date().toISOString(),
        });
      }

      // ── POST /api/signup — INSERT a row ──
      if (request.method === 'POST' && url.pathname === '/api/signup') {
        const body = await request.json() as { email?: string; name?: string };
        if (!body.email || !body.name) return json({ ok: false, error: 'email and name required' }, 400);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return json({ ok: false, error: 'invalid email' }, 400);
        const inserted = await sql`
          INSERT INTO cftest_users (email, name, created_at)
          VALUES (${body.email}, ${body.name}, NOW())
          ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
          RETURNING id, email, name, created_at
        `;
        return json({ ok: true, user: inserted[0] }, 201);
      }

      // ── GET /api/users — SELECT all ──
      if (request.method === 'GET' && url.pathname === '/api/users') {
        const users = await sql`SELECT id, email, name, created_at FROM cftest_users ORDER BY created_at DESC LIMIT 50`;
        return json({ ok: true, users, count: users.length });
      }

      return json({ ok: false, error: 'not found', path: url.pathname }, 404);
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
};
