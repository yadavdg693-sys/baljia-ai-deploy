import { db, tasks } from '@/lib/db';
import { eq, and, inArray } from 'drizzle-orm';

const COMPANY = '7542b090-42cb-483b-8f14-7a3f7ce5c5f4';
const TASK = '29b983cc-aa75-4de6-82d5-61cc4a054634';

async function main() {
  const freed = await db.update(tasks)
    .set({ status: 'failed', failure_class: 'scope_overflow', completed_at: new Date() })
    .where(and(eq(tasks.company_id, COMPANY), inArray(tasks.status, ['in_progress', 'verifying'])))
    .returning({ id: tasks.id });
  console.log('freed in-progress:', freed.length);

  const reset = await db.update(tasks)
    .set({ status: 'todo', started_at: null, completed_at: null, turn_count: 0, failure_class: null, actual_credits_charged: 0 })
    .where(eq(tasks.id, TASK))
    .returning({ id: tasks.id, status: tasks.status });
  console.log('reset task:', reset);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
