// Inventory everything we'd wipe in a "start fresh" reset. Read-only — prints
// counts and lists so the user can decide scope before any destructive script runs.

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { neon } from '@neondatabase/serverless';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const CF_API = 'https://api.cloudflare.com/client/v4';

function env(name: string): string | undefined { return process.env[name]; }
function req(name: string): string {
  const v = env(name); if (!v) throw new Error(`${name} not set`); return v;
}

async function neonInventory() {
  const sql = neon(req('DATABASE_URL'));
  const [companies] = (await sql`SELECT COUNT(*)::int AS n FROM companies`) as Array<{ n: number }>;
  const [users] = (await sql`SELECT COUNT(*)::int AS n FROM users`) as Array<{ n: number }>;
  const [tasks] = (await sql`SELECT COUNT(*)::int AS n FROM tasks`) as Array<{ n: number }>;
  const [docs] = (await sql`SELECT COUNT(*)::int AS n FROM documents`) as Array<{ n: number }>;
  const [emails] = (await sql`SELECT COUNT(*)::int AS n FROM email_threads`) as Array<{ n: number }>;
  const [events] = (await sql`SELECT COUNT(*)::int AS n FROM platform_events`) as Array<{ n: number }>;
  const [chat] = (await sql`SELECT COUNT(*)::int AS n FROM chat_sessions`) as Array<{ n: number }>;
  const [ledger] = (await sql`SELECT COUNT(*)::int AS n FROM credit_ledger`) as Array<{ n: number }>;
  const [memory] = (await sql`SELECT COUNT(*)::int AS n FROM memory_layers`) as Array<{ n: number }>;
  const [learnings] = (await sql`SELECT COUNT(*)::int AS n FROM learnings`) as Array<{ n: number }>;
  const [tweets] = (await sql`SELECT COUNT(*)::int AS n FROM tweets`) as Array<{ n: number }>;
  const [reports] = (await sql`SELECT COUNT(*)::int AS n FROM reports`) as Array<{ n: number }>;
  const [subs] = (await sql`SELECT COUNT(*)::int AS n FROM subscriptions`) as Array<{ n: number }>;
  const [roadmaps] = (await sql`SELECT COUNT(*)::int AS n FROM roadmaps`) as Array<{ n: number }>;
  const companyList = (await sql`
    SELECT slug, name, onboarding_status, lifecycle, plan_tier, company_stage, created_at
    FROM companies ORDER BY created_at DESC
  `) as Array<{ slug: string; name: string; onboarding_status: string; lifecycle: string; plan_tier: string; company_stage: string; created_at: Date }>;
  const userList = (await sql`
    SELECT email, created_at FROM users ORDER BY created_at DESC
  `) as Array<{ email: string; created_at: Date }>;
  return {
    counts: {
      users: users.n, companies: companies.n, tasks: tasks.n, documents: docs.n,
      email_threads: emails.n, platform_events: events.n, chat_sessions: chat.n,
      credit_ledger: ledger.n, memory_layers: memory.n, learnings: learnings.n,
      tweets: tweets.n, reports: reports.n, subscriptions: subs.n, roadmaps: roadmaps.n,
    },
    companies: companyList,
    users: userList,
  };
}

async function r2Inventory() {
  const accountId = env('R2_ACCOUNT_ID');
  if (!accountId) return { configured: false as const };
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: req('R2_ACCESS_KEY_ID'),
      secretAccessKey: req('R2_SECRET_ACCESS_KEY'),
    },
  });
  const bucket = req('R2_BUCKET_NAME');
  const listRes = await client.send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: 'founder-apps/',
  }));
  const objects = (listRes.Contents ?? []).map((o) => ({ key: o.Key!, size: o.Size ?? 0 }));
  const bySubdomain = new Map<string, { count: number; totalBytes: number }>();
  for (const o of objects) {
    const sub = o.key.split('/')[1] ?? '(root)';
    const agg = bySubdomain.get(sub) ?? { count: 0, totalBytes: 0 };
    agg.count++; agg.totalBytes += o.size;
    bySubdomain.set(sub, agg);
  }
  return { configured: true as const, total: objects.length, bySubdomain: Array.from(bySubdomain.entries()) };
}

