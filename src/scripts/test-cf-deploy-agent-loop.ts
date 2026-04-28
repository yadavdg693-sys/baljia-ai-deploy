// Agent-loop integration test — does the engineering agent actually ship a
// working full-stack app to Cloudflare when given a real task?
//
// What this exercises end-to-end:
//   1. Task creation + authorization (system source, no founder needed)
//   2. launchTask → engineering agent assembles ContextPacket, dispatches
//   3. Agent prompt's "skills first" mandate → list_skills + read_skill
//      ('build-fullstack-cf-app') → applies the verified pattern
//   4. Agent generates Worker source → cf_deploy_app → Worker live on
//      {slug}.baljia.app
//   5. Agent calls cf_verify_founder_app → confirms 200
//   6. We then independently curl the deployed endpoints from outside the
//      agent loop to confirm the founder's customer would actually see
//      working JSON
//
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-deploy-agent-loop.ts
//
// The test picks a real test company with a provisioned Neon DB. The agent
// will deploy a Worker at that company's actual subdomain, so don't run this
// against a production-looking company unless you intend to overwrite its
// app. Cleanup at the end deletes the deployed Worker + its route.

import { db, companies, tasks } from '@/lib/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import {
  deleteWorkerScript,
  deleteWorkerRoute,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';

const PREFERRED_SLUG = 'plinqa';  // pick a less-trafficked test company
const TASK_TITLE = 'Agent-loop CF integration: ship a tiny signup app';
const TASK_DESCRIPTION = `
Ship a tiny full-stack signup app to {COMPANY_SUBDOMAIN}.baljia.app on Cloudflare Workers.

Requirements:
- GET /api/health → 200 with { ok: true, db_now: <timestamp from Neon> }
- POST /api/signup with JSON { email, name } → 201, INSERTs into a "signups" table on the company's Neon DB, returns the inserted row
- GET /api/signups → 200 with { ok: true, signups: [...], count: N } reading from the same table

You MUST follow the skills mandate: call list_skills first, then read_skill for build-fullstack-cf-app and any others that apply. Use the verified pattern from build-fullstack-cf-app — single-file Worker, raw fetch to Neon's HTTP /sql endpoint, no @neondatabase/serverless import (cf_deploy_app has no bundler).

Steps:
1. Read skills (list_skills + read_skill build-fullstack-cf-app + read_skill cloudflare-workers + read_skill neon-postgres if it helps)
2. Verify Neon DB is provisioned (get_company_tech)
3. Create the "signups" table via query_company_db: CREATE TABLE IF NOT EXISTS signups (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())
4. Generate the Worker source using the canonical template from the skill
5. Call cf_deploy_app with with_neon_db: true
6. Call cf_verify_founder_app to confirm 200
7. Report: deploy URL, table created (yes/no), endpoints exposed, any verification gaps

Do NOT call github_push_file or any other source-of-truth-changing tools. The script_content goes straight to CF; no repo writes are needed for this task.
`.trim();

interface RunSummary {
  taskId: string;
  status: string;
  turnCount: number | null;
  failureClass: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

async function pickCompany(): Promise<{ id: string; name: string; slug: string }> {
  // Prefer a specific slug to keep tests reproducible
  const [pref] = await db
    .select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies)
    .where(and(
      eq(companies.slug, PREFERRED_SLUG),
      isNotNull(companies.neon_connection_string),
    ))
    .limit(1);
  if (pref?.id) return { id: pref.id, name: pref.name ?? PREFERRED_SLUG, slug: pref.slug ?? PREFERRED_SLUG };

  // Fallback to any provisioned company
  const [any] = await db
    .select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies)
    .where(and(
      isNotNull(companies.neon_connection_string),
      isNotNull(companies.slug),
      eq(companies.onboarding_status, 'completed'),
    ))
    .limit(1);
  if (!any?.id) throw new Error('No companies with provisioned Neon DB available');
  return { id: any.id, name: any.name ?? 'test', slug: any.slug ?? 'test' };
}

