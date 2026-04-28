// Stress test: queryforge-style failure mode.
// Task description is INTENTIONALLY TERSE — no canonical Worker template
// inlined, no skill name mentioned. The agent MUST rely on list_skills +
// read_skill to discover the pattern. If those fail, the deploy fails.
// This is the test that proves whether the dispatcher fix (a8a87d1)
// actually saves us in the real-world case.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-deploy-agent-loop-terse.ts

import { db, companies, tasks, taskExecutions } from '@/lib/db';
import { and, eq, isNotNull, desc } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import {
  getWorkerScriptSource,
  deleteWorkerScript,
  deleteWorkerRoute,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';

const PREFERRED_SLUG = 'plinqa';  // 100 credits + starter tier (30/day cap)

// Terse task — what a real founder would actually type, NOT a verbose
// implementation guide. Mirrors how queryforge's "Build campaign draft
// generator from URL and docs" was phrased.
const TERSE_TASK_TITLE = 'Build a tiny contact form app';
const TERSE_TASK_DESCRIPTION = `Build a small app at {SUBDOMAIN}.baljia.app where visitors can submit their name and email through a simple HTML form, and we can see the submissions via an API endpoint.`.trim();

async function pickCompany() {
  const [c] = await db
    .select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies)
    .where(and(
      eq(companies.slug, PREFERRED_SLUG),
      isNotNull(companies.neon_connection_string),
    ))
    .limit(1);
  if (!c) throw new Error(`Test company ${PREFERRED_SLUG} not found or has no Neon DB`);
  return c;
}

