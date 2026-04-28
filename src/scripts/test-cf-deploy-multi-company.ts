// Reliability stress test: run terse engineering tasks against MULTIPLE test
// companies in parallel. Proves the deploy path isn't a one-time fluke and
// works across different task shapes.
//
// Each company gets a different task description (different feature shape).
// Worker-launcher enforces one slot per company, so each runs serially within
// its own company but companies run in parallel.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-cf-deploy-multi-company.ts

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

interface TestCase {
  slug: string;
  title: string;
  description: string;
  expectedFeature: string;        // What to grep in HTML to confirm it shipped
  expectedEndpoint: string;       // API endpoint to verify
}

const TEST_CASES: TestCase[] = [
  {
    slug: 'fluxora',
    title: 'Tiny waitlist app',
    description: 'Build a small app where visitors can join a waitlist by entering their email. Show a thank-you message after submitting. Add an API endpoint to view all waitlisted emails.',
    expectedFeature: '<form',
    expectedEndpoint: '/api/waitlist',
  },
  {
    slug: 'subsentry',
    title: 'Tiny feedback collector',
    description: 'Build a small app where visitors can submit feedback (a name field and a message field). Save submissions to the database. Add an admin endpoint to list all feedback.',
    expectedFeature: 'feedback',
    expectedEndpoint: '/api/feedback',
  },
  {
    slug: 'indieforge',
    title: 'Tiny survey responder',
    description: 'Build a small one-question survey at the root URL: "What feature do you want most?" with a text input. Save responses. Add an endpoint to view responses.',
    expectedFeature: 'survey',
    expectedEndpoint: '/api/responses',
  },
];

interface TaskResult {
  slug: string;
  title: string;
  taskId: string;
  status: string;
  turns: number;
  toolsUsed: string[];
  workerExists: boolean;
  workerBytes: number;
  liveUrlOk: boolean;
  hasFeature: boolean;
  endpointOk: boolean;
  passed: boolean;
  diagnostic: string;
}

async function runOne(testCase: TestCase): Promise<TaskResult> {
  const result: TaskResult = {
    slug: testCase.slug, title: testCase.title, taskId: '', status: 'unknown',
    turns: 0, toolsUsed: [], workerExists: false, workerBytes: 0,
    liveUrlOk: false, hasFeature: false, endpointOk: false, passed: false,
    diagnostic: '',
  };

  try {
    // 1. Find company
    const [company] = await db
      .select({ id: companies.id, slug: companies.slug })
      .from(companies)
      .where(and(eq(companies.slug, testCase.slug), isNotNull(companies.neon_connection_string)))
      .limit(1);
    if (!company) { result.diagnostic = `Company ${testCase.slug} not found`; return result; }

    // 2. Create + launch task
    const task = await taskService.createTask({
      company_id: company.id,
      title: testCase.title,
      description: testCase.description,
      tag: 'engineering',
      source: 'system',
      estimated_credits: 1,
      status: 'todo',
      authorized_by: 'system',
      assigned_to_agent_id: 30,
      max_turns: 35,
      created_by: company.id,
    });
    result.taskId = task.id;

    try {
      await launchTask(task.id);
    } catch (err) {
      result.diagnostic = `launchTask threw: ${err instanceof Error ? err.message : err}`;
    }

    // 3. Read final state
    const final = await taskService.getTask(task.id);
    result.status = final?.status ?? 'unknown';
    result.turns = final?.turn_count ?? 0;

    // 4. Read execution log
    const [exec] = await db
      .select({ execution_log: taskExecutions.execution_log })
      .from(taskExecutions)
      .where(eq(taskExecutions.task_id, task.id))
      .orderBy(desc(taskExecutions.created_at))
      .limit(1);
    if (exec?.execution_log) {
      const raw = exec.execution_log;
      let log: Array<{ tool?: string }> = [];
      if (typeof raw === 'string') { try { log = JSON.parse(raw); } catch {} }
      else if (Array.isArray(raw)) log = raw as typeof log;
      result.toolsUsed = [...new Set(log.map((e) => e.tool ?? '').filter(Boolean))];
    }

    // 5. Verify Worker
    const scriptName = `baljia-app-${testCase.slug}`;
    const workerSrc = await getWorkerScriptSource(scriptName);
    if (workerSrc) {
      result.workerExists = true;
      result.workerBytes = workerSrc.bytes;
    }

    // 6. Probe live URL
    if (result.workerExists) {
      try {
        const r = await fetch(`https://${testCase.slug}.baljia.app/`);
        if (r.ok) {
          const body = await r.text();
          result.liveUrlOk = true;
          result.hasFeature = new RegExp(testCase.expectedFeature, 'i').test(body) || /<form/i.test(body);
        }
      } catch {}
      try {
        const r2 = await fetch(`https://${testCase.slug}.baljia.app${testCase.expectedEndpoint}`);
        result.endpointOk = r2.status === 200;
      } catch {}
    }

    // 7. Determine pass
    result.passed = result.status === 'completed' && result.workerExists && result.liveUrlOk && result.hasFeature;
    if (!result.diagnostic) {
      if (!result.workerExists) result.diagnostic = 'No Worker deployed';
      else if (!result.liveUrlOk) result.diagnostic = 'Worker deployed but URL not OK';
      else if (!result.hasFeature) result.diagnostic = 'URL OK but expected feature not found in body';
      else if (result.status !== 'completed') result.diagnostic = `Verifier marked task ${result.status}`;
    }

    // Mark task rejected to keep dashboard clean
    await db.update(tasks).set({ status: 'rejected' }).where(eq(tasks.id, task.id));
  } catch (err) {
    result.diagnostic = `runOne threw: ${err instanceof Error ? err.message : err}`;
  }
  return result;
}