async function main() {
  console.log('═══ Agent-Loop CF Integration Test ═══\n');

  if (!isCloudflareDeployConfigured()) {
    console.error('❌ CF deploy not configured');
    process.exit(1);
  }

  const company = await pickCompany();
  const subdomain = company.slug;
  const scriptName = `baljia-app-${subdomain}`;
  console.log(`Company: ${company.name} [${company.slug}] ${company.id}`);
  console.log(`Target:  https://${subdomain}.baljia.app`);
  console.log(`Script:  ${scriptName}\n`);

  // 1. Create a task scoped to this company
  console.log('1. Creating engineering task...');
  const task = await taskService.createTask({
    company_id: company.id,
    title: TASK_TITLE,
    description: TASK_DESCRIPTION.replace('{COMPANY_SUBDOMAIN}', subdomain),
    tag: 'engineering',
    source: 'system',
    estimated_credits: 1,
    status: 'todo',
    authorized_by: 'system',  // pre-approved so launchTask claims the slot
    assigned_to_agent_id: 30,  // engineering agent
    max_turns: 40,             // capped for cost
    created_by: company.id,    // synthetic test attribution
  });
  console.log(`   ✓ Task ${task.id} created\n`);

  // 2. Launch the agent loop
  console.log('2. Launching agent (this will take 2-10 min, watch the activity below)...\n');
  const startedAt = Date.now();
  let agentError: Error | null = null;
  try {
    await launchTask(task.id);
  } catch (err) {
    agentError = err instanceof Error ? err : new Error(String(err));
    console.log(`   ⚠ launchTask threw: ${agentError.message}\n`);
  }
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`   ✓ Agent loop returned after ${elapsedSec}s\n`);

  // 3. Read final task state
  const final = await taskService.getTask(task.id);
  const summary: RunSummary = {
    taskId: task.id,
    status: final?.status ?? 'unknown',
    turnCount: final?.turn_count ?? null,
    failureClass: final?.failure_class ?? null,
    startedAt: final?.started_at?.toString() ?? null,
    completedAt: final?.completed_at?.toString() ?? null,
  };
  console.log('3. Final task state:');
  console.log(`   status=${summary.status}  turns=${summary.turnCount}  failure_class=${summary.failureClass ?? 'none'}\n`);

  // 4. Independent verification — does the deployed app actually work?
  console.log('4. Independent endpoint verification (curl from outside the agent loop):\n');
  const base = `https://${subdomain}.baljia.app`;
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];

  try {
    const res = await fetch(`${base}/api/health`);
    const body = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    const pass = res.status === 200 && data.ok === true;
    checks.push({ name: 'GET /api/health', pass, detail: `HTTP ${res.status} ${body.slice(0, 200)}` });
    console.log(`   GET /api/health     ${pass ? '✓' : '✗'}  HTTP ${res.status}  ${body.slice(0, 200)}`);
  } catch (err) {
    checks.push({ name: 'GET /api/health', pass: false, detail: (err as Error).message });
    console.log(`   GET /api/health     ✗  fetch error: ${(err as Error).message}`);
  }

  const testEmail = `agentloop+${Date.now()}@baljia.test`;
  try {
    const res = await fetch(`${base}/api/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: testEmail, name: 'AgentLoop User' }),
    });
    const body = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    const pass = (res.status === 200 || res.status === 201) && data.ok === true;
    checks.push({ name: 'POST /api/signup', pass, detail: `HTTP ${res.status} ${body.slice(0, 200)}` });
    console.log(`   POST /api/signup    ${pass ? '✓' : '✗'}  HTTP ${res.status}  ${body.slice(0, 200)}`);
  } catch (err) {
    checks.push({ name: 'POST /api/signup', pass: false, detail: (err as Error).message });
    console.log(`   POST /api/signup    ✗  fetch error: ${(err as Error).message}`);
  }

  try {
    const res = await fetch(`${base}/api/signups`);
    const body = await res.text();
    let data: { signups?: Array<{ email: string }>; count?: number } = {};
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    const found = (data.signups ?? []).some((s) => s.email === testEmail);
    const pass = res.status === 200 && found;
    checks.push({ name: 'GET /api/signups', pass, detail: `count=${data.count} includes-test=${found}` });
    console.log(`   GET /api/signups    ${pass ? '✓' : '✗'}  HTTP ${res.status}  count=${data.count ?? '?'} includes-test=${found}`);
  } catch (err) {
    checks.push({ name: 'GET /api/signups', pass: false, detail: (err as Error).message });
    console.log(`   GET /api/signups    ✗  fetch error: ${(err as Error).message}`);
  }

  const allEndpointsPass = checks.every((c) => c.pass);
  const overallPass = summary.status === 'completed' && allEndpointsPass;
  console.log(`\n${overallPass ? '═══ ✅ AGENT-LOOP TEST PASSED ═══' : '═══ ❌ AGENT-LOOP TEST FAILED ═══'}`);
  console.log(`   Task status: ${summary.status} (turns=${summary.turnCount})`);
  console.log(`   Endpoints:   ${checks.filter(c => c.pass).length}/${checks.length} passed`);
  if (!overallPass) {
    if (summary.status !== 'completed') console.log(`   → task did not complete; failure_class=${summary.failureClass}`);
    for (const c of checks.filter((c) => !c.pass)) console.log(`   → ${c.name}: ${c.detail}`);
  }

  // 5. Cleanup — delete the deployed worker + route, mark task as rejected
  // (we keep the test rows for audit; they'll show up in test-runtime inspection)
  console.log('\n5. Cleanup...');
  // Find the route for this subdomain
  try {
    const ok = await deleteWorkerScript(scriptName);
    console.log(`   delete worker script: ${ok ? '✓' : '⚠ not found'}`);
  } catch (e) {
    console.log(`   delete worker script: ⚠ ${e instanceof Error ? e.message : e}`);
  }
  // Cleanup route — best-effort: list-then-delete
  try {
    const cfApi = 'https://api.cloudflare.com/client/v4';
    const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
    const list = await fetch(`${cfApi}/zones/${zoneId}/workers/routes`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN!}` },
    });
    const j = await list.json() as { result?: Array<{ id: string; pattern: string; script: string }> };
    const match = (j.result ?? []).find((r) => r.script === scriptName);
    if (match) {
      const ok = await deleteWorkerRoute(match.id);
      console.log(`   delete worker route ${match.pattern}: ${ok ? '✓' : '⚠'}`);
    } else {
      console.log(`   delete worker route: (no route for ${scriptName})`);
    }
  } catch (e) {
    console.log(`   delete worker route: ⚠ ${e instanceof Error ? e.message : e}`);
  }
  // Soft-delete the test task so the dashboard isn't polluted
  try {
    await db.update(tasks).set({ status: 'rejected' }).where(eq(tasks.id, task.id));
    console.log(`   reject task: ✓`);
  } catch (e) {
    console.log(`   reject task: ⚠ ${e instanceof Error ? e.message : e}`);
  }
  // Drop the signups table the agent created (best-effort — needs the company's Neon URL)
  try {
    const [c] = await db.select({ neon: companies.neon_connection_string }).from(companies).where(eq(companies.id, company.id)).limit(1);
    if (c?.neon) {
      const { neon: neonClient } = await import('@neondatabase/serverless');
      const sql = neonClient(c.neon);
      await sql`DROP TABLE IF EXISTS signups`;
      console.log(`   drop signups table: ✓`);
    }
  } catch (e) {
    console.log(`   drop signups table: ⚠ ${e instanceof Error ? e.message : e}`);
  }

  process.exit(overallPass ? 0 : 1);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
