import { db, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

const TASK_ID = '9b000b79-a6bf-421e-a089-40fd2da7cddb';

void (async () => {
  const [exec] = await db.select({ execution_log: taskExecutions.execution_log })
    .from(taskExecutions).where(eq(taskExecutions.task_id, TASK_ID))
    .orderBy(desc(taskExecutions.started_at)).limit(1);
  const log = (exec?.execution_log ?? []) as Array<Record<string, unknown>>;

  for (const e of log) {
    if (e.tool === 'render_deploy' || e.tool === 'render_create_service' || e.tool === 'render_get_service' || e.tool === 'github_push_file' || e.tool === 'github_create_commit') {
      console.log(`\n>>> ${e.tool}`);
      console.log(`    input:  ${JSON.stringify(e.input).slice(0, 200)}`);
      console.log(`    result: ${String(e.result).slice(0, 400)}`);
    }
  }
  process.exit(0);
})();
