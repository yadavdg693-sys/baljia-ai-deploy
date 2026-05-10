// Show the agent's tool call sequence for a task — diagnose loop kills.
import { db, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

const TASK_ID = process.argv[2];
if (!TASK_ID) { console.error('usage: inspect-task-toolloop.ts <taskId>'); process.exit(1); }

void (async () => {
  const [exec] = await db.select({
    execution_log: taskExecutions.execution_log,
    watchdog_events: taskExecutions.watchdog_events,
  }).from(taskExecutions).where(eq(taskExecutions.task_id, TASK_ID))
    .orderBy(desc(taskExecutions.started_at)).limit(1);

  const log = (exec?.execution_log ?? []) as Array<Record<string, unknown>>;
  console.log('=== TOOL CALL SEQUENCE ===');
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (typeof e.tool === 'string') {
      const result = String(e.result ?? '').slice(0, 100).replace(/\s+/g, ' ');
      console.log(`  [${String(i + 1).padStart(3)}] ${(e.tool as string).padEnd(28)} → ${result}`);
    } else if (typeof e.event === 'string') {
      console.log(`  [${String(i + 1).padStart(3)}] EVENT: ${e.event} ${e.reason ?? ''}`);
    }
  }

  console.log('\n=== WATCHDOG EVENTS ===');
  const events = (exec?.watchdog_events ?? []) as Array<Record<string, unknown>>;
  for (const e of events) {
    console.log(`  [${e.type}] tool=${e.tool ?? '-'}  ${e.message}`);
  }
  process.exit(0);
})();
