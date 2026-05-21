import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';
import { engineeringCompletionGate } from '@/lib/agents/agent-factory';

const taskId = process.argv[2];
if (!taskId) {
  console.error('usage: replay-canary-gate.ts <taskId>');
  process.exit(1);
}

void (async () => {
  const rows = await db.execute(sql`
    SELECT t.title, t.description, t.tag, te.execution_log
    FROM tasks t
    JOIN task_executions te ON te.task_id = t.id
    WHERE t.id = ${taskId}
    ORDER BY te.started_at DESC
    LIMIT 1
  `);

  const row = ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? rows as unknown as Array<Record<string, unknown>>)[0];
  if (!row) {
    console.error(`No execution found for ${taskId}`);
    process.exit(1);
  }

  const rawLog = row.execution_log;
  const log = typeof rawLog === 'string' ? JSON.parse(rawLog) : rawLog;
  const reason = engineeringCompletionGate(30, log as Record<string, unknown>[], {
    title: String(row.title ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    tag: typeof row.tag === 'string' ? row.tag : null,
  } as never);

  console.log(JSON.stringify({ reason }, null, 2));
})();
