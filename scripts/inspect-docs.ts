import { db, companies, documents } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

(async () => {
  const cs = await db.select({ id: companies.id, name: companies.name, slug: companies.slug, onboarding_status: companies.onboarding_status })
    .from(companies).orderBy(desc(companies.created_at)).limit(3);
  for (const c of cs) {
    console.log(`\n=== ${c.name} (${c.slug}) — onboarding: ${c.onboarding_status} ===`);
    const ds = await db.select().from(documents).where(eq(documents.company_id, c.id));
    if (!ds.length) { console.log('  (no documents)'); continue; }
    for (const d of ds) {
      const len = (d.content ?? '').length;
      console.log(`  ${d.doc_type.padEnd(20)} | is_empty=${d.is_empty} | v${d.version} | ${len}B | "${d.title ?? '(no title)'}"`);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
