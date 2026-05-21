import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

(async () => {
  await db.execute(sql`
    UPDATE tasks
    SET status = 'todo', started_at = NULL, completed_at = NULL
    WHERE id = 'ccb2a41a-afe6-4599-baa6-756a669ad490'
  `);
  await db.execute(sql`
    UPDATE task_executions
    SET status = 'failed', completed_at = NOW()
    WHERE task_id = 'ccb2a41a-afe6-4599-baa6-756a669ad490' AND status = 'running'
  `);
  // Verify final state
  const t = await db.execute(sql`SELECT id, status, execution_mode FROM tasks WHERE id = 'ccb2a41a-afe6-4599-baa6-756a669ad490'`);
  console.log('Reset:', JSON.stringify((t as any).rows?.[0] ?? (t as any)[0], null, 2));
})();
