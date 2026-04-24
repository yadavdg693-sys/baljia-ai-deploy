import { db, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const TASK_ID = process.argv[2];
  if (!TASK_ID) { console.error('Usage: <taskId>'); process.exit(1); }
  const execs = await db.select().from(taskExecutions).where(eq(taskExecutions.task_id, TASK_ID)).orderBy(desc(taskExecutions.started_at));
  for (const e of execs) {
    console.log('Execution:', e.id, 'status:', e.status, 'turns:', e.turn_count);
    const log = (e.execution_log as Array<Record<string, unknown>>) ?? [];
    console.log('log entries:', log.length);
    for (const entry of log) {
      const { turn, tool, event, result, error, input } = entry as any;
      if (tool) {
        const inp = JSON.stringify(input).slice(0, 80);
        const res = typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200);
        console.log(`  turn ${turn}: ${tool}(${inp}) → ${res}`);
      } else {
        console.log(`  turn ${turn}: ${event}`, error ?? '');
      }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
