import { db, creditLedger, tasks } from '@/lib/db';
import { eq, desc, sum, and, gte } from 'drizzle-orm';

const COMPANY = '7542b090-42cb-483b-8f14-7a3f7ce5c5f4';

async function main() {
  const rows = await db.select().from(creditLedger).where(eq(creditLedger.company_id, COMPANY)).orderBy(desc(creditLedger.created_at));
  let balance = 0;
  console.log('Ledger entries:', rows.length);
  for (const r of rows) {
    balance += r.amount ?? 0;
    console.log(' ', r.created_at?.toISOString().slice(0, 19), '|', r.entry_type, '|', r.amount, '| bal_after:', r.balance_after, '| task:', r.task_id?.slice(0, 8) ?? '-', '|', (r.description ?? '').slice(0, 50));
  }
  console.log('\nComputed running balance:', balance);

  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const [today] = await db
    .select({ spent: sum(creditLedger.amount) })
    .from(creditLedger)
    .where(and(eq(creditLedger.company_id, COMPANY), eq(creditLedger.entry_type, 'task_deduction'), gte(creditLedger.created_at, midnight)));
  console.log('Spent today (raw):', today?.spent, '(abs will be used)');

  // In-progress tasks?
  const t = await db.select().from(tasks).where(eq(tasks.company_id, COMPANY));
  console.log('\nTasks by status:');
  const byStatus: Record<string, number> = {};
  for (const row of t) byStatus[row.status!] = (byStatus[row.status!] ?? 0) + 1;
  console.log(byStatus);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
