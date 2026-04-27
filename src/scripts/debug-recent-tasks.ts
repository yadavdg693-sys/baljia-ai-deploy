// Quick check: list the most recent tasks for the Threadmint company.
// Run: npx tsx --env-file=.env.local src/scripts/debug-recent-tasks.ts

import { db, tasks, companies } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';

async function main() {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadmint')).limit(1);
  if (!c) { console.error('threadmint not found'); process.exit(1); }
  const recent = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status, source: tasks.source, created_at: tasks.created_at })
    .from(tasks)
    .where(eq(tasks.company_id, c.id))
    .orderBy(desc(tasks.created_at))
    .limit(10);
  console.log(`Most recent 10 tasks for ${c.name}:`);
  for (const t of recent) {
    const ts = t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at);
    console.log(`  ${ts}  [${t.status}/${t.source}]  ${t.title.slice(0, 80)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
