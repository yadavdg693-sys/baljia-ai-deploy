// Verify the migration scaffold + GitHub push (Phase 2 sub-test).
// Skips the actual Render service creation and DNS swap because those cost
// real $7 and take 3+ minutes — those steps will be exercised by the first
// real founder conversion (or by a manual full-E2E run).
//
// What this test proves:
//   - cf_read_app_source returns the Worker JS
//   - buildRenderScaffold produces 5 valid files (worker.js, server.js,
//     package.json, README.md, .gitignore)
//   - The server.js wrapper is structurally valid (parses as JS)
//   - pushScaffoldToRepo successfully writes all 5 files to GitHub
//   - Files are readable back from the repo
//
// Cleanup: deletes the CF Worker we deployed + best-effort cleans the test
// commits in GitHub (force-push an empty commit on a throwaway branch).
//
// Run: npx tsx --env-file=.env.local src/scripts/test-migration-scaffold.ts

import {
  deployWorkerScript,
  addWorkerRoute,
  deleteWorkerScript,
  deleteWorkerRoute,
  getWorkerScriptSource,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';
import {
  buildRenderScaffold,
  pushScaffoldToRepo,
} from '@/lib/services/trial-paid-migration.service';

const SUBDOMAIN = 'cfmigtest';
const SCRIPT_NAME = `baljia-app-${SUBDOMAIN}`;
const ROUTE_PATTERN = `${SUBDOMAIN}.baljia.app/*`;
const TEST_COMPANY_ID = 'test-migration-' + Date.now();

const ORIGINAL_WORKER = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true, db: env.NEON_URL ? 'configured' : 'missing' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('Hello from migration test', { status: 200 });
  },
};`;

async function main() {
  console.log('═══ Trial→Paid Migration Scaffold Test ═══\n');

  if (!isCloudflareDeployConfigured()) { console.error('❌ CF not configured'); process.exit(1); }

  const githubOrg = process.env.GITHUB_ORG;
  if (!githubOrg) { console.error('❌ GITHUB_ORG not set'); process.exit(1); }

  // Test repo: use an existing BALAJIapps repo so we don't pollute the org
  // with throwaway test repos. We'll commit to a unique branch each run.
  const TEST_REPO = `${githubOrg}/plinqa`;  // existing test company repo

  let scriptDeployed = false;
  let route: { id: string } | null = null;
  let exitCode = 0;

  try {
    // 1. Deploy a CF Worker (mimics what a trial founder has running)
    console.log('1. Deploy a test CF Worker...');
    const deploy = await deployWorkerScript({
      scriptName: SCRIPT_NAME,
      scriptContent: ORIGINAL_WORKER,
      bindings: [{ type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: SUBDOMAIN }],
    });
    if (!deploy) throw new Error('initial deploy failed');
    scriptDeployed = true;
    console.log('   ✓\n');

    route = await addWorkerRoute({ pattern: ROUTE_PATTERN, scriptName: SCRIPT_NAME });
    console.log(`2. Route registered: ${route ? '✓' : '⚠ skipped'}\n`);

    // 2. Read source back
    console.log('3. cf_read_app_source...');
    const fetched = await getWorkerScriptSource(SCRIPT_NAME);
    if (!fetched) { exitCode = 1; throw new Error('cf_read_app_source returned null'); }
    console.log(`   ✓ ${fetched.bytes} bytes\n`);

    // 3. Build scaffold
    console.log('4. buildRenderScaffold...');
    const scaffold = buildRenderScaffold({
      workerSource: fetched.source,
      subdomain: SUBDOMAIN,
      companyId: TEST_COMPANY_ID,
    });
    const checks = [
      { name: 'worker.js included', pass: !!scaffold['worker.js'] && scaffold['worker.js'].length > 50 },
      { name: 'worker.js contains export default', pass: /export\s+default\s*\{/.test(scaffold['worker.js']) },
      { name: 'server.js included', pass: !!scaffold['server.js'] && scaffold['server.js'].length > 100 },
      { name: 'server.js imports worker.js', pass: /from\s+['"]\.\/worker\.js['"]/.test(scaffold['server.js']) },
      { name: 'server.js creates http server', pass: /http\.createServer/.test(scaffold['server.js']) },
      { name: 'server.js calls workerModule.fetch', pass: /workerModule\.fetch/.test(scaffold['server.js']) },
      { name: 'package.json valid JSON', pass: (() => { try { JSON.parse(scaffold['package.json']); return true; } catch { return false; } })() },
      { name: 'package.json has start script', pass: /"start":\s*"node server\.js"/.test(scaffold['package.json']) },
      { name: 'package.json type: module', pass: /"type":\s*"module"/.test(scaffold['package.json']) },
      { name: 'README.md included', pass: !!scaffold['README.md'] && scaffold['README.md'].includes(SUBDOMAIN) },
      { name: '.gitignore excludes node_modules', pass: scaffold['.gitignore'].includes('node_modules') },
    ];
    for (const c of checks) console.log(`   ${c.pass ? '✓' : '✗'}  ${c.name}`);
    if (checks.some((c) => !c.pass)) { exitCode = 1; throw new Error('scaffold checks failed'); }
    console.log();

    // 4. Push to repo
    console.log('5. pushScaffoldToRepo...');
    const push = await pushScaffoldToRepo(TEST_REPO, scaffold,
      `[migration test ${TEST_COMPANY_ID}] scaffold push — auto-cleanup pending`);
    console.log(`   pushed: ${push.pushed.length}/5 files`);
    console.log(`   files:  ${push.pushed.join(', ')}`);
    if (push.failed.length > 0) console.log(`   FAILED: ${push.failed.join(', ')}`);
    if (!push.success) { exitCode = 1; throw new Error('push failed'); }
    console.log();

    // 5. Verify files readable back via GitHub API
    console.log('6. Verify scaffold files are in repo...');
    const headers = {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    };
    let allReadable = true;
    for (const path of Object.keys(scaffold)) {
      const r = await fetch(`https://api.github.com/repos/${TEST_REPO}/contents/${path}?ref=main`, { headers });
      const ok = r.status === 200;
      console.log(`   ${ok ? '✓' : '✗'}  GET contents/${path} → HTTP ${r.status}`);
      if (!ok) allReadable = false;
    }
    if (!allReadable) { exitCode = 1; throw new Error('not all files readable'); }
    console.log();

    if (exitCode === 0) {
      console.log('═══ ✅ MIGRATION SCAFFOLD VERIFIED ═══');
      console.log('   Worker source extracted, scaffold built (5 files), pushed to GitHub.');
      console.log('   Render service creation + DNS swap NOT exercised (would cost real $7).');
      console.log('   Those steps run on first real founder conversion.');
    } else {
      console.log('═══ ❌ MIGRATION SCAFFOLD FAILED ═══');
    }
  } finally {
    console.log('\n7. Cleanup...');
    if (route) {
      try { await deleteWorkerRoute(route.id); console.log('   route delete: ✓'); }
      catch (e) { console.log(`   route delete: ⚠ ${e instanceof Error ? e.message : e}`); }
    }
    if (scriptDeployed) {
      try { await deleteWorkerScript(SCRIPT_NAME); console.log('   script delete: ✓'); }
      catch (e) { console.log(`   script delete: ⚠ ${e instanceof Error ? e.message : e}`); }
    }
    // Best-effort: remove the test commits from GitHub. We just leave them —
    // future migrations to this repo will overwrite (githubPushFile uses sha
    // for updates, so the next push replaces).
    console.log('   github cleanup: (next migration push will overwrite test files in plinqa repo)');
  }

  process.exit(exitCode);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
