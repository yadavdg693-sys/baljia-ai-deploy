// Smoke test: does cf_deploy_app actually deploy a working Worker end-to-end?
// Calls the same service primitives the engineering agent's tool handler calls.
// Subdomain: cfsmoke.baljia.app  (cleaned up at the end unless CLEANUP=false)
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-deploy-smoke.ts

import {
  deployWorkerScript,
  addWorkerRoute,
  verifyFounderAppLive,
  deleteWorkerScript,
  deleteWorkerRoute,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';

const SUBDOMAIN = 'cfsmoke';
const SCRIPT_NAME = `baljia-app-${SUBDOMAIN}`;
const ROUTE_PATTERN = `${SUBDOMAIN}.baljia.app/*`;

// Minimal Worker — proves: deploy + bindings + route override.
const SCRIPT = `export default {
  async fetch(request, env, ctx) {
    const body = {
      ok: true,
      ts: new Date().toISOString(),
      subdomain: env.COMPANY_SUBDOMAIN || 'unset',
      platform: env.PLATFORM_API_BASE || 'unset',
      url: request.url,
      method: request.method,
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-baljia-smoke': 'ok',
      },
    });
  },
};`;

async function main() {
  console.log('═══ CF Deploy Smoke Test ═══\n');

  if (!isCloudflareDeployConfigured()) {
    console.error('❌ CF deploy not configured. Required env vars not all set.');
    process.exit(1);
  }
  console.log('✓ CF deploy configured (all env vars set)\n');

  let deploy = null;
  let route = null;
  let exitCode = 0;

  try {
    // 1. Deploy Worker script
    console.log('1. Deploying Worker script...');
    console.log(`   scriptName: ${SCRIPT_NAME}`);
    console.log(`   bytes: ${SCRIPT.length}`);
    deploy = await deployWorkerScript({
      scriptName: SCRIPT_NAME,
      scriptContent: SCRIPT,
      bindings: [
        { type: 'plain_text', name: 'PLATFORM_API_BASE', text: 'https://baljia.ai' },
        { type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: SUBDOMAIN },
      ],
    });
    if (!deploy) {
      console.error('   ❌ Deploy returned null');
      exitCode = 1;
      throw new Error('deploy returned null — check logs above for CF API errors');
    }
    console.log(`   ✓ Deployed (etag: ${deploy.etag})\n`);

    // 2. Add per-subdomain route (overrides wildcard)
    console.log('2. Adding route...');
    console.log(`   pattern: ${ROUTE_PATTERN}`);
    route = await addWorkerRoute({
      pattern: ROUTE_PATTERN,
      scriptName: SCRIPT_NAME,
    });
    if (!route) {
      console.error('   ❌ Route add returned null');
      exitCode = 1;
      throw new Error('route add returned null');
    }
    console.log(`   ✓ Route registered (id: ${route.id})\n`);

    // 3. Wait for propagation
    console.log('3. Waiting 6s for CF route propagation...');
    await new Promise((r) => setTimeout(r, 6000));
    console.log('   ✓ Done\n');

    // 4. Verify live URL
    console.log(`4. GET https://${SUBDOMAIN}.baljia.app ...`);
    const verify = await verifyFounderAppLive(SUBDOMAIN);
    if (!verify) {
      console.error('   ❌ verify returned null');
      exitCode = 1;
      throw new Error('verify returned null');
    }
    console.log(`   status: ${verify.status}`);
    console.log(`   elapsed: ${verify.elapsedMs}ms`);
    console.log(`   body: ${verify.bodySnippet.slice(0, 300)}\n`);

    if (verify.status === 200 && verify.bodySnippet.includes('"ok": true')) {
      console.log('═══ ✅ SMOKE TEST PASSED ═══');
      console.log('   Worker script deployed, route registered, live URL responds 200 with expected body.');
    } else {
      console.log('═══ ❌ SMOKE TEST FAILED ═══');
      console.log(`   Expected 200 with "ok": true. Got status=${verify.status}, body="${verify.bodySnippet.slice(0, 200)}"`);
      exitCode = 1;
    }
  } finally {
    // Always cleanup
    if (process.env.CLEANUP === 'false') {
      console.log('\n(skipping cleanup — CLEANUP=false)');
    } else {
      console.log('\n5. Cleanup...');
      if (route) {
        const ok = await deleteWorkerRoute(route.id);
        console.log(`   route delete: ${ok ? '✓' : '⚠ failed'}`);
      }
      if (deploy) {
        const ok = await deleteWorkerScript(SCRIPT_NAME);
        console.log(`   script delete: ${ok ? '✓' : '⚠ failed'}`);
      }
    }
  }

  process.exit(exitCode);
}

main().catch((e) => {
  console.error('\n❌ Unhandled error:', e);
  process.exit(1);
});
