import { db, companies, emailThreads } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const slug = process.argv[2] || 'threadmint';
  const [c] = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      email_identity: companies.email_identity,
      company_email: companies.company_email,
    })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);

  if (!c) {
    console.log(`No company with slug ${slug}`);
    process.exit(1);
  }

  console.log(`company:        ${c.name}`);
  console.log(`slug:           ${c.slug}`);
  console.log(`email_identity: ${c.email_identity ?? '(null)'}`);
  console.log(`company_email:  ${c.company_email ?? '(null)'}`);

  const recent = await db
    .select({ subject: emailThreads.subject, from: emailThreads.from_address, dir: emailThreads.direction, ts: emailThreads.created_at })
    .from(emailThreads)
    .where(eq(emailThreads.company_id, c.id))
    .orderBy(desc(emailThreads.created_at))
    .limit(5);

  console.log(`recent emails:  ${recent.length}`);
  for (const r of recent) {
    const ts = r.ts instanceof Date ? r.ts.toISOString() : String(r.ts);
    console.log(`  ${ts}  ${r.dir}  from=${r.from}  subj=${(r.subject ?? '').slice(0, 50)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
