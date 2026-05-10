import { db, companies, documents } from '@/lib/db';
import { desc, eq, and } from 'drizzle-orm';

void (async () => {
  const [latest] = await db.select({
    id: companies.id, slug: companies.slug, name: companies.name, lifecycle: companies.lifecycle,
    one_liner: companies.one_liner, created_at: companies.created_at,
  }).from(companies).orderBy(desc(companies.created_at)).limit(1);

  if (!latest) { console.log('No companies'); process.exit(0); }
  console.log(`Latest company: ${latest.slug} (${latest.name})`);
  console.log(`  Created: ${latest.created_at}`);
  console.log(`  One-liner: ${latest.one_liner ?? '—'}`);
  console.log('');

  const [mr] = await db.select().from(documents).where(and(
    eq(documents.company_id, latest.id),
    eq(documents.doc_type, 'market_research'),
  )).limit(1);

  if (!mr) { console.log('No market_research document'); process.exit(0); }
  console.log(`market_research doc (v${mr.version}, ${mr.content?.length ?? 0} chars):\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(mr.content);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
})();
