// Quick check: does a specific task UUID exist?
// Run: npx tsx --env-file=.env.local src/scripts/debug-task-by-id.ts <uuid>

import { db, tasks, platformEvents } from '@/lib/db';
import { eq, desc, and, gt } from 'drizzle-orm';

async function main() {
  const ids = process.argv.slice(2);
  for (const id of ids) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    console.log(`Lookup ${id}: ${t ? 'FOUND' : 'NOT FOUND'}`);
    if (t) console.log(`  title=${t.title} | status=${t.status} | source=${t.source} | company=${t.company_id}`);
  }

  // Last 5 task_created events with company_id
  const recent = await db
    .select({ payload: platformEvents.payload, ts: platformEvents.created_at, company_id: platformEvents.company_id })
    .from(platformEvents)
    .where(eq(platformEvents.event_type, 'task_created'))
    .orderBy(desc(platformEvents.created_at))
    .limit(5);
  console.log('\nLast 5 task_created events:');
  for (const e of recent) {
    const p = e.payload as Record<string, unknown>;
    const ts = e.ts instanceof Date ? e.ts.toISOString() : String(e.ts);
    console.log(`  ${ts}  company=${e.company_id}  task=${p.task_id}  title=${String(p.title ?? '').slice(0, 50)}`);
  }

  // Search the tasks table for ANY E2E-DEBUG row, regardless of company
  console.log('\nAll tasks with title LIKE %E2E-DEBUG%:');
  const debugRows = await db.select({ id: tasks.id, title: tasks.title, company_id: tasks.company_id, status: tasks.status, created_at: tasks.created_at })
    .from(tasks)
    .where(gt(tasks.created_at, new Date(Date.now() - 24 * 3600 * 1000)))
    .orderBy(desc(tasks.created_at))
    .limit(15);
  for (const r of debugRows) {
    if (r.title.includes('E2E-DEBUG') || r.title.includes('DEBUG') || r.title.includes('TEST_E2E')) {
      const ts = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
      console.log(`  ${ts}  ${r.status}  company=${r.company_id}  title=${r.title}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
