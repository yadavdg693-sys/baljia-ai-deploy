// Measure first-shot engineering-task success rate against the locked
// envelope. Runs N engineering tasks back-to-back against a target
// company and reports:
//   - first-shot pass count (verifier passes on first run, no remediation)
//   - cost per task
//   - whether the agent called verify_user_journey, write_codebase_map,
//     read_known_issues (the new hard-gate / new memory wiring)
//   - whether the static_code_scan was clean
//
// Usage:
//   npx tsx --env-file=.env.local src/scripts/measure-success-rate.ts \
//     --company <slug-or-id> [--limit N] [--task "title|description|complexity"]
//
// Defaults to a small built-in task suite if no --task flags are passed.
//
// SAFETY: each task burns real API spend (typically $0.30 - $1.50). Default
// limit is 1 (pilot). Pass --limit 10 only after reviewing pilot output.

import * as taskService from '@/lib/services/task.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import { db, companies, tasks as tasksTable, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

interface SampleTask {
  title: string;
  description: string;
  complexity: number;
}

const DEFAULT_TASKS: SampleTask[] = [
  {
    title: 'Add /healthz endpoint',
    description:
      'Add a new HTTP route GET /healthz that returns 200 with the JSON body { ok: true, ts: <ISO timestamp> }. ' +
      'Public route (no auth). After deploying, run a verify_user_journey covering: ' +
      'GET /healthz returns 200 + body contains "ok":true. Update the codebase_map to include the new route.',
    complexity: 2,
  },
];

type RunResult = {
  task_id: string;
  title: string;
  complexity: number;
  status: string;            // task status after verifier
  verifier_passed: boolean;
  turn_count: number;
  cost_usd: number;
  cost_ceiling_usd: number | null;
  called_verify_user_journey: boolean;
  called_write_codebase_map: boolean;
  called_read_known_issues: boolean;
  called_static_code_scan: boolean;
  static_scan_clean: boolean;
  failure_reason: string | null;
};

function parseArgs(): { company: string | null; limit: number; tasks: SampleTask[] } {
  const args = process.argv.slice(2);
  let company: string | null = null;
  let limit = 1;
  const tasks: SampleTask[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--company') company = args[++i];
    else if (args[i] === '--limit') limit = Math.max(1, parseInt(args[++i], 10) || 1);
    else if (args[i] === '--task') {
      const [title, description, complexity] = args[++i].split('|');
      tasks.push({ title, description, complexity: parseInt(complexity, 10) || 3 });
    }
  }
  return { company, limit, tasks: tasks.length > 0 ? tasks : DEFAULT_TASKS };
}

async function resolveCompanyId(input: string): Promise<string> {
  // Accept either a UUID id or a slug.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(input)) return input;
  const [c] = await db.select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, input))
    .limit(1);
  if (!c) throw new Error(`No company found with slug "${input}"`);
  return c.id;
}

async function loadExecutionDetails(taskId: string) {
  const [execution] = await db.select({
    execution_log: taskExecutions.execution_log,
    turn_count: taskExecutions.turn_count,
    token_usage: taskExecutions.token_usage,
    status: taskExecutions.status,
  })
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, taskId))
    .orderBy(desc(taskExecutions.started_at))
    .limit(1);
  return execution ?? null;
}

function calledTool(log: unknown[], toolName: string): boolean {
  return log.some((e) => typeof e === 'object' && e !== null && (e as Record<string, unknown>).tool === toolName);
}

function staticScanClean(log: unknown[]): boolean {
  for (const e of log) {
    if (typeof e !== 'object' || e === null) continue;
    const entry = e as Record<string, unknown>;
    if (entry.tool === 'static_code_scan' && typeof entry.result === 'string') {
      if (/STATIC SCAN PASS\b|high=0\b/.test(entry.result)) return true;
    }
  }
  return false;
}

