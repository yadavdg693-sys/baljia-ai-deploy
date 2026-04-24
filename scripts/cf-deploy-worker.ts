// Direct Worker deploy via the classic Cloudflare Scripts API.
// Used as a bypass when wrangler's newer Services API fails on token scopes.
// Usage: npx tsx scripts/cf-deploy-worker.ts

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    console.error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID');
    process.exit(1);
  }

  const scriptName = 'baljia-founder-apps';
  const distPath = path.resolve(process.cwd(), 'founder-app-worker/dist/index.js');
  const scriptContent = fs.readFileSync(distPath, 'utf-8');
  console.log(`Bundle: ${distPath}`);
  console.log(`Bundle size: ${scriptContent.length} bytes`);

  const metadata = {
    main_module: 'index.js',
    bindings: [
      { type: 'r2_bucket', name: 'ASSETS', bucket_name: 'baljia-assets' },
      { type: 'plain_text', name: 'PLATFORM_API_BASE', text: 'https://baljia.ai' },
      { type: 'plain_text', name: 'LOG_LEVEL', text: 'info' },
    ],
    compatibility_date: '2025-03-01',
    compatibility_flags: ['nodejs_compat'],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append(
    'index.js',
    new Blob([scriptContent], { type: 'application/javascript+module' }),
    'index.js',
  );

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`;
  console.log(`\nPUT ${url}`);

  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  try {
    const json = JSON.parse(text);
    console.log(JSON.stringify(json, null, 2).slice(0, 2000));
    if (json.success) {
      console.log(`\n✅ Worker deployed: ${scriptName}`);
      console.log(`   etag: ${json.result?.etag ?? 'unknown'}`);
      console.log(`   modified_on: ${json.result?.modified_on ?? 'unknown'}`);
      process.exit(0);
    } else {
      console.error(`\n❌ Deploy failed`);
      process.exit(1);
    }
  } catch {
    console.error('(body not JSON):', text.slice(0, 500));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
