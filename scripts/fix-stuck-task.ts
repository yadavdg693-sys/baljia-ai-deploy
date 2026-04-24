import { db, tasks } from '@/lib/db';
import { eq } from 'drizzle-orm';

(async () => {
  const r = await db.update(tasks).set({
    status: 'failed_permanent',
    failure_class: 'scope_overflow',
    lease_holder: null,
    lease_expires_at: null,
    completed_at: new Date(),
  }).where(eq(tasks.id, '7e40d4cb-8840-4d6d-80cd-a6b51e99ffbe')).returning({id: tasks.id, status: tasks.status});
  console.log('marked failed_permanent:', r.length);
  for (const row of r) console.log('  ', row.id.slice(0,8), '→', row.status);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