async function runOne(companyId: string, sample: SampleTask): Promise<RunResult> {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Task: ${sample.title}`);
  console.log(`Complexity: ${sample.complexity}`);

  const created = await taskService.createTask({
    company_id: companyId,
    title: sample.title,
    description: sample.description,
    tag: 'engineering',
    priority: 50,           // mid-priority integer
    estimated_credits: 1,
    complexity: sample.complexity,
    source: 'system',
    authorized_by: 'measurement_script',
    authorization_reason: 'measure-success-rate',
  } as never);

  console.log(`Task created: ${created.id}`);
  const startedAt = Date.now();

  let result: RunResult = {
    task_id: created.id,
    title: sample.title,
    complexity: sample.complexity,
    status: 'unknown',
    verifier_passed: false,
    turn_count: 0,
    cost_usd: 0,
    cost_ceiling_usd: null,
    called_verify_user_journey: false,
    called_write_codebase_map: false,
    called_read_known_issues: false,
    called_static_code_scan: false,
    static_scan_clean: false,
    failure_reason: null,
  };

  try {
    const execution = await launchTask(created.id, { subscriptionFunded: true });
    result.status = execution.status;
    result.turn_count = execution.turn_count ?? 0;
  } catch (err) {
    result.failure_reason = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ launchTask threw: ${result.failure_reason}`);
  }

  // Re-read task + execution AFTER verifier has run
  const finalTask = await taskService.getTask(created.id);
  const exec = await loadExecutionDetails(created.id);

  if (finalTask) {
    result.status = finalTask.status;
    result.verifier_passed = finalTask.status === 'completed';
  }
  if (exec) {
    result.turn_count = exec.turn_count ?? result.turn_count;
    const tokenUsage = exec.token_usage as { cost_usd?: number; ceiling_usd?: number | null } | null;
    if (tokenUsage) {
      result.cost_usd = tokenUsage.cost_usd ?? 0;
      result.cost_ceiling_usd = tokenUsage.ceiling_usd ?? null;
    }
    const log = (exec.execution_log ?? []) as unknown[];
    result.called_verify_user_journey = calledTool(log, 'verify_user_journey');
    result.called_write_codebase_map  = calledTool(log, 'write_codebase_map');
    result.called_read_known_issues   = calledTool(log, 'read_known_issues');
    result.called_static_code_scan    = calledTool(log, 'static_code_scan');
    result.static_scan_clean          = staticScanClean(log);
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`  status=${result.status}  passed=${result.verifier_passed}  turns=${result.turn_count}  cost=$${result.cost_usd.toFixed(4)}/${result.cost_ceiling_usd ?? '?'}  elapsed=${elapsed}s`);
  console.log(`  tools: journey=${result.called_verify_user_journey} codebase_map_write=${result.called_write_codebase_map} known_issues=${result.called_read_known_issues} static_scan=${result.called_static_code_scan}(clean=${result.static_scan_clean})`);
  if (result.failure_reason) console.log(`  ✗ reason: ${result.failure_reason}`);

  return result;
}

void (async () => {
  const { company, limit, tasks } = parseArgs();
  if (!company) {
    console.error('Usage: --company <slug-or-id> [--limit N] [--task "title|description|complexity"]');
    process.exit(2);
  }

  const companyId = await resolveCompanyId(company);
  const [comp] = await db.select({
    slug: companies.slug, lifecycle: companies.lifecycle,
    render_service_id: companies.render_service_id, github_repo: companies.github_repo,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Target: ${comp?.slug ?? '?'} (${companyId})`);
  console.log(`Lifecycle: ${comp?.lifecycle}  Render: ${comp?.render_service_id ?? '(none)'}  Repo: ${comp?.github_repo ?? '(none)'}`);
  console.log(`Tasks queued: ${Math.min(limit, tasks.length)} of ${tasks.length} available`);

  const results: RunResult[] = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    const r = await runOne(companyId, tasks[i]);
    results.push(r);
  }

  // Summary
  const passed = results.filter((r) => r.verifier_passed).length;
  const totalCost = results.reduce((s, r) => s + r.cost_usd, 0);
  const journeyRate     = results.filter((r) => r.called_verify_user_journey).length / results.length;
  const codebaseMapRate = results.filter((r) => r.called_write_codebase_map).length / results.length;
  const knownIssuesRate = results.filter((r) => r.called_read_known_issues).length / results.length;
  const staticScanRate  = results.filter((r) => r.called_static_code_scan).length / results.length;

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`First-shot pass:    ${passed}/${results.length}  (${Math.round(passed / results.length * 100)}%)`);
  console.log(`Total cost:         $${totalCost.toFixed(4)}`);
  console.log(`verify_user_journey: ${Math.round(journeyRate * 100)}% of tasks`);
  console.log(`write_codebase_map:  ${Math.round(codebaseMapRate * 100)}% of tasks`);
  console.log(`read_known_issues:   ${Math.round(knownIssuesRate * 100)}% of tasks`);
  console.log(`static_code_scan:    ${Math.round(staticScanRate * 100)}% of tasks`);

  process.exit(passed === results.length ? 0 : 1);
})();
