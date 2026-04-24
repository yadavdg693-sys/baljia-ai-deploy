import { db, companies, emailThreads } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
(async () => {
  const cs = await db.select({ name: companies.name, slug: companies.slug, id: companies.id, email_identity: companies.email_identity, company_email: companies.company_email })
    .from(companies).orderBy(desc(companies.created_at)).limit(3);
  for (const c of cs) {
    console.log(c.name, '|', c.slug, '|', 'email_identity:', c.email_identity ?? 'NULL', '|', 'company_email:', c.company_email ?? 'NULL');
    const threads = await db.select().from(emailThreads).where(eq(emailThreads.company_id, c.id));
    console.log('  threads:', threads.length);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
