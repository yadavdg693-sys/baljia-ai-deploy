// Full reset — wipe all test data (DB + Cloudflare) and start fresh.
//
// KEEPS:
//   - 3 users: yadavdg4@gmail.com, yadavdg3@gmail.com, system@baljia.ai
//   - All platform infrastructure: agents, mcp_servers, mcp_tools, agent_tool_mounts
//   - Wildcard Worker (baljia-founder-apps) and its route *.baljia.app/*
//   - Any non-baljia-app-* Worker script (e.g. jolly-lab-5d00)
//
// DELETES:
//   - All companies and every row that references them
//   - All test user accounts (everyone except the 3 kept) and their magic-link
//     tokens + user sessions (ON DELETE CASCADE handles both)
//   - Every baljia-app-* Worker script + its route binding
//   - Every R2 object under founder-apps/* (already empty, but kept in loop)
//
// Order:
//   Phase A: inventory + confirmation baseline
//   Phase B: CF cleanup (idempotent — 404 means "already gone")
//   Phase C: DB company wipe (FK-ordered cascade)
//   Phase D: DB user wipe (null out waitlist refs, then delete)
//   Phase E: post-verification

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { neon } from '@neondatabase/serverless';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const CF_API = 'https://api.cloudflare.com/client/v4';

const KEEP_USER_EMAILS = [
  'yadavdg4@gmail.com',
  'yadavdg3@gmail.com',
  'system@baljia.ai',
];

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env.local`);
  return v;
}

function cfHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${req('CLOUDFLARE_API_TOKEN')}` };
}

// ─────────────────────────────────────────────────
// CF: list + delete per-founder Worker scripts + routes
// ─────────────────────────────────────────────────
interface CfRoute { id: string; pattern: string; script: string }

async function listCfScripts(): Promise<string[]> {
  const accountId = req('CLOUDFLARE_ACCOUNT_ID');
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts`, { headers: cfHeaders() });
  if (!res.ok) throw new Error(`list scripts failed: ${res.status}`);
  const data = (await res.json()) as { result?: Array<{ id: string }> };
  return (data.result ?? []).map((s) => s.id);
}

async function listCfRoutes(): Promise<CfRoute[]> {
  const zoneId = req('CLOUDFLARE_ZONE_ID_APP');
  const res = await fetch(`${CF_API}/zones/${zoneId}/workers/routes`, { headers: cfHeaders() });
  if (!res.ok) throw new Error(`list routes failed: ${res.status}`);
  const data = (await res.json()) as { result?: CfRoute[] };
  return data.result ?? [];
}

async function deleteCfScript(name: string): Promise<'deleted' | 'not_found' | 'failed'> {
  const accountId = req('CLOUDFLARE_ACCOUNT_ID');
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`,
    { method: 'DELETE', headers: cfHeaders() },
  );
  if (res.status === 404) return 'not_found';
  if (!res.ok) return 'failed';
  return 'deleted';
}

async function deleteCfRoute(routeId: string): Promise<boolean> {
  const zoneId = req('CLOUDFLARE_ZONE_ID_APP');
  const res = await fetch(
    `${CF_API}/zones/${zoneId}/workers/routes/${routeId}`,
    { method: 'DELETE', headers: cfHeaders() },
  );
  return res.ok;
}

async function purgeR2FounderApps(): Promise<number> {
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) return 0;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: req('R2_ACCESS_KEY_ID'),
      secretAccessKey: req('R2_SECRET_ACCESS_KEY'),
    },
  });
  const bucket = req('R2_BUCKET_NAME');
  let total = 0;
  let continuationToken: string | undefined;
  do {
    const listRes = await client.send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: 'founder-apps/', ContinuationToken: continuationToken,
    }));
    const keys = (listRes.Contents ?? []).map((o) => o.Key!).filter(Boolean);
    if (keys.length > 0) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }));
      total += keys.length;
    }
    continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
  } while (continuationToken);
  return total;
}

