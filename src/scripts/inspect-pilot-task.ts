// Read the pilot task's execution log + verifier checks to see WHY it failed.
import { db, taskExecutions, tasks } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

const TASK_ID = process.argv[2] ?? '9b000b79-a6bf-421e-a089-40fd2da7cddb';

void (async () => {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, TASK_ID)).limit(1);
  console.log(`Task: ${task?.title}  status=${task?.status}  failure_class=${task?.failure_class}`);

  const [exec] = await db.select({
    execution_log: taskExecutions.execution_log,
    verification_evidence: taskExecutions.verification_evidence,
    error_summary: taskExecutions.error_summary,
    watchdog_events: taskExecutions.watchdog_events,
  }).from(taskExecutions).where(eq(taskExecutions.task_id, TASK_ID)).orderBy(desc(taskExecutions.started_at)).limit(1);

  if (!exec) { console.log('no execution found'); process.exit(1); }

  console.log('\n=== VERIFIER CHECKS ===');
  const v = exec.verification_evidence as { passed?: boolean; checks?: Array<{ name: string; passed: boolean; detail: string }> } | null;
  for (const c of v?.checks ?? []) {
    console.log(`  ${c.passed ? '✓' : '✗'} ${c.name}`);
    if (!c.passed) console.log(`    ${c.detail}`);
  }

  console.log('\n=== STATIC SCAN OUTPUT ===');
  const log = (exec.execution_log ?? []) as Array<Record<string, unknown>>;
  for (const e of log) {
    if (e.tool === 'static_code_scan') {
      console.log(String(e.result));
    }
  }

  console.log('\n=== KNOWN-ISSUES CALLS (context + result) ===');
  for (const e of log) {
    if (e.tool === 'read_known_issues') {
      console.log(`> context: ${JSON.stringify(e.input)}`);
      console.log(`< ${String(e.result).slice(0, 300)}`);
    }
  }

  console.log('\n=== JOURNEY CALLS ===');
  for (const e of log) {
    if (e.tool === 'verify_user_journey') {
      console.log(`> ${JSON.stringify(e.input).slice(0, 200)}`);
      console.log(`< ${String(e.result).slice(0, 400)}`);
    }
  }

  console.log('\n=== WRITE_CODEBASE_MAP CALL ===');
  for (const e of log) {
    if (e.tool === 'write_codebase_map') {
      console.log(`< ${String(e.result).slice(0, 200)}`);
    }
  }

  process.exit(0);
})();
