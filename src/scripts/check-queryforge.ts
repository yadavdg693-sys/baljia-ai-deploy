// One-shot diagnostic for QueryForge company state
import { db } from '@/lib/db';
import { creditLedger, subscriptions, platformEvents, documents, tasks } from '@/lib/db/schema';
import { eq, desc, sum } from 'drizzle-orm';

const COMPANY_ID = '008a48b8-f1d3-45c2-b812-acc46d693e3b';

async function main() {
  // Credits
  const [cr] = await db.select({ total: sum(creditLedger.amount) })
    .from(creditLedger).where(eq(creditLedger.company_id, COMPANY_ID));
  console.log('CREDITS:', cr?.total ?? '0');

  // Subscription
  const subs = await db.select({
    plan: subscriptions.plan_id,
    billing: subscriptions.billing_state,
    status: subscriptions.status,
  }).from(subscriptions).where(eq(subscriptions.company_id, COMPANY_ID));
  if (subs.length === 0) {
    console.log('SUBS: NONE');
  } else {
    subs.forEach(s => console.log(`SUBS: plan=${s.plan} | billing_state=${s.billing} | status=${s.status}`));
  }

  // Documents
  try {
    const docs = await db.select({ kind: (documents as any).kind, content_len: (documents as any).content })
      .from(documents as any).where(eq((documents as any).company_id, COMPANY_ID));
    console.log('DOCS:', docs.map((d: any) => `${d.kind} (${d.content_len?.length ?? 0} chars)`));
  } catch {
    console.log('DOCS: query error');
  }

  // Tasks
  const ts = await db.select({
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    tag: tasks.tag,
    auth: tasks.authorized_by,
  }).from(tasks).where(eq(tasks.company_id, COMPANY_ID));
  console.log('\nTASKS:');
  ts.forEach(t => console.log(` [${t.status}] [${t.tag}] auth=${t.auth} | ${t.title.slice(0, 70)}`));

  // Recent events
  console.log('\nLAST 8 EVENTS:');
  const events = await db.select({
    type: platformEvents.event_type,
    payload: platformEvents.payload,
    at: platformEvents.created_at,
  }).from(platformEvents)
    .where(eq(platformEvents.company_id, COMPANY_ID))
    .orderBy(desc(platformEvents.created_at))
    .limit(8);

  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const detail = p.stage ?? p.text ?? p.error ?? p.status ?? '';
    console.log(` ${e.type.padEnd(30)} | ${String(detail).slice(0, 80)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
