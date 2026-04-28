// Give plinqa 100 credits and bump tier so daily cap stops blocking testing.
// 'starter' tier = 30 credits/day cap. Plenty for a day of agent loop tests.
// Run: npx tsx --env-file=.env.local src/scripts/bump-plinqa-credits.ts

import { db, companies, creditLedger } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

async function main() {
  const [c] = await db
    .select({ id: companies.id, slug: companies.slug, plan_tier: companies.plan_tier, name: companies.name })
    .from(companies)
    .where(eq(companies.slug, 'plinqa'))
    .limit(1);
  if (!c) { console.error('plinqa not found'); process.exit(1); }

  console.log(`Before: ${c.name} (plan_tier=${c.plan_tier})`);

  // 1. Bump tier so daily cap is 30 instead of 3
  if (c.plan_tier !== 'starter') {
    await db.update(companies).set({ plan_tier: 'starter' }).where(eq(companies.id, c.id));
    console.log('  → plan_tier bumped to "starter" (30 credits/day cap)');
  } else {
    console.log('  → plan_tier already starter');
  }

  // 2. Add 100 credits via ledger insert
  // Use idempotency_key with timestamp so re-runs don't duplicate
  const key = `manual-bump-${Date.now()}`;
  await db.insert(creditLedger).values({
    company_id: c.id,
    entry_type: 'manual_grant',
    amount: 100,
    balance_after: 0, // not enforced for manual grants here
    description: 'Test credit bump (script-driven)',
    idempotency_key: key,
  });
  console.log('  → 100 credits added via credit_ledger');

  // 3. Show current balance
  const [balance] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.company_id, c.id));
  console.log(`  Lifetime balance: ${balance?.total ?? 0} credits`);

  console.log(`\nAfter: ${c.name} ready for testing.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
