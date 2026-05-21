// Detail view of the 6 companies with stuck onboarding tasks.
// Pulls owner email, last login, plan, lifecycle, and links.
// Run: npx tsx --env-file=.env.local src/scripts/inspect-stuck-companies.ts

import { db, tasks, companies, users, chatSessions } from '@/lib/db';
import { and, eq, sql, inArray, desc } from 'drizzle-orm';

async function main() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const stuckCompanyIds = await db
    .selectDistinct({ id: tasks.company_id })
    .from(tasks)
    .where(and(
      eq(tasks.status, 'todo'),
      sql`${tasks.created_at} < ${oneHourAgo}`,
    ));

  const ids = stuckCompanyIds.map((r) => r.id);
  if (ids.length === 0) {
    console.log('No companies with stuck tasks.');
    process.exit(0);
  }

  const cos = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      lifecycle: companies.lifecycle,
      plan_tier: companies.plan_tier,
      onboarding_status: companies.onboarding_status,
      created_at: companies.created_at,
      updated_at: companies.updated_at,
      owner_id: companies.owner_id,
      owner_email: users.email,
      owner_name: users.name,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(inArray(companies.id, ids))
    .orderBy(desc(companies.updated_at));

  // Also: most-recent chat session per company (proxy for "is the founder active?")
  const lastChat: Record<string, Date | null> = {};
  for (const c of cos) {
    const [s] = await db.select({ updated_at: chatSessions.updated_at })
      .from(chatSessions)
      .where(eq(chatSessions.company_id, c.id))
      .orderBy(desc(chatSessions.updated_at))
      .limit(1);
    lastChat[c.id] = s?.updated_at ?? null;
  }

  // Stuck task counts per company
  const stuckCounts: Record<string, number> = {};
  for (const c of cos) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(
        eq(tasks.company_id, c.id),
        eq(tasks.status, 'todo'),
        sql`${tasks.created_at} < ${oneHourAgo}`,
      ));
    stuckCounts[c.id] = Number(r?.n ?? 0);
  }

  console.log(`${cos.length} companies with stuck onboarding tasks\n`);

  for (const c of cos) {
    const updated = c.updated_at instanceof Date ? c.updated_at : new Date(String(c.updated_at));
    const ageHours = Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60));
    const chatTs = lastChat[c.id];
    const chatAge = chatTs
      ? `${Math.floor((Date.now() - chatTs.getTime()) / (1000 * 60 * 60))}h ago`
      : 'never';

    console.log(`══ ${c.name} [${c.slug}] ══`);
    console.log(`  founder:        ${c.owner_name ?? '(no name)'} <${c.owner_email ?? '(no email)'}>`);
    console.log(`  plan:           ${c.plan_tier} (${c.lifecycle})`);
    console.log(`  onboarding:     ${c.onboarding_status}`);
    console.log(`  company age:    ${ageHours}h since last update`);
    console.log(`  last chat:      ${chatAge}`);
    console.log(`  stuck tasks:    ${stuckCounts[c.id] ?? 0}`);
    console.log(`  dashboard:      http://localhost:3000/dashboard/${c.id}`);
    console.log(`  resume onbrd:   http://localhost:3000/onboarding?resume=${c.id}`);
    console.log(`  founder app:    https://${c.slug}.baljia.app`);
    console.log('');
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
