// Direct test of cf_deploy_app (no LLM, no agent). Deploys a minimal Tier 2
// Worker for the pagegenie company, verifies route override works.

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import {
  deployWorkerScript,
  addWorkerRoute,
  getWorkerScriptInfo,
  deleteWorkerScript,
} from '@/lib/services/cf-deploy.service';

const TEST_SUBDOMAIN = 'pagegenie';
const SCRIPT_NAME = `baljia-app-${TEST_SUBDOMAIN}`;

const TIER2_SCRIPT = `export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/hello') {
      return Response.json({
        ok: true,
        message: 'Hello from Tier 2 Worker!',
        subdomain: env.COMPANY_SUBDOMAIN,
        company_id: env.COMPANY_ID,
        ts: new Date().toISOString(),
      });
    }
    if (url.pathname === '/api/echo' && request.method === 'POST') {
      const body = await request.text();
      return Response.json({ you_sent: body, method: request.method });
    }
    return new Response(\`<!DOCTYPE html><html><head><title>Tier 2 Live</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#f5f5f5;padding:48px;max-width:640px;margin:auto}h1{color:#F5A623}a{color:#F5A623}</style></head>
<body><h1>Tier 2 is LIVE</h1>
<p>This page is served by a dedicated Cloudflare Worker — not the wildcard R2 landing.</p>
<p>Try these API endpoints:</p>
<ul>
<li><a href="/api/hello">/api/hello</a> — GET returns JSON</li>
<li><code>POST /api/echo</code> with body — returns it back</li>
</ul>
<p>Subdomain: <code>\${env.COMPANY_SUBDOMAIN}</code></p>
<p>Company ID: <code>\${env.COMPANY_ID}</code></p>
</body></html>\`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};`;

async function main() {
  console.log(`=== Step 1: Upload Worker script (${SCRIPT_NAME}) ===`);
  const deploy = await deployWorkerScript({
    scriptName: SCRIPT_NAME,
    scriptContent: TIER2_SCRIPT,
    bindings: [
      { type: 'plain_text', name: 'PLATFORM_API_BASE', text: 'https://baljia.ai' },
      { type: 'plain_text', name: 'COMPANY_ID', text: 'test-pagegenie' },
      { type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: TEST_SUBDOMAIN },
    ],
  });
  if (!deploy) { console.error('FAIL: deployWorkerScript'); process.exit(1); }
  console.log(`  ✅ deployed. etag=${deploy.etag}, modified_on=${deploy.deployedAt}`);

  console.log(`\n=== Step 2: Register route ${TEST_SUBDOMAIN}.baljia.app/* ===`);
  const route = await addWorkerRoute({
    pattern: `${TEST_SUBDOMAIN}.baljia.app/*`,
    scriptName: SCRIPT_NAME,
  });
  if (!route) { console.error('FAIL: addWorkerRoute'); process.exit(1); }
  console.log(`  ✅ route registered: id=${route.id}`);

  console.log('\n=== Step 3: Wait 5s for CF propagation, then verify ===');
  await new Promise((r) => setTimeout(r, 5000));

  const tests = [
    { path: '/api/hello', method: 'GET', expectJson: true, expectMarker: 'Tier 2 Worker' },
    { path: '/', method: 'GET', expectJson: false, expectMarker: 'Tier 2 is LIVE' },
    { path: '/api/echo', method: 'POST', body: 'ping-123', expectJson: true, expectMarker: 'ping-123' },
  ];
  for (const t of tests) {
    const url = `https://${TEST_SUBDOMAIN}.baljia.app${t.path}`;
    const res = await fetch(url, {
      method: t.method,
      body: t.body,
      headers: t.body ? { 'content-type': 'text/plain' } : undefined,
    });
    const txt = await res.text();
    const marker = txt.includes(t.expectMarker);
    console.log(`  ${t.method} ${url} → HTTP ${res.status}`);
    console.log(`    marker "${t.expectMarker}": ${marker ? '✅' : '❌'}`);
    console.log(`    body head: ${txt.slice(0, 120).replace(/\n/g, ' ')}`);
  }

  console.log('\n=== Step 4: getWorkerScriptInfo ===');
  const info = await getWorkerScriptInfo(SCRIPT_NAME);
  console.log('  info:', info);

  // Keep the Worker around for the agent test. Don't delete.
  console.log('\n🎉 Tier 2 CF deploy path works end-to-end.');
  console.log(`   To tear down: uncomment the deleteWorkerScript call in this script.`);
  // await deleteWorkerScript(SCRIPT_NAME);
  process.exit(0);
}

main().catch((err) => { console.error('Threw:', err); process.exit(1); });