async function cleanup(slug: string) {
  const scriptName = `baljia-app-${slug}`;
  try {
    const cfApi = 'https://api.cloudflare.com/client/v4';
    const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
    const list = await fetch(`${cfApi}/zones/${zoneId}/workers/routes`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    });
    const j = await list.json() as { result?: Array<{ id: string; script: string }> };
    const route = (j.result ?? []).find((r) => r.script === scriptName);
    if (route) await deleteWorkerRoute(route.id);
    await deleteWorkerScript(scriptName);
  } catch {}
}

async function main() {
  console.log('═══ Multi-company reliability test ═══');
  console.log(`PRIMARY_LLM_PROVIDER: ${process.env.PRIMARY_LLM_PROVIDER ?? '(unset)'}`);
  console.log(`Test cases: ${TEST_CASES.length}\n`);

  if (!isCloudflareDeployConfigured()) { console.error('CF not configured'); process.exit(1); }

  // Run all in parallel — different companies, no slot contention
  const startAll = Date.now();
  const results = await Promise.all(TEST_CASES.map((tc) => {
    console.log(`▶ Starting: ${tc.slug} — ${tc.title}`);
    return runOne(tc);
  }));
  const elapsedAll = Math.round((Date.now() - startAll) / 1000);
  console.log(`\nAll ${TEST_CASES.length} tasks finished in ${elapsedAll}s\n`);

  // Print results table
  console.log('═══ RESULTS ═══\n');
  for (const r of results) {
    console.log(`── ${r.slug} (${r.title}) ──`);
    console.log(`  taskId:        ${r.taskId.slice(0, 8)}…`);
    console.log(`  final status:  ${r.status}  (turns=${r.turns})`);
    console.log(`  worker:        ${r.workerExists ? `${r.workerBytes}B` : 'NOT DEPLOYED'}`);
    console.log(`  live URL:      ${r.liveUrlOk ? 'OK' : '✗'}`);
    console.log(`  feature found: ${r.hasFeature ? '✓' : '✗'}`);
    console.log(`  endpoint OK:   ${r.endpointOk ? '✓' : '✗'}`);
    console.log(`  tools used:    ${r.toolsUsed.slice(0, 8).join(', ')}${r.toolsUsed.length > 8 ? '…' : ''}`);
    console.log(`  PASSED:        ${r.passed ? '✅ YES' : `❌ NO — ${r.diagnostic}`}`);
    console.log();
  }

  // Cleanup
  console.log('Cleanup...');
  await Promise.all(TEST_CASES.map((tc) => cleanup(tc.slug)));
  console.log('done.\n');

  const passCount = results.filter((r) => r.passed).length;
  console.log(`═══ ${passCount}/${TEST_CASES.length} passed ═══`);
  process.exit(passCount === TEST_CASES.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
