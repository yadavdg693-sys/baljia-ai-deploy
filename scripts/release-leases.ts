import { db, tasks } from '@/lib/db';
import { and, eq, isNotNull } from 'drizzle-orm';

(async () => {
  const rows = await db.update(tasks)
    .set({ status: 'todo', lease_holder: null, lease_expires_at: null })
    .where(and(
      eq(tasks.status, 'in_progress'),
      isNotNull(tasks.lease_expires_at),
    ))
    .returning({ id: tasks.id, title: tasks.title });
  console.log('Released', rows.length, 'stranded lease(s):');
  for (const r of rows) console.log('  ', r.id.slice(0, 8), r.title);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