async function workersInventory() {
  const accountId = env('CLOUDFLARE_ACCOUNT_ID');
  const token = env('CLOUDFLARE_API_TOKEN');
  if (!accountId || !token) return { configured: false as const };
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { configured: true as const, error: `list failed: ${res.status}` };
  const data = (await res.json()) as { result?: Array<{ id: string; created_on: string; modified_on: string }> };
  const all = data.result ?? [];
  const founderScripts = all.filter((s) => s.id.startsWith('baljia-app-'));
  return { configured: true as const, total: all.length, allScripts: all.map((s) => s.id), founderScripts };
}

async function routesInventory() {
  const zoneId = env('CLOUDFLARE_ZONE_ID_APP');
  const token = env('CLOUDFLARE_API_TOKEN');
  if (!zoneId || !token) return { configured: false as const };
  const res = await fetch(`${CF_API}/zones/${zoneId}/workers/routes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { configured: true as const, error: `list failed: ${res.status}` };
  const data = (await res.json()) as { result?: Array<{ id: string; pattern: string; script: string }> };
  const all = data.result ?? [];
  const founderRoutes = all.filter((r) => r.pattern.includes('.baljia.app') && !r.pattern.startsWith('*.baljia.app'));
  return { configured: true as const, total: all.length, allRoutes: all, founderRoutes };
}

async function main() {
  console.log('━━━ NEON DB ━━━━━━━━━━━━━━━━━━━━━━━');
  const neonData = await neonInventory();
  console.log('Counts:');
  for (const [k, v] of Object.entries(neonData.counts)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log(`\nUsers (${neonData.users.length}):`);
  for (const u of neonData.users) console.log(`  ${u.email.padEnd(40)} ${new Date(u.created_at).toISOString().slice(0, 10)}`);
  console.log(`\nCompanies (${neonData.companies.length}):`);
  for (const c of neonData.companies) {
    const created = new Date(c.created_at).toISOString().slice(0, 10);
    console.log(`  ${c.slug.padEnd(20)} ${c.name.padEnd(28)} ${c.onboarding_status.padEnd(14)} ${c.lifecycle.padEnd(14)} ${c.plan_tier.padEnd(8)} ${created}`);
  }

  console.log('\n━━━ CLOUDFLARE R2 ━━━━━━━━━━━━━━━━━');
  const r2Data = await r2Inventory();
  if (!r2Data.configured) {
    console.log('  R2 not configured — skipping');
  } else {
    console.log(`  Total objects under founder-apps/: ${r2Data.total}`);
    console.log(`  By subdomain:`);
    for (const [sub, agg] of r2Data.bySubdomain) {
      const kb = (agg.totalBytes / 1024).toFixed(1);
      console.log(`    ${sub.padEnd(20)} ${String(agg.count).padStart(3)} objects, ${kb} KB`);
    }
  }

  console.log('\n━━━ CLOUDFLARE WORKERS ━━━━━━━━━━━━');
  const workerData = await workersInventory();
  if (!workerData.configured) {
    console.log('  CF not configured — skipping');
  } else if ('error' in workerData) {
    console.log(`  ERROR: ${workerData.error}`);
  } else {
    console.log(`  Total Worker scripts in account: ${workerData.total}`);
    console.log(`  Founder-app scripts (baljia-app-*): ${workerData.founderScripts.length}`);
    for (const s of workerData.founderScripts) console.log(`    ${s.id}`);
    if (workerData.allScripts.length <= 20) {
      console.log(`  All scripts:`);
      for (const s of workerData.allScripts) console.log(`    ${s}`);
    }
  }

  console.log('\n━━━ CLOUDFLARE ROUTES ━━━━━━━━━━━━━');
  const routeData = await routesInventory();
  if (!routeData.configured) {
    console.log('  CF zone not configured — skipping');
  } else if ('error' in routeData) {
    console.log(`  ERROR: ${routeData.error}`);
  } else {
    console.log(`  Total routes in zone: ${routeData.total}`);
    console.log(`  Founder-app routes (non-wildcard on baljia.app): ${routeData.founderRoutes.length}`);
    for (const r of routeData.founderRoutes) console.log(`    ${r.pattern.padEnd(40)} → ${r.script}`);
    if (routeData.allRoutes.length <= 20) {
      console.log(`  All routes:`);
      for (const r of routeData.allRoutes) console.log(`    ${r.pattern.padEnd(40)} → ${r.script}`);
    }
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
