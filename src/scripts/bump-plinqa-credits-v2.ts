// Real fix: plan_tier comes from `subscriptions` table, not `companies`.
// Need to insert/update a subscription row for plinqa with plan_type='starter'
// so daily cap = 30 not 3.
// Run: npx tsx --env-file=.env.local src/scripts/bump-plinqa-credits-v2.ts

import { db, companies, subscriptions, creditLedger } from '@/lib/db';
import { eq, and, gte, sql } from 'drizzle-orm';

async function main() {
  const [c] = await db.select({ id: companies.id, slug: companies.slug })
    .from(companies).where(eq(companies.slug, 'plinqa')).limit(1);
  if (!c) { console.error('plinqa not found'); process.exit(1); }
  console.log(`plinqa company id: ${c.id}`);

  // Check today's spend
  const today = new Date().toISOString().split('T')[0];
  const [spend] = await db.select({
    total: sql<number>`COALESCE(SUM(ABS(amount)), 0)::int`,
    count: sql<number>`COUNT(*)::int`,
  }).from(creditLedger).where(and(
    eq(creditLedger.company_id, c.id),
    eq(creditLedger.entry_type, 'task_deduction'),
    gte(creditLedger.created_at, sql`${today + 'T00:00:00Z'}::timestamptz`),
  ));
  console.log(`today spend: ${spend?.total ?? 0} credits across ${spend?.count ?? 0} deductions`);

  // Look at active subscription
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.company_id, c.id));
  console.log(`subscriptions for plinqa: ${subs.length}`);
  for (const s of subs) console.log(`  - status=${s.status} plan=${s.plan_type}`);

  // UPDATE the existing subscription to plan_type='starter' AND ensure
  // status='active'. (Insert blocked by NOT NULL on user_id; existing row
  // already has it. Earlier v1 of this script accidentally set status to
  // inactive — recover here by setting it back to active.)
  const updated = await db.update(subscriptions)
    .set({ plan_type: 'starter', status: 'active' })
    .where(eq(subscriptions.company_id, c.id))
    .returning({ id: subscriptions.id, status: subscriptions.status, plan_type: subscriptions.plan_type });
  console.log(`  ✓ updated ${updated.length} subscription(s):`);
  for (const u of updated) console.log(`    - id=${u.id.slice(0, 8)}… status=${u.status} plan=${u.plan_type}`);

  // Reset today's spend so we can test again (delete today's task_deduction entries)
  // This is the surgical fix to let us keep testing
  const deleted = await db.delete(creditLedger)
    .where(and(
      eq(creditLedger.company_id, c.id),
      eq(creditLedger.entry_type, 'task_deduction'),
      gte(creditLedger.created_at, sql`${today + 'T00:00:00Z'}::timestamptz`),
    ))
    .returning({ id: creditLedger.id });
  console.log(`  ✓ cleared ${deleted.length} task_deduction entries from today`);

  // Show final balance
  const [bal] = await db.select({ total: sql<number>`COALESCE(SUM(amount), 0)::int` })
    .from(creditLedger).where(eq(creditLedger.company_id, c.id));
  console.log(`\nplinqa lifetime balance: ${bal?.total ?? 0} credits`);
  console.log('plinqa ready for testing.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