// ─────────────────────────────────────────────────
// DB: wipe one company's entire graph (FK-ordered)
// ─────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wipeCompanyGraph(sql: any, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const steps: Array<[string, () => Promise<unknown>]> = [
    // Tables with task_id FK — must run before we delete tasks
    ['task_executions', () => sql`DELETE FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['task_failure_links', () => sql`DELETE FROM task_failure_links WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['artifacts', () => sql`DELETE FROM artifacts WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['approval_records', () => sql`DELETE FROM approval_records WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['runs', () => sql`DELETE FROM runs WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['sessions', () => sql`DELETE FROM sessions WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['runtime_ai_costs', () => sql`DELETE FROM runtime_ai_costs WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['refund_history (via tasks)', () => sql`DELETE FROM refund_history WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['learnings (via tasks)', () => sql`DELETE FROM learnings WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['reports (via tasks)', () => sql`DELETE FROM reports WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['credit_ledger (via tasks)', () => sql`DELETE FROM credit_ledger WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['tweets (via tasks)', () => sql`DELETE FROM tweets WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    ['document_suggestions (via tasks)', () => sql`DELETE FROM document_suggestions WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))`],
    // Documents + dependents
    ['document_suggestions (via documents)', () => sql`DELETE FROM document_suggestions WHERE document_id IN (SELECT id FROM documents WHERE company_id = ANY(${ids}))`],
    // Company-scoped tables
    ['tasks', () => sql`DELETE FROM tasks WHERE company_id = ANY(${ids})`],
    ['documents', () => sql`DELETE FROM documents WHERE company_id = ANY(${ids})`],
    ['memory_layers', () => sql`DELETE FROM memory_layers WHERE company_id = ANY(${ids})`],
    ['learnings (via company)', () => sql`DELETE FROM learnings WHERE company_id = ANY(${ids})`],
    ['credit_ledger', () => sql`DELETE FROM credit_ledger WHERE company_id = ANY(${ids})`],
    ['reports', () => sql`DELETE FROM reports WHERE company_id = ANY(${ids})`],
    ['refund_history', () => sql`DELETE FROM refund_history WHERE company_id = ANY(${ids})`],
    ['revenue_ledger', () => sql`DELETE FROM revenue_ledger WHERE company_id = ANY(${ids})`],
    ['ad_spend_ledger', () => sql`DELETE FROM ad_spend_ledger WHERE company_id = ANY(${ids})`],
    ['ad_campaigns', () => sql`DELETE FROM ad_campaigns WHERE company_id = ANY(${ids})`],
    ['recurring_tasks', () => sql`DELETE FROM recurring_tasks WHERE company_id = ANY(${ids})`],
    ['night_shift_cycles', () => sql`DELETE FROM night_shift_cycles WHERE company_id = ANY(${ids})`],
    ['email_threads', () => sql`DELETE FROM email_threads WHERE company_id = ANY(${ids})`],
    ['contacts', () => sql`DELETE FROM contacts WHERE company_id = ANY(${ids})`],
    ['browser_credentials', () => sql`DELETE FROM browser_credentials WHERE company_id = ANY(${ids})`],
    ['chat_sessions', () => sql`DELETE FROM chat_sessions WHERE company_id = ANY(${ids})`],
    ['platform_events', () => sql`DELETE FROM platform_events WHERE company_id = ANY(${ids})`],
    ['dashboard_links', () => sql`DELETE FROM dashboard_links WHERE company_id = ANY(${ids})`],
    ['platform_feedback', () => sql`DELETE FROM platform_feedback WHERE company_id = ANY(${ids})`],
    ['tweets', () => sql`DELETE FROM tweets WHERE company_id = ANY(${ids})`],
    ['roadmaps (cascades milestones)', () => sql`DELETE FROM roadmaps WHERE company_id = ANY(${ids})`],
    ['subscriptions', () => sql`DELETE FROM subscriptions WHERE company_id = ANY(${ids})`],
    // Finally companies
    ['companies', () => sql`DELETE FROM companies WHERE id = ANY(${ids})`],
  ];

  for (const [label, run] of steps) {
    try {
      await run();
      console.log(`    ✓ ${label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('does not exist')) {
        console.log(`    - ${label} (table missing, skipped)`);
        continue;
      }
      console.error(`    ✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────
// DB: delete test user accounts
// Waitlist FK is nullable with no cascade — null it out before delete.
// magic_link_tokens and user_sessions are ON DELETE CASCADE — auto-cleaned.
// ─────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wipeTestUsers(sql: any, idsToDelete: string[]): Promise<void> {
  if (idsToDelete.length === 0) return;
  await sql`UPDATE waitlist SET converted_user_id = NULL WHERE converted_user_id = ANY(${idsToDelete})`;
  console.log(`    ✓ waitlist.converted_user_id → NULL`);
  await sql`DELETE FROM users WHERE id = ANY(${idsToDelete})`;
  console.log(`    ✓ users (magic_link_tokens + user_sessions cascade)`);
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────
async function main() {
  const sql = neon(req('DATABASE_URL'));

  console.log('═══ PHASE A — Baseline ═══════════════════════════');
  const companies = (await sql`SELECT id, slug, name FROM companies ORDER BY slug`) as Array<{ id: string; slug: string; name: string }>;
  const allUsers = (await sql`SELECT id, email FROM users ORDER BY email`) as Array<{ id: string; email: string }>;
  const testUsers = allUsers.filter((u) => !KEEP_USER_EMAILS.includes(u.email));
  const keptUsers = allUsers.filter((u) => KEEP_USER_EMAILS.includes(u.email));

  console.log(`  ${companies.length} companies → DELETE ALL`);
  for (const c of companies) console.log(`    - ${c.slug} (${c.id})`);
  console.log(`  ${keptUsers.length} users → KEEP`);
  for (const u of keptUsers) console.log(`    ✓ ${u.email}`);
  console.log(`  ${testUsers.length} users → DELETE`);
  for (const u of testUsers) console.log(`    - ${u.email}`);

  console.log('\n═══ PHASE B — Cloudflare cleanup ═════════════════');
  const r2Deleted = await purgeR2FounderApps();
  console.log(`  R2: purged ${r2Deleted} object(s) under founder-apps/`);

  const allRoutes = await listCfRoutes();
  const founderRoutes = allRoutes.filter((r) =>
    r.pattern.includes('.baljia.app') && !r.pattern.startsWith('*.baljia.app'),
  );
  console.log(`  Worker routes: ${founderRoutes.length} founder route(s) to delete`);
  for (const r of founderRoutes) {
    const ok = await deleteCfRoute(r.id);
    console.log(`    ${ok ? '✓' : '✗'} ${r.pattern} → ${r.script}`);
  }

  const allScripts = await listCfScripts();
  const founderScripts = allScripts.filter((s) => s.startsWith('baljia-app-'));
  console.log(`  Worker scripts: ${founderScripts.length} founder script(s) to delete`);
  for (const s of founderScripts) {
    const result = await deleteCfScript(s);
    console.log(`    ${result === 'deleted' ? '✓' : result === 'not_found' ? '-' : '✗'} ${s} (${result})`);
  }

  console.log('\n═══ PHASE C — DB company wipe ════════════════════');
  if (companies.length === 0) {
    console.log('  (no companies to delete)');
  } else {
    await wipeCompanyGraph(sql, companies.map((c) => c.id));
  }

  console.log('\n═══ PHASE D — DB user wipe ═══════════════════════');
  if (testUsers.length === 0) {
    console.log('  (no test users to delete)');
  } else {
    await wipeTestUsers(sql, testUsers.map((u) => u.id));
  }

  console.log('\n═══ PHASE E — Post-reset verification ════════════');
  const [{ n: companiesLeft }] = (await sql`SELECT COUNT(*)::int AS n FROM companies`) as Array<{ n: number }>;
  const [{ n: usersLeft }] = (await sql`SELECT COUNT(*)::int AS n FROM users`) as Array<{ n: number }>;
  const [{ n: tasksLeft }] = (await sql`SELECT COUNT(*)::int AS n FROM tasks`) as Array<{ n: number }>;
  const [{ n: docsLeft }] = (await sql`SELECT COUNT(*)::int AS n FROM documents`) as Array<{ n: number }>;
  const [{ n: eventsLeft }] = (await sql`SELECT COUNT(*)::int AS n FROM platform_events`) as Array<{ n: number }>;
  console.log(`  companies       = ${companiesLeft} (expected 0)`);
  console.log(`  users           = ${usersLeft} (expected ${keptUsers.length})`);
  console.log(`  tasks           = ${tasksLeft} (expected 0)`);
  console.log(`  documents       = ${docsLeft} (expected 0)`);
  console.log(`  platform_events = ${eventsLeft} (expected 0)`);

  const remaining = (await sql`SELECT email FROM users ORDER BY email`) as Array<{ email: string }>;
  console.log(`  remaining users:`);
  for (const r of remaining) console.log(`    ${r.email}`);

  console.log('\n✅ Full reset complete. Database + Cloudflare are fresh.');
  console.log('   Log in with yadavdg4@gmail.com and start onboarding from scratch.');
  process.exit(0);
}

main().catch((err) => { console.error('\n❌ Reset failed:', err); process.exit(1); });
