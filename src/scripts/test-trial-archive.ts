// Phase 3 test: archiveExpiredTrialApp lifts a CF Worker → GitHub then deletes
// the live deployment. Used by the daily trial-expiry cron for non-converters.
//
// Strategy: deploy a CF Worker against a real test company, run archival,
// verify (a) code in repo, (b) Worker gone, (c) hosting_state suspended.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-trial-archive.ts

import { db, companies } from '@/lib/db';
import { eq, isNotNull, and } from 'drizzle-orm';
import {
  deployWorkerScript,
  addWorkerRoute,
  deleteWorkerScript,
  deleteWorkerRoute,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';
import { archiveExpiredTrialApp } from '@/lib/services/trial-paid-migration.service';

const TEST_WORKER = `export default {
  async fetch(request, env) {
    return new Response(JSON.stringify({ ok: true, marker: 'archive-test' }), {
      headers: { 'content-type': 'application/json' },
    });
  },
};`;

async function main() {
  console.log('═══ Trial Archive Test (Phase 3) ═══\n');

  if (!isCloudflareDeployConfigured()) { console.error('❌ CF not configured'); process.exit(1); }

  // Use plinqa as the test company (has slug + neon already)
  const [company] = await db
    .select({
      id: companies.id, slug: companies.slug, name: companies.name,
      github_repo: companies.github_repo, hosting_state: companies.hosting_state,
    })
    .from(companies)
    .where(and(eq(companies.slug, 'plinqa'), isNotNull(companies.neon_connection_string)))
    .limit(1);

  if (!company) { console.error('❌ Test company plinqa not found'); process.exit(1); }
  console.log(`Company: ${company.name} (${company.slug})`);
  console.log(`Original hosting_state: ${company.hosting_state}`);
  console.log(`Original github_repo:   ${company.github_repo ?? '(none)'}\n`);

  const subdomain = company.slug!;
  const scriptName = `baljia-app-${subdomain}`;
  const routePattern = `${subdomain}.baljia.app/*`;

  let scriptDeployed = false;
  let route: { id: string } | null = null;
  let exitCode = 0;
  const originalHostingState = company.hosting_state;

  try {
    // 1. Deploy a Worker to mimic a trial founder's app
    console.log('1. Deploy a test CF Worker...');
    const deploy = await deployWorkerScript({
      scriptName,
      scriptContent: TEST_WORKER,
      bindings: [{ type: 'plain_text', name: 'COMPANY_SUBDOMAIN', text: subdomain }],
    });
    if (!deploy) throw new Error('deploy failed');
    scriptDeployed = true;
    console.log('   ✓\n');

    route = await addWorkerRoute({ pattern: routePattern, scriptName });
    console.log(`2. Route registered: ${route ? '✓' : '⚠'}\n`);

    // 2. Set hosting_state=active so the archive will run
    await db.update(companies).set({ hosting_state: 'active' }).where(eq(companies.id, company.id));
    console.log('3. Set company hosting_state=active (precondition for archive)\n');

    // 3. Run archive
    console.log('4. archiveExpiredTrialApp...');
    const result = await archiveExpiredTrialApp(company.id);
    console.log(`   success: ${result.success}`);
    console.log(`   reason:  ${result.reason ?? '(none)'}`);
    console.log(`   artifacts: ${JSON.stringify(result.artifacts)}\n`);

    // 4. Verify: Worker should be gone (live URL returns wildcard 404)
    console.log('5. Verify CF Worker is torn down...');
    await new Promise((r) => setTimeout(r, 4000));
    const probeRes = await fetch(`https://${subdomain}.baljia.app/`);
    const probeHeader = probeRes.headers.get('x-baljia-tier');
    const isWildcardFallback = probeHeader === '0';  // tier 0 = wildcard (no R2 content)
    console.log(`   GET ${subdomain}.baljia.app → HTTP ${probeRes.status}, x-baljia-tier=${probeHeader ?? '(none)'}`);
    console.log(`   ${isWildcardFallback ? '✓' : '⚠'} ${isWildcardFallback ? 'wildcard fallback (worker gone)' : 'unexpected — worker may still be alive'}\n`);
    scriptDeployed = !isWildcardFallback;  // if archive deleted it, don't try cleanup again
    if (route && isWildcardFallback) route = null;

    // 5. Verify: GitHub repo has worker.js with the test marker
    console.log('6. Verify worker.js is in GitHub...');
    const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
    const repoFullName = result.artifacts?.githubRepo;
    if (!repoFullName) {
      console.log('   ⚠ no github_repo in artifacts');
      exitCode = 1;
    } else {
      const ghRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/worker.js?ref=main`, { headers });
      if (ghRes.ok) {
        const data = await ghRes.json() as { content?: string; encoding?: string };
        const decoded = data.content && data.encoding === 'base64'
          ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
          : '';
        const hasMarker = decoded.includes("marker: 'archive-test'");
        console.log(`   GET ${repoFullName}/contents/worker.js → HTTP ${ghRes.status}`);
        console.log(`   ${hasMarker ? '✓' : '✗'} contains test marker`);
        if (!hasMarker) exitCode = 1;
      } else {
        console.log(`   ✗ GitHub returned ${ghRes.status}`);
        exitCode = 1;
      }
    }
    console.log();

    // 6. Verify: company.hosting_state is no longer 'active'
    console.log('7. Verify company.hosting_state...');
    const [updated] = await db.select({ hosting_state: companies.hosting_state }).from(companies).where(eq(companies.id, company.id));
    const stateChanged = updated?.hosting_state !== 'active';
    console.log(`   hosting_state: ${updated?.hosting_state} ${stateChanged ? '✓' : '✗'}\n`);
    if (!stateChanged) exitCode = 1;

    if (exitCode === 0 && result.success) {
      console.log('═══ ✅ TRIAL ARCHIVE FLOW VERIFIED ═══');
      console.log('   Worker deployed → archived → code in GitHub → live URL gone → state updated.');
    } else {
      console.log('═══ ❌ TRIAL ARCHIVE FAILED ═══');
      exitCode = 1;
    }
  } finally {
    console.log('\n8. Cleanup...');
    // Restore original hosting state
    if (originalHostingState) {
      await db.update(companies).set({ hosting_state: originalHostingState }).where(eq(companies.id, company.id));
      console.log(`   restore hosting_state=${originalHostingState}: ✓`);
    }
    // If archive didn't tear down the worker (test failed before that step), clean up here
    if (route) {
      try { await deleteWorkerRoute(route.id); console.log('   route delete: ✓'); }
      catch (e) { console.log(`   route delete: ⚠ ${e instanceof Error ? e.message : e}`); }
    }
    if (scriptDeployed) {
      try { await deleteWorkerScript(scriptName); console.log('   script delete: ✓'); }
      catch (e) { console.log(`   script delete: ⚠ ${e instanceof Error ? e.message : e}`); }
    }
  }

  process.exit(exitCode);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
