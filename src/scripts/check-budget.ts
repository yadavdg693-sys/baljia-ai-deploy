import { db, creditLedger, subscriptions } from '@/lib/db';
import { and, eq, gte, sql } from 'drizzle-orm';

async function main() {
  const cid = process.argv[2] || 'a7e330c0-7b6d-4a04-8860-ff2d36b10e2e';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [bal] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount),0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.company_id, cid));
  const [spent] = await db
    .select({ total: sql<number>`COALESCE(SUM(ABS(amount)),0)::int` })
    .from(creditLedger)
    .where(and(eq(creditLedger.company_id, cid), sql`amount < 0`, gte(creditLedger.created_at, today)));
  const [sub] = await db
    .select({ plan: subscriptions.plan_type })
    .from(subscriptions)
    .where(eq(subscriptions.company_id, cid))
    .limit(1);

  console.log(`company:        ${cid}`);
  console.log(`balance:        ${bal?.total ?? 0} credits`);
  console.log(`today spent:    ${spent?.total ?? 0} credits`);
  console.log(`plan:           ${sub?.plan ?? 'trial'}`);
  console.log(`daily caps:     trial=10  starter=30  growth=75  scale=200`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
