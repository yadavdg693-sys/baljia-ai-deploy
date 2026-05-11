import { db, tasks, companies } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }
  const all = await db.select().from(tasks).where(eq(tasks.company_id, c.id));
  for (const t of all) {
    console.log(`\n━━━ ${t.tag.toUpperCase()}: ${t.title} ━━━`);
    console.log(JSON.stringify(t.description));   // shows \n literal
    console.log('\n--- rendered ---');
    console.log(t.description);
  }
  process.exit(0);
})();