async function main() {
  console.log('═══ Agent-Loop Terse Test (queryforge-shape failure mode) ═══\n');

  if (!isCloudflareDeployConfigured()) { console.error('❌ CF not configured'); process.exit(1); }

  // Confirm primary provider is what user expects
  console.log(`PRIMARY_LLM_PROVIDER: ${process.env.PRIMARY_LLM_PROVIDER ?? '(unset → openai default)'}\n`);

  const company = await pickCompany();
  const subdomain = company.slug!;
  const scriptName = `baljia-app-${subdomain}`;
  console.log(`Company: ${company.name} (${subdomain}) — ${company.id}`);
  console.log(`Target:  https://${subdomain}.baljia.app\n`);

  let exitCode = 0;
  let cleanupCfWorker = false;

  try {
    // 1. Create task
    console.log('1. Creating engineering task with TERSE description...');
    console.log(`   "${TERSE_TASK_DESCRIPTION}"\n`);
    const task = await taskService.createTask({
      company_id: company.id,
      title: TERSE_TASK_TITLE,
      description: TERSE_TASK_DESCRIPTION.replace('{SUBDOMAIN}', subdomain),
      tag: 'engineering',
      source: 'system',
      estimated_credits: 1,
      status: 'todo',
      authorized_by: 'system',
      assigned_to_agent_id: 30,
      max_turns: 40,
      created_by: company.id,
    });
    console.log(`   ✓ Task ${task.id}\n`);

    // 2. Run agent loop
    console.log('2. Launching agent (this will take 2-10 min)...\n');
    const start = Date.now();
    try {
      await launchTask(task.id);
    } catch (err) {
      console.log(`   ⚠ launchTask threw: ${err instanceof Error ? err.message : err}\n`);
    }
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    console.log(`   Agent loop returned after ${elapsedSec}s\n`);

    // 3. Final task state
    const final = await taskService.getTask(task.id);
    console.log('3. Final task state:');
    console.log(`   status:        ${final?.status}`);
    console.log(`   turns:         ${final?.turn_count}`);
    console.log(`   failure_class: ${final?.failure_class ?? '(none)'}\n`);

    // 4. Did the agent actually call cf_deploy_app?
    const [exec] = await db
      .select({ execution_log: taskExecutions.execution_log })
      .from(taskExecutions)
      .where(eq(taskExecutions.task_id, task.id))
      .orderBy(desc(taskExecutions.created_at))
      .limit(1);

    let log: Array<{ tool?: string; turn?: number; result?: string }> = [];
    if (exec?.execution_log) {
      const raw = exec.execution_log;
      if (typeof raw === 'string') { try { log = JSON.parse(raw); } catch {} }
      else if (Array.isArray(raw)) log = raw as typeof log;
    }
    const tools = log.map((e) => e.tool ?? '').filter(Boolean);
    const toolCounts: Record<string, number> = {};
    for (const t of tools) toolCounts[t] = (toolCounts[t] ?? 0) + 1;

    console.log(`4. Tool calls: ${tools.length} total`);
    console.log('   Frequency:');
    for (const [t, n] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${t.padEnd(30)} ${n}`);
    }

    // 5. Critical checks
    const skillToolsCalled = (toolCounts['list_skills'] ?? 0) + (toolCounts['read_skill'] ?? 0);
    const skillToolsErrored = log.some((e) =>
      (e.tool === 'list_skills' || e.tool === 'read_skill') &&
      typeof e.result === 'string' && e.result.includes('Unknown tool'));
    const deployCalled = (toolCounts['cf_deploy_app'] ?? 0);

    console.log(`\n5. Critical checks:`);
    console.log(`   skill tools called:  ${skillToolsCalled} ${skillToolsCalled > 0 ? '✓' : '✗ (agent never tried)'}`);
    console.log(`   skill tools errored: ${skillToolsErrored ? '✗ STILL BROKEN' : '✓ (or not called)'}`);
    console.log(`   cf_deploy_app calls: ${deployCalled} ${deployCalled > 0 ? '✓' : '✗ (no deploy)'}`);

    // 6. Verify worker actually deployed
    const workerSrc = await getWorkerScriptSource(scriptName);
    console.log(`\n6. CF Worker post-task: ${workerSrc ? `EXISTS (${workerSrc.bytes}B)` : 'NOT DEPLOYED'}`);
    cleanupCfWorker = !!workerSrc;

    // 7. Independent endpoint verification
    if (workerSrc) {
      console.log(`\n7. Probe live endpoints:`);
      const base = `https://${subdomain}.baljia.app`;
      try {
        const r = await fetch(base);
        const body = await r.text();
        const hasForm = /<form/i.test(body) || /input.*name=.{1,3}name/i.test(body);
        console.log(`   GET /        HTTP ${r.status}  has-form: ${hasForm ? '✓' : '✗'}  ${body.length}B`);
      } catch (e) { console.log(`   GET /        ✗ ${e instanceof Error ? e.message : e}`); }
    } else {
      console.log(`\n7. (skipped — no Worker to probe)`);
    }

    const overallPass = deployCalled > 0 && final?.status === 'completed' && !skillToolsErrored;
    console.log(`\n${overallPass ? '═══ ✅ TERSE-TASK PATH WORKS ═══' : '═══ ❌ TERSE-TASK PATH STILL BROKEN ═══'}`);
    if (!overallPass) {
      exitCode = 1;
      if (skillToolsErrored) console.log('   → skill tools still erroring; dispatcher fix incomplete');
      if (deployCalled === 0) console.log('   → agent never called cf_deploy_app; deeper issue (model? prompt? skill content?)');
      if (final?.status !== 'completed') console.log(`   → task ended in status=${final?.status} (good — verifier rejected the no-op)`);
    }

    // Mark task as rejected to keep the dashboard clean
    await db.update(tasks).set({ status: 'rejected' }).where(eq(tasks.id, task.id));
  } finally {
    console.log('\n8. Cleanup...');
    if (cleanupCfWorker) {
      try {
        const cfApi = 'https://api.cloudflare.com/client/v4';
        const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
        const list = await fetch(`${cfApi}/zones/${zoneId}/workers/routes`, {
          headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
        });
        const j = await list.json() as { result?: Array<{ id: string; script: string }> };
        const route = (j.result ?? []).find((r) => r.script === scriptName);
        if (route) {
          await deleteWorkerRoute(route.id);
          console.log(`   route delete: ✓`);
        }
        await deleteWorkerScript(scriptName);
        console.log(`   script delete: ✓`);
      } catch (e) { console.log(`   cleanup err: ${e instanceof Error ? e.message : e}`); }
    }
  }

  process.exit(exitCode);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
