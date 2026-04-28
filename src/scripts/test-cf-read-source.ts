// Verify the modification flow: deploy a Worker, read its source back via
// cf_read_app_source, modify, redeploy, verify the change is live.
// This is the agent's modification path proven without an LLM in the loop.
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-read-source.ts

import {
  deployWorkerScript,
  addWorkerRoute,
  verifyFounderAppLive,
  deleteWorkerScript,
  deleteWorkerRoute,
  getWorkerScriptSource,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';

const SUBDOMAIN = 'cfreadsrc';
const SCRIPT_NAME = `baljia-app-${SUBDOMAIN}`;
const ROUTE_PATTERN = `${SUBDOMAIN}.baljia.app/*`;

const ORIGINAL = `export default {
  async fetch(request, env) {
    return new Response(JSON.stringify({ ok: true, version: 'v1' }), {
      headers: { 'content-type': 'application/json' },
    });
  },
};`;

async function main() {
  console.log('═══ cf_read_app_source modification flow test ═══\n');

  if (!isCloudflareDeployConfigured()) { console.error('❌ CF not configured'); process.exit(1); }

  let route = null;
  let scriptDeployed = false;
  let exitCode = 0;

  try {
    console.log('1. Deploy v1 of the Worker...');
    const deploy = await deployWorkerScript({
      scriptName: SCRIPT_NAME,
      scriptContent: ORIGINAL,
      bindings: [{ type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: SUBDOMAIN }],
    });
    if (!deploy) throw new Error('initial deploy failed');
    scriptDeployed = true;
    console.log('   ✓\n');

    console.log('2. Register route...');
    route = await addWorkerRoute({ pattern: ROUTE_PATTERN, scriptName: SCRIPT_NAME });
    if (!route) throw new Error('route failed');
    console.log('   ✓\n');

    await new Promise((r) => setTimeout(r, 6000));

    console.log('3. Verify v1 is live...');
    const v1 = await verifyFounderAppLive(SUBDOMAIN);
    const v1Pass = v1?.status === 200 && v1.bodySnippet.includes('"version":"v1"');
    console.log(`   ${v1Pass ? '✓' : '✗'} status=${v1?.status} body=${v1?.bodySnippet.slice(0, 100)}\n`);
    if (!v1Pass) { exitCode = 1; throw new Error('v1 not live'); }

    console.log('4. cf_read_app_source — fetch what is running...');
    const fetched = await getWorkerScriptSource(SCRIPT_NAME);
    if (!fetched) { exitCode = 1; throw new Error('cf_read_app_source returned null'); }
    console.log(`   ✓ ${fetched.bytes} bytes, etag ${fetched.etag.slice(0, 16)}…`);
    const sourceMatches = fetched.source.includes(`version: 'v1'`) || fetched.source.includes(`'v1'`);
    console.log(`   source contains v1 marker: ${sourceMatches ? '✓' : '✗'}`);
    if (!sourceMatches) {
      console.log('   First 300 chars of fetched source:');
      console.log('   ' + fetched.source.slice(0, 300));
      exitCode = 1;
      throw new Error('fetched source does not match what was deployed');
    }
    console.log();

    console.log('5. Modify: replace v1 → v2 (simulating a small agent edit)...');
    const modified = fetched.source.replace(`'v1'`, `'v2'`);
    if (modified === fetched.source) {
      console.log('   ✗ replacement made no change — quoting issue?');
      console.log('   First 400 chars:');
      console.log('   ' + fetched.source.slice(0, 400));
      exitCode = 1;
      throw new Error('modify step inert');
    }
    console.log('   ✓ source modified in memory\n');

    console.log('6. Redeploy with modified source...');
    const redeploy = await deployWorkerScript({
      scriptName: SCRIPT_NAME,
      scriptContent: modified,
      bindings: [{ type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: SUBDOMAIN }],
    });
    if (!redeploy) { exitCode = 1; throw new Error('redeploy failed'); }
    console.log('   ✓\n');

    await new Promise((r) => setTimeout(r, 4000));

    console.log('7. Verify v2 is live (the modification took effect)...');
    const v2 = await verifyFounderAppLive(SUBDOMAIN);
    const v2Pass = v2?.status === 200 && v2.bodySnippet.includes('"version":"v2"') && !v2.bodySnippet.includes('"version":"v1"');
    console.log(`   ${v2Pass ? '✓' : '✗'} status=${v2?.status} body=${v2?.bodySnippet.slice(0, 100)}\n`);

    const overallPass = v1Pass && sourceMatches && v2Pass;
    if (overallPass) {
      console.log('═══ ✅ MODIFICATION FLOW VERIFIED ═══');
      console.log('   Worker deployed → source read back → edited → redeployed → live change confirmed.');
    } else {
      console.log('═══ ❌ MODIFICATION FLOW BROKEN ═══');
      exitCode = 1;
    }
  } finally {
    console.log('\n8. Cleanup...');
    if (route) console.log(`   route delete: ${(await deleteWorkerRoute(route.id)) ? '✓' : '⚠'}`);
    if (scriptDeployed) console.log(`   script delete: ${(await deleteWorkerScript(SCRIPT_NAME)) ? '✓' : '⚠'}`);
  }

  process.exit(exitCode);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
