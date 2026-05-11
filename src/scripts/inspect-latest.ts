import { db, tasks, companies } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  console.log('company one_liner:', c.one_liner);
  console.log('company mission:', c.mission?.slice(0, 200));
  const ts = await db.select().from(tasks).where(eq(tasks.company_id, c.id));
  for (const t of ts) {
    console.log('---');
    console.log('TITLE:', t.title);
    console.log('DESC:');
    console.log(t.description);
  }
  process.exit(0);
})();
