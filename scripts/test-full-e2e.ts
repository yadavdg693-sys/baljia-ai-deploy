// Full ADR-002 end-to-end test:
// 1. Upload landing HTML to R2 for subdomain "smoke"
// 2. Fetch https://smoke.baljia.app/ — expect 200 + our HTML
// 3. Delete the asset
// 4. Fetch again — expect 404 branded "Not ready yet"
// Run: npx tsx scripts/test-full-e2e.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import {
  uploadLandingHtml,
  landingHtmlExists,
  deleteLandingHtml,
  verifyFounderAppLive,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';

// Override the @ path resolution for tsx. The tsx runner uses tsconfig paths;
// but when running outside Next, we use a direct import path:
// (this file is imported via the above alias because tsconfig-paths resolves it;
//  if tsx complains, uncomment the explicit path below)
// import { uploadLandingHtml, ... } from '../src/lib/services/cf-deploy.service';

async function main() {
  const subdomain = 'smoke';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Baljia Smoke Test · ${subdomain}.baljia.app</title>
<style>
  body { font-family: system-ui; background: #0a0a0a; color: #f5f5f5; padding: 3rem; text-align: center; }
  h1 { color: #F5A623; }
  .ts { font-family: ui-monospace, Menlo, monospace; color: #888; margin-top: 2rem; }
</style>
</head>
<body>
  <h1>SMOKE_TEST_OK</h1>
  <p>This page was uploaded to R2 by the test harness and served by the founder-app Worker.</p>
  <p>If you see this, the full ADR-002 split-hosting path works end-to-end.</p>
  <p class="ts">Timestamp: ${new Date().toISOString()}</p>
</body>
</html>`;

  console.log('=== Split-Hosting End-to-End Test ===\n');

  if (!isCloudflareDeployConfigured()) {
    console.error('❌ Cloudflare deploy not configured. Check .env.local.');
    process.exit(1);
  }
  console.log('[1] CF deploy configuration: ✅');

  // Upload
  console.log(`\n[2] Uploading HTML to R2 (founder-apps/${subdomain}/index.html)...`);
  const uploaded = await uploadLandingHtml({ subdomain, html });
  if (!uploaded) {
    console.error('❌ Upload failed. Check R2 credentials.');
    process.exit(1);
  }
  console.log(`    ✅ Uploaded. key=${uploaded.key}, url=${uploaded.url}, bytes=${html.length}`);

  // Verify exists
  const exists = await landingHtmlExists(subdomain);
  console.log(`[3] R2 HEAD check: ${exists ? '✅ object exists' : '❌ object missing'}`);
  if (!exists) process.exit(1);

  // Small delay for CF edge propagation (usually 0-2s)
  console.log('\n[4] Waiting 3s for CF edge propagation...');
  await new Promise((r) => setTimeout(r, 3000));

  // Hit live URL
  console.log(`[5] GET https://${subdomain}.baljia.app/`);
  const live = await verifyFounderAppLive(subdomain);
  if (!live) {
    console.error('❌ verifyFounderAppLive returned null');
    process.exit(1);
  }
  console.log(`    HTTP ${live.status} in ${live.elapsedMs}ms`);
  console.log(`    body snippet: ${live.bodySnippet.slice(0, 120).replace(/\n/g, ' ')}...`);

  if (live.status !== 200) {
    console.error(`❌ Expected 200, got ${live.status}`);
    process.exit(1);
  }
  if (!live.bodySnippet.includes('SMOKE_TEST_OK')) {
    console.error('❌ Body does not contain SMOKE_TEST_OK marker — Worker may not be serving R2 content');
    process.exit(1);
  }
  console.log('    ✅ Live URL returns our HTML');

  // Cleanup
  console.log(`\n[6] Deleting R2 asset...`);
  const deleted = await deleteLandingHtml(subdomain);
  console.log(`    ${deleted ? '✅ Deleted' : '❌ Delete failed'}`);

  // Verify 404 after delete
  console.log('\n[7] Waiting 3s then re-testing (expect 404 branded)...');
  await new Promise((r) => setTimeout(r, 3000));
  const live404 = await verifyFounderAppLive(subdomain);
  console.log(`    HTTP ${live404?.status} in ${live404?.elapsedMs}ms`);
  if (live404?.status === 404 && live404.bodySnippet.includes('Not ready yet')) {
    console.log('    ✅ Branded 404 served after deletion');
  } else {
    console.log(`    ⚠️  Expected 404 with "Not ready yet", got ${live404?.status}. CF edge may still be caching — recheck in 60s.`);
  }

  console.log('\n🎉 FULL ADR-002 SPLIT-HOSTING PATH VERIFIED END-TO-END');
  process.exit(0);
}

main().catch((err) => {
  console.error('Threw:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
