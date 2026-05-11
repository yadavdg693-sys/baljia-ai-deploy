// Show every doc_type in the documents table for the latest company.
// Used to confirm internal types (codebase_map) are present in DB but
// filtered out by the dashboard API.
import { db, companies, documents } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }
  console.log(`Company: ${c.id} (${c.slug ?? '?'})`);

  const docs = await db.select().from(documents).where(eq(documents.company_id, c.id));
  console.log(`\n${docs.length} documents in DB:`);
  for (const d of docs) {
    const len = d.content?.length ?? 0;
    console.log(`  - ${d.doc_type}${d.is_empty ? ' (empty)' : ''}  ${len} chars  v${d.version}`);
  }
  process.exit(0);
})();
