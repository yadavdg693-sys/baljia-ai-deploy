// Read the execution log for the most recent full-stack task
import { db, taskExecutions, tasks } from '@/lib/db';
import { desc, like, eq } from 'drizzle-orm';

void (async () => {
  const [t] = await db.select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(like(tasks.title, '%full stack%'))
    .orderBy(desc(tasks.created_at))
    .limit(1);

  if (!t) { console.error('No task found'); process.exit(1); }
  console.log('Task:', t.id, t.title);

  const [ex] = await db.select({ log: taskExecutions.execution_log })
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, t.id))
    .orderBy(desc(taskExecutions.created_at))
    .limit(1);

  if (!ex?.log) { console.log('No execution log found'); process.exit(0); }
  const log = typeof ex.log === 'string' ? JSON.parse(ex.log) : ex.log;
  console.log('\n--- EXECUTION LOG ---');
  for (const [i, entry] of (log as any[]).entries()) {
    console.log(`\n[${i + 1}]`, JSON.stringify(entry, null, 2).slice(0, 800));
  }
})();
