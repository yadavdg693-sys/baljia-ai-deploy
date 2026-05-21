import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

(async () => {
  const taskId = process.argv[2];
  if (!taskId) {
    console.error('usage: kill-task.ts <taskId> [reason]');
    process.exit(1);
  }
  const reason = process.argv.slice(3).join(' ') || 'manually killed - stale canary run after platform blocker identified';

  await db.execute(sql`
    UPDATE tasks
    SET status = 'failed'
    WHERE id = ${taskId}
  `);
  await db.execute(sql`
    UPDATE task_executions
    SET status = 'failed', completed_at = NOW(), error_summary = ${reason}
    WHERE task_id = ${taskId} AND status = 'running'
  `);
  console.log(`Killed task ${taskId}: ${reason}`);
})();
