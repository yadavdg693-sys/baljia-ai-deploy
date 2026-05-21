// scripts/reset-stuck-tasks.ts — reset in_progress tasks that have no active worker
// Usage: npx tsx src/scripts/reset-stuck-tasks.ts [companyId]
import './load-env-local';
import { db, tasks } from '@/lib/db';
import { and, eq, inArray } from 'drizzle-orm';

const companyId = process.argv[2];

void (async () => {
  const conditions = [inArray(tasks.status, ['in_progress' as const])];
  if (companyId) conditions.push(eq(tasks.company_id, companyId));

  const stuck = await db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(and(...conditions));
  console.log(`Found ${stuck.length} in_progress tasks`);
  for (const t of stuck) {
    console.log(`  Resetting: ${t.id} — "${t.title.slice(0, 50)}"`);
    await db.update(tasks).set({ status: 'todo' }).where(eq(tasks.id, t.id));
  }
  console.log('Done.');
  process.exit(0);
})();
