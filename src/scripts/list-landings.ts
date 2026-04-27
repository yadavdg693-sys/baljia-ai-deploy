// Quick: list every company with a slug (= every landing page that exists in R2 by DB record)
import { db } from '@/lib/db';
import { companies, users } from '@/lib/db/schema';
import { eq, isNotNull, desc } from 'drizzle-orm';

async function main() {
  const rows = await db.select({
    slug: companies.slug,
    name: companies.name,
    status: companies.onboarding_status,
    created: companies.created_at,
    owner: users.email,
  })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(isNotNull(companies.slug))
    .orderBy(desc(companies.created_at));

  console.log(`Total companies with slug: ${rows.length}\n`);
  for (const r of rows) {
    const url = `https://${r.slug}.baljia.app`;
    console.log(`${r.created?.toISOString().slice(0, 19)}  ${(r.status ?? '-').padEnd(11)}  ${(r.owner ?? '-').padEnd(35)}  ${url}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
