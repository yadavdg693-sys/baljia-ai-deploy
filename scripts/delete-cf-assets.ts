// Delete Cloudflare-side assets for a set of founder subdomains.
// Covers: R2 objects under founder-apps/{subdomain}/*, the per-founder Worker
// script (baljia-app-{subdomain}), and the Worker route binding at
// {subdomain}.baljia.app/*.
//
// Run AFTER delete-test-companies.ts — DB cleanup removes company rows, this
// script removes the still-live CF footprint that the DB cleanup can't reach.
// That's why https://bookmint.baljia.app/ was still resolving after the DB wipe.

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const SUBDOMAINS_TO_DELETE = ['bookmint', 'pagegenie', 'amendly'];

const CF_API = 'https://api.cloudflare.com/client/v4';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

function cfHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${requireEnv('CLOUDFLARE_API_TOKEN')}` };
}

function getR2Client(): S3Client {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function deleteR2Prefix(subdomain: string): Promise<number> {
  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = getR2Client();
  const prefix = `founder-apps/${subdomain}/`;

  const listRes = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  const keys = (listRes.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);
  if (keys.length === 0) return 0;

  await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: keys.map((Key) => ({ Key })) },
  }));
  return keys.length;
}

async function deleteWorkerScript(scriptName: string): Promise<'deleted' | 'not_found' | 'failed'> {
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`,
    { method: 'DELETE', headers: cfHeaders() },
  );
  if (res.status === 404) return 'not_found';
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`    worker script delete failed for ${scriptName}: ${res.status} ${text.slice(0, 200)}`);
    return 'failed';
  }
  return 'deleted';
}

interface Route { id: string; pattern: string; script: string }

async function listWorkerRoutes(): Promise<Route[]> {
  const zoneId = requireEnv('CLOUDFLARE_ZONE_ID_APP');
  const res = await fetch(`${CF_API}/zones/${zoneId}/workers/routes`, { headers: cfHeaders() });
  if (!res.ok) throw new Error(`list routes failed: ${res.status}`);
  const data = (await res.json()) as { success: boolean; result?: Route[] };
  if (!data.success) throw new Error('list routes returned success=false');
  return data.result ?? [];
}

async function deleteWorkerRoute(routeId: string): Promise<boolean> {
  const zoneId = requireEnv('CLOUDFLARE_ZONE_ID_APP');
  const res = await fetch(
    `${CF_API}/zones/${zoneId}/workers/routes/${routeId}`,
    { method: 'DELETE', headers: cfHeaders() },
  );
  return res.ok;
}

async function main() {
  console.log(`Cleaning up CF assets for ${SUBDOMAINS_TO_DELETE.length} subdomains:`);
  for (const s of SUBDOMAINS_TO_DELETE) console.log(`  ${s}.baljia.app`);

  // List all Worker routes once so we can match by pattern per subdomain
  console.log('\nListing Worker routes...');
  const allRoutes = await listWorkerRoutes();
  console.log(`  Found ${allRoutes.length} total routes in zone`);

  for (const subdomain of SUBDOMAINS_TO_DELETE) {
    console.log(`\n─ ${subdomain} ─────────────`);

    // 1. R2 objects (Tier 1 landing + any Tier 2/3 static assets)
    try {
      const deleted = await deleteR2Prefix(subdomain);
      console.log(`  R2    deleted ${deleted} object(s) under founder-apps/${subdomain}/`);
    } catch (err) {
      console.error(`  R2    FAILED:`, err instanceof Error ? err.message : err);
    }

    // 2. Worker routes matching {subdomain}.baljia.app/*
    const matchingRoutes = allRoutes.filter((r) =>
      r.pattern === `${subdomain}.baljia.app/*` ||
      r.pattern === `${subdomain}.baljia.app/` ||
      r.pattern.startsWith(`${subdomain}.baljia.app`),
    );
    if (matchingRoutes.length === 0) {
      console.log(`  route no dedicated route for ${subdomain}.baljia.app (wildcard *.baljia.app serves it)`);
    } else {
      for (const r of matchingRoutes) {
        const ok = await deleteWorkerRoute(r.id);
        console.log(`  route ${ok ? '✓ deleted' : '✗ FAILED'} ${r.pattern} → ${r.script}`);
      }
    }

    // 3. Per-founder Worker script (Tier 2/3 only — may not exist)
    const scriptName = `baljia-app-${subdomain}`;
    const scriptResult = await deleteWorkerScript(scriptName);
    if (scriptResult === 'deleted') {
      console.log(`  worker ✓ deleted ${scriptName}`);
    } else if (scriptResult === 'not_found') {
      console.log(`  worker not present (${scriptName}) — Tier 1 subdomain, nothing to remove`);
    } else {
      console.log(`  worker ✗ failed to delete ${scriptName} (check logs above)`);
    }
  }

  console.log('\n✅ CF cleanup complete.');
  console.log('   Note: CF edge cache may serve stale content for a minute or two.');
  console.log('   Hard-refresh the browser or use a different network to confirm.');
  process.exit(0);
}

main().catch((err) => { console.error('\n❌ CF cleanup failed:', err); process.exit(1); });
