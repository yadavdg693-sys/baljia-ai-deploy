import { db, companies, documents } from '@/lib/db';
import { eq } from 'drizzle-orm';
(async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'bookmint')).limit(1);
  if (!c) { console.log('bookmint not found'); process.exit(0); }
  const docs = await db.select().from(documents).where(eq(documents.company_id, c.id));
  for (const d of docs) {
    const content = d.content ?? '';
    const leaks = ['Cloudflare', 'Cloudflare Worker', 'Hono', 'Neon', 'Worker-powered', 'HTTP driver', 'nodejs_compat'].filter(k => content.includes(k));
    console.log(`${d.doc_type.padEnd(20)} leaks: [${leaks.join(', ')}]`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
