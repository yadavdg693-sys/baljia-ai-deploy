// One-off helper for verifying the /tasks page. Lists the e2e test companies
// (Traloom / Lichora / Planora) with their UUIDs, owner email, and task counts.
// Safe to delete after verification.

import { db, companies, users, tasks } from '@/lib/db';
import { eq, ilike, or, sql } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      owner_id: companies.owner_id,
      owner_email: users.email,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(or(
      ilike(companies.name, '%traloom%'),
      ilike(companies.name, '%lichora%'),
      ilike(companies.name, '%planora%'),
    ));

  for (const r of rows) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.company_id, r.id));
    console.log(`${r.name.padEnd(20)} ${r.id}  owner=${r.owner_email ?? '?'}  tasks=${count}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
