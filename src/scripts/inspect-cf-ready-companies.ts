// Find companies with provisioned Neon DBs that we can run the agent-loop test against.
// Run: npx tsx --env-file=.env.local src/scripts/inspect-cf-ready-companies.ts

import { db, companies } from '@/lib/db';
import { isNotNull, and, eq } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      lifecycle: companies.lifecycle,
      neon_connection_string: companies.neon_connection_string,
      onboarding_status: companies.onboarding_status,
    })
    .from(companies)
    .where(and(
      isNotNull(companies.neon_connection_string),
      isNotNull(companies.slug),
      eq(companies.onboarding_status, 'completed'),
    ))
    .limit(20);

  console.log(`${rows.length} companies with provisioned Neon DB + completed onboarding:\n`);
  for (const r of rows) {
    const hasNeon = r.neon_connection_string ? 'Y' : 'N';
    console.log(`  ${r.id.slice(0, 8)}…  ${(r.slug ?? '').padEnd(25)}  ${(r.name ?? '').slice(0, 40).padEnd(40)}  neon=${hasNeon}  ${r.lifecycle}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
