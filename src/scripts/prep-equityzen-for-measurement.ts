// READ-WRITE prep script — sets equityzen up for measurement runs.
// Idempotent: safe to run repeatedly.
//
// Effects:
//   1. plan_tier → 'starter' (raises daily credit cap from 3 to 30)
//   2. Grants 100 credits via credit_ledger manual_grant
//   3. Rejects all non-terminal tasks (todo/in_progress/verifying) so the
//      single per-company execution slot is free for measurement tasks
//
// Run: npx tsx --env-file=.env.local src/scripts/prep-equityzen-for-measurement.ts

import { db, companies, creditLedger, tasks } from '@/lib/db';
import { eq, and, inArray, sql } from 'drizzle-orm';

const SLUG = 'equityzen';

async function main() {
  const [c] = await db
    .select({ id: companies.id, slug: companies.slug, plan_tier: companies.plan_tier, name: companies.name })
    .from(companies)
    .where(eq(companies.slug, SLUG))
    .limit(1);
  if (!c) { console.error(`${SLUG} not found`); process.exit(1); }

  console.log(`Before: ${c.name} (plan_tier=${c.plan_tier})`);

  // 1. Bump tier so daily cap is 30
  if (c.plan_tier !== 'starter') {
    await db.update(companies).set({ plan_tier: 'starter' }).where(eq(companies.id, c.id));
    console.log('  → plan_tier bumped to "starter" (30 credits/day cap)');
  } else {
    console.log('  → plan_tier already starter');
  }

  // 2. Add 100 credits via ledger insert (idempotent via timestamped key)
  const key = `measurement-prep-${Date.now()}`;
  await db.insert(creditLedger).values({
    company_id: c.id,
    entry_type: 'manual_grant',
    amount: 100,
    balance_after: 0,
    description: 'Measurement-harness prep (script-driven)',
    idempotency_key: key,
  });
  console.log('  → 100 credits granted');

  // 3. Reject all active tasks (todo/in_progress/verifying) so the slot is free
  const active = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status, tag: tasks.tag })
    .from(tasks)
    .where(and(
      eq(tasks.company_id, c.id),
      inArray(tasks.status, ['todo', 'in_progress', 'verifying'] as never),
    ));
  if (active.length > 0) {
    await db.update(tasks)
      .set({ status: 'rejected' as never, updated_at: new Date() })
      .where(and(
        eq(tasks.company_id, c.id),
        inArray(tasks.status, ['todo', 'in_progress', 'verifying'] as never),
      ));
    console.log(`  → rejected ${active.length} active tasks to free the execution slot:`);
    for (const t of active) console.log(`      [${t.status}] ${t.tag} — ${t.title}`);
  } else {
    console.log('  → no active tasks to clear');
  }

  // 4. Show final state
  const [balance] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.company_id, c.id));
  const remainingActive = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(tasks)
    .where(and(
      eq(tasks.company_id, c.id),
      inArray(tasks.status, ['todo', 'in_progress', 'verifying'] as never),
    ));

  console.log(`\nAfter: ${c.name}`);
  console.log(`  Credit balance: ${balance?.total ?? 0}`);
  console.log(`  Active tasks: ${remainingActive[0]?.count ?? 0}`);
  console.log(`\nReady for measurement.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
