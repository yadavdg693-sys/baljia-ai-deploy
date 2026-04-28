// Why did the most recent research task fail despite calling web_search?
import { db, tasks, taskExecutions } from '@/lib/db';
import { eq, desc, and, inArray } from 'drizzle-orm';

async function main() {
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.assigned_to_agent_id, 29), inArray(tasks.status, ['failed', 'failed_permanent'])))
    .orderBy(desc(tasks.created_at)).limit(1);
  if (!task) { console.log('no failed research task'); process.exit(0); }

  console.log(`task: ${task.title}`);
  console.log(`tag: ${task.tag}, status: ${task.status}, turns: ${task.turn_count}`);
  console.log(`failure_class: ${task.failure_class}, verification_level: ${task.verification_level}`);

  const [exec] = await db.select().from(taskExecutions)
    .where(eq(taskExecutions.task_id, task.id))
    .orderBy(desc(taskExecutions.created_at)).limit(1);
  if (!exec) { console.log('no execution'); process.exit(0); }

  console.log(`\nexec status: ${exec.status}, wall=${exec.wall_clock_seconds}s`);
  if (exec.error_summary) console.log(`error_summary: ${exec.error_summary.slice(0, 300)}`);
  if (exec.verification_evidence) {
    console.log(`\nverification_evidence:`);
    console.log(JSON.stringify(exec.verification_evidence, null, 2).slice(0, 1500));
  }

  let log: Array<{ tool?: string; turn?: number; input?: unknown; result?: string }> = [];
  if (typeof exec.execution_log === 'string') { try { log = JSON.parse(exec.execution_log); } catch {} }
  else if (Array.isArray(exec.execution_log)) log = exec.execution_log as typeof log;

  console.log(`\nfull execution_log (${log.length} entries):`);
  for (const e of log) {
    const inputStr = e.input ? JSON.stringify(e.input).slice(0, 80) : '';
    const resultStr = (e.result ?? '').toString().slice(0, 200).replace(/\n/g, ' ');
    console.log(`  T${e.turn} ${e.tool?.padEnd(20)} input=${inputStr}`);
    console.log(`    → ${resultStr}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
