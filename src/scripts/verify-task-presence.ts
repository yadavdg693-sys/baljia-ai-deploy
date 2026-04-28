// Standalone script to check if task 5788e0c8 exists in the DB.
// Run: npx tsx --env-file=.env.local src/scripts/verify-task-presence.ts

import { db, tasks, companies, platformFeedback } from '@/lib/db';
import { eq, like, sql, desc } from 'drizzle-orm';

async function main() {
  // 1. Check the specific task ID from the original bug
  const [t] = await db.select().from(tasks)
    .where(eq(tasks.id, '5788e0c8-2b84-4869-8f0a-86c3d9a103c8'))
    .limit(1);
  console.log('Original bug task in DB:', t ? 'YES' : 'NO');
  if (t) {
    console.log('  company_id:', t.company_id);
    console.log('  status:', t.status);
    console.log('  created_at:', t.created_at);
    console.log('  source:', t.source);
    console.log('  authorized_by:', t.authorized_by);
    const [c] = await db.select({ slug: companies.slug, name: companies.name })
      .from(companies).where(eq(companies.id, t.company_id)).limit(1);
    console.log('  company:', c?.slug, '/', c?.name);
  }

  // 2. Look for tasks with similar title to bug description ("Build User Authentication Page")
  console.log('\nTasks with title matching "User Auth%":');
  const auth = await db.select({
    id: tasks.id, title: tasks.title, status: tasks.status, source: tasks.source,
    company_id: tasks.company_id, created_at: tasks.created_at,
  }).from(tasks).where(like(tasks.title, '%User Auth%')).orderBy(desc(tasks.created_at)).limit(5);
  for (const r of auth) {
    console.log(`  ${r.id.slice(0, 8)}…  ${r.status.padEnd(15)} ${r.source}  "${r.title}"  ${r.created_at}`);
  }

  // 3. Show the bug report's full description for context
  console.log('\nOriginal bug report description (full):');
  const [bug] = await db.select().from(platformFeedback)
    .where(sql`${platformFeedback.title} ILIKE '%not appearing%'`).limit(1);
  if (bug) {
    console.log(`  title: ${bug.title}`);
    console.log(`  description: ${bug.description}`);
    console.log(`  reporter (company_id): ${bug.company_id}`);
    const [reporter] = await db.select({ slug: companies.slug }).from(companies).where(eq(companies.id, bug.company_id)).limit(1);
    console.log(`  reporter slug: ${reporter?.slug}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
