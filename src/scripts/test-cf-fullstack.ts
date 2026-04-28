// Step B — real full-stack proof on Cloudflare Workers + Neon.
// Bundles src/scripts/cf-fullstack-test/worker.ts via esbuild into a single
// ES module, deploys it via the same primitives the engineering agent uses,
// then curls every endpoint to verify the pattern works end-to-end.
//
// Cleanup: drops cftest_users table, deletes Worker + route.
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-fullstack.ts

import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import {
  deployWorkerScript,
  addWorkerRoute,
  putWorkerSecret,
  deleteWorkerScript,
  deleteWorkerRoute,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';

const SUBDOMAIN = 'cffullstack';
const SCRIPT_NAME = `baljia-app-${SUBDOMAIN}`;
const ROUTE_PATTERN = `${SUBDOMAIN}.baljia.app/*`;

const REPO_ROOT = process.cwd();
const ENTRY = join(REPO_ROOT, 'src/scripts/cf-fullstack-test/worker.ts');
const OUT_DIR = join(REPO_ROOT, 'src/scripts/cf-fullstack-test/.bundle');
const OUT_FILE = join(OUT_DIR, 'worker.bundled.mjs');

async function bundle(): Promise<string> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('  bundling with esbuild...');
  // npx esbuild handles cross-platform (Windows .cmd, Unix shell script).
  // shell:true so npm/npx can resolve the binary on Windows.
  execSync(
    `npx esbuild "${ENTRY}" --bundle --platform=neutral --format=esm --target=es2022 --external:cloudflare:* --conditions=worker,browser --outfile="${OUT_FILE}"`,
    { stdio: 'inherit', cwd: REPO_ROOT, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' },
  );
  const bundled = readFileSync(OUT_FILE, 'utf8');
  return bundled;
}

async function main() {
  console.log('═══ CF Full-Stack Proof (Step B) ═══\n');

  if (!isCloudflareDeployConfigured()) {
    console.error('❌ CF deploy not configured');
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }
  console.log('✓ Env configured (CF + DATABASE_URL)\n');

  let route = null;
  let scriptDeployed = false;
  let tableCreated = false;
  let exitCode = 0;
  const sql = neon(dbUrl);

  try {
    // 1. Pre-create the test table on platform DB
    console.log('1. Creating cftest_users table on platform DB...');
    await sql`
      CREATE TABLE IF NOT EXISTS cftest_users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    tableCreated = true;
    console.log('   ✓ Table ready\n');

    // 2. Bundle the Worker
    console.log('2. Bundling Worker source...');
    const scriptContent = await bundle();
    console.log(`   ✓ Bundled: ${scriptContent.length} bytes\n`);

    // 3. Deploy
    console.log('3. Deploying Worker script...');
    const deploy = await deployWorkerScript({
      scriptName: SCRIPT_NAME,
      scriptContent,
      bindings: [
        { type: 'plain_text', name: 'PLATFORM_API_BASE', text: 'https://baljia.ai' },
        { type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: SUBDOMAIN },
      ],
    });
    if (!deploy) throw new Error('deployWorkerScript returned null');
    scriptDeployed = true;
    console.log(`   ✓ Deployed (etag: ${deploy.etag.slice(0, 16)}…)\n`);

    // 4. Inject NEON_URL secret
    console.log('4. Injecting NEON_URL secret...');
    const secretOk = await putWorkerSecret({ scriptName: SCRIPT_NAME, key: 'NEON_URL', value: dbUrl });
    if (!secretOk) throw new Error('putWorkerSecret failed');
    console.log('   ✓ Secret set\n');

    // 5. Register route
    console.log('5. Registering route...');
    route = await addWorkerRoute({ pattern: ROUTE_PATTERN, scriptName: SCRIPT_NAME });
    if (!route) throw new Error('addWorkerRoute returned null');
    console.log(`   ✓ Route registered (${route.id})\n`);

    // 6. Wait for propagation
    console.log('6. Waiting 8s for propagation...\n');
    await new Promise((r) => setTimeout(r, 8000));

    const base = `https://${SUBDOMAIN}.baljia.app`;
    const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

    // 7. Endpoint checks
    console.log('7. Endpoint checks:\n');

    // GET /
    {
      const res = await fetch(`${base}/`);
      const body = await res.text();
      const pass = res.status === 200 && body.includes('CF Full-Stack Test') && body.includes('<form');
      checks.push({ name: 'GET /', pass, detail: `HTTP ${res.status}, ${body.length}B, has-form=${body.includes('<form')}` });
      console.log(`   GET /              ${pass ? '✓' : '✗'}  HTTP ${res.status}, body ${body.length}B`);
    }

    // GET /api/health
    {
      const res = await fetch(`${base}/api/health`);
      const data = await res.json() as Record<string, unknown>;
      const pass = res.status === 200 && data.ok === true && typeof data.db_latency_ms === 'number';
      checks.push({ name: 'GET /api/health', pass, detail: JSON.stringify(data).slice(0, 150) });
      console.log(`   GET /api/health    ${pass ? '✓' : '✗'}  ${JSON.stringify(data).slice(0, 200)}`);
    }

    // POST /api/signup
    const testEmail = `cftest+${Date.now()}@baljia.test`;
    {
      const res = await fetch(`${base}/api/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: testEmail, name: 'CF Smoke User' }),
      });
      const data = await res.json() as Record<string, unknown>;
      const pass = res.status === 201 && data.ok === true && (data.user as Record<string, unknown> | undefined)?.email === testEmail;
      checks.push({ name: 'POST /api/signup', pass, detail: JSON.stringify(data).slice(0, 150) });
      console.log(`   POST /api/signup   ${pass ? '✓' : '✗'}  ${JSON.stringify(data).slice(0, 200)}`);
    }

    // GET /api/users (should include the just-signed-up user)
    {
      const res = await fetch(`${base}/api/users`);
      const data = await res.json() as { ok: boolean; users: Array<{ email: string; name: string }>; count: number };
      const found = (data.users ?? []).some((u) => u.email === testEmail);
      const pass = res.status === 200 && data.ok === true && found;
      checks.push({ name: 'GET /api/users', pass, detail: `count=${data.count}, includes-test-user=${found}` });
      console.log(`   GET /api/users     ${pass ? '✓' : '✗'}  count=${data.count}, includes-test-user=${found}`);
    }

    const allPass = checks.every((c) => c.pass);
    console.log(`\n${allPass ? '═══ ✅ FULL-STACK PROOF PASSED ═══' : '═══ ❌ FULL-STACK PROOF FAILED ═══'}`);
    if (!allPass) {
      exitCode = 1;
      for (const c of checks.filter((c) => !c.pass)) {
        console.log(`   ✗ ${c.name}: ${c.detail}`);
      }
    } else {
      console.log('   Worker + Neon HTTP + per-founder secret + multi-route + frontend all working at the edge.');
    }
  } finally {
    console.log('\n8. Cleanup...');
    if (route) {
      const ok = await deleteWorkerRoute(route.id);
      console.log(`   route delete: ${ok ? '✓' : '⚠'}`);
    }
    if (scriptDeployed) {
      const ok = await deleteWorkerScript(SCRIPT_NAME);
      console.log(`   script delete: ${ok ? '✓' : '⚠'}`);
    }
    if (tableCreated) {
      try {
        await sql`DROP TABLE IF EXISTS cftest_users`;
        console.log(`   table drop: ✓`);
      } catch (err) {
        console.log(`   table drop: ⚠ ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  process.exit(exitCode);
}

main().catch((e) => { console.error('\n❌ Unhandled error:', e); process.exit(1); });
