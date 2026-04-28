// Step B-prime: verify the SKILL's "raw fetch to Neon /sql" pattern actually works.
// No bundler, no @neondatabase/serverless — just a vanilla JS Worker hitting Neon's
// HTTP endpoint with the Neon-Connection-String header. This is the pattern the
// engineering agent will use because it has no bundler.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-rawfetch-neon.ts

import { neon } from '@neondatabase/serverless';
import {
  deployWorkerScript,
  addWorkerRoute,
  putWorkerSecret,
  deleteWorkerScript,
  deleteWorkerRoute,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';

const SUBDOMAIN = 'cfrawfetch';
const SCRIPT_NAME = `baljia-app-${SUBDOMAIN}`;
const ROUTE_PATTERN = `${SUBDOMAIN}.baljia.app/*`;

// The exact Worker source from the skill — no imports, single ES module.
const WORKER_SOURCE = `async function neonQuery(connectionString, query, params = []) {
  const u = new URL(connectionString);
  const host = u.hostname;
  const res = await fetch('https://' + host + '/sql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': connectionString,
      'Neon-Raw-Text-Output': 'false',
      'Neon-Array-Mode': 'false',
    },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) throw new Error('Neon HTTP ' + res.status + ': ' + (await res.text()));
  const data = await res.json();
  return data.rows || [];
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const start = Date.now();
        const rows = await neonQuery(env.NEON_URL, 'SELECT NOW() as ts, $1::text as greeting', ['hello from raw-fetch']);
        return json({
          ok: true,
          subdomain: env.COMPANY_SUBDOMAIN,
          db_latency_ms: Date.now() - start,
          db_now: rows[0]?.ts,
          greeting: rows[0]?.greeting,
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/signup') {
        const body = await request.json();
        if (!body.email || !body.name) return json({ ok: false, error: 'email and name required' }, 400);
        const rows = await neonQuery(env.NEON_URL,
          'INSERT INTO cftest_rawfetch (email, name, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id, email, name, created_at',
          [body.email, body.name],
        );
        return json({ ok: true, user: rows[0] }, 201);
      }
      if (request.method === 'GET' && url.pathname === '/api/users') {
        const users = await neonQuery(env.NEON_URL, 'SELECT id, email, name FROM cftest_rawfetch ORDER BY id DESC LIMIT 50');
        return json({ ok: true, users, count: users.length });
      }
      return json({ ok: false, error: 'not found', path: url.pathname }, 404);
    } catch (err) {
      return json({ ok: false, error: err.message || String(err) }, 500);
    }
  },
};`;

async function main() {
  console.log('═══ CF Raw-Fetch Neon Pattern (proves the SKILL.md template) ═══\n');

  if (!isCloudflareDeployConfigured()) { console.error('❌ CF not configured'); process.exit(1); }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

  let route = null;
  let scriptDeployed = false;
  let tableCreated = false;
  let exitCode = 0;
  const sql = neon(dbUrl);

  try {
    console.log('1. Pre-create cftest_rawfetch table...');
    await sql`CREATE TABLE IF NOT EXISTS cftest_rawfetch (id SERIAL PRIMARY KEY, email TEXT UNIQUE, name TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
    tableCreated = true;
    console.log('   ✓\n');

    console.log(`2. Deploy Worker (raw-fetch, no bundler) — ${WORKER_SOURCE.length} bytes...`);
    const deploy = await deployWorkerScript({
      scriptName: SCRIPT_NAME,
      scriptContent: WORKER_SOURCE,
      bindings: [
        { type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: SUBDOMAIN },
      ],
    });
    if (!deploy) throw new Error('deploy failed');
    scriptDeployed = true;
    console.log(`   ✓ etag ${deploy.etag.slice(0, 16)}…\n`);

    console.log('3. putSecret NEON_URL...');
    if (!(await putWorkerSecret({ scriptName: SCRIPT_NAME, key: 'NEON_URL', value: dbUrl }))) throw new Error('secret failed');
    console.log('   ✓\n');

    console.log('4. addRoute...');
    route = await addWorkerRoute({ pattern: ROUTE_PATTERN, scriptName: SCRIPT_NAME });
    if (!route) throw new Error('route failed');
    console.log('   ✓\n');

    console.log('5. Wait 8s...\n');
    await new Promise((r) => setTimeout(r, 8000));

    const base = `https://${SUBDOMAIN}.baljia.app`;
    const checks: Array<{ name: string; pass: boolean; body: string }> = [];

    console.log('6. Endpoint checks:');

    {
      const r = await fetch(`${base}/api/health`);
      const d = await r.json() as Record<string, unknown>;
      const pass = r.status === 200 && d.ok === true && d.greeting === 'hello from raw-fetch' && typeof d.db_latency_ms === 'number';
      checks.push({ name: 'GET /api/health', pass, body: JSON.stringify(d) });
      console.log(`   GET /api/health    ${pass ? '✓' : '✗'}  ${JSON.stringify(d).slice(0, 200)}`);
    }

    const testEmail = `rawfetch+${Date.now()}@baljia.test`;
    {
      const r = await fetch(`${base}/api/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: testEmail, name: 'Raw Fetch User' }),
      });
      const d = await r.json() as Record<string, unknown>;
      const pass = r.status === 201 && d.ok === true && (d.user as Record<string, unknown> | undefined)?.email === testEmail;
      checks.push({ name: 'POST /api/signup', pass, body: JSON.stringify(d) });
      console.log(`   POST /api/signup   ${pass ? '✓' : '✗'}  ${JSON.stringify(d).slice(0, 200)}`);
    }

    {
      const r = await fetch(`${base}/api/users`);
      const d = await r.json() as { ok: boolean; users: Array<{ email: string }>; count: number };
      const found = (d.users ?? []).some((u) => u.email === testEmail);
      const pass = r.status === 200 && d.ok && found;
      checks.push({ name: 'GET /api/users', pass, body: JSON.stringify(d) });
      console.log(`   GET /api/users     ${pass ? '✓' : '✗'}  count=${d.count}, includes-test-user=${found}`);
    }

    const allPass = checks.every((c) => c.pass);
    console.log(`\n${allPass ? '═══ ✅ RAW-FETCH PATTERN VERIFIED ═══' : '═══ ❌ RAW-FETCH PATTERN BROKEN ═══'}`);
    if (!allPass) {
      exitCode = 1;
      checks.filter((c) => !c.pass).forEach((c) => console.log(`   ✗ ${c.name}: ${c.body.slice(0, 250)}`));
    } else {
      console.log('   The skill\'s neonQuery shim works on a real CF Worker.');
    }
  } finally {
    console.log('\n7. Cleanup...');
    if (route) console.log(`   route delete: ${(await deleteWorkerRoute(route.id)) ? '✓' : '⚠'}`);
    if (scriptDeployed) console.log(`   script delete: ${(await deleteWorkerScript(SCRIPT_NAME)) ? '✓' : '⚠'}`);
    if (tableCreated) {
      try { await sql`DROP TABLE IF EXISTS cftest_rawfetch`; console.log('   table drop: ✓'); }
      catch (e) { console.log(`   table drop: ⚠ ${e instanceof Error ? e.message : e}`); }
    }
  }

  process.exit(exitCode);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
