import { db } from '@/lib/db/client';
import { sql } from 'drizzle-orm';

(async () => {
  const ex = await db.execute(sql`
    SELECT execution_log
    FROM task_executions
    WHERE task_id = 'ccb2a41a-afe6-4599-baa6-756a669ad490'
    ORDER BY started_at DESC
    LIMIT 1
  `);
  const exec = ((ex as any).rows ?? (ex as any))[0];
  const log = (exec.execution_log ?? []) as any[];
  // Get the last design_critique result in full
  const critiques = log.filter((l: any) => l.tool === 'design_critique');
  console.log(`Found ${critiques.length} design_critique call(s):`);
  for (const c of critiques) {
    console.log(`\n=== turn ${c.turn} ===`);
    console.log(c.result);
  }
})();
