import { db, tasks, companies, creditLedger } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

const COMPANY_ID = '7542b090-42cb-483b-8f14-7a3f7ce5c5f4';

async function main() {
  const [company] = await db.select().from(companies).where(eq(companies.id, COMPANY_ID)).limit(1);
  console.log('Company:', { id: company.id, name: company.name, slug: company.slug, subdomain: company.subdomain, lifecycle: company.lifecycle, billing: company.billing_state });
  console.log('');
  const taskRows = await db.select().from(tasks).where(eq(tasks.company_id, COMPANY_ID)).orderBy(desc(tasks.priority));
  console.log('Tasks (' + taskRows.length + '):');
  for (const t of taskRows) {
    console.log('-', t.id);
    console.log('  tag:', t.tag, '| priority:', t.priority, '| complexity:', t.complexity, '| status:', t.status, '| source:', t.source, '| auth:', t.authorized_by, '| credits:', t.estimated_credits);
    console.log('  title:', t.title);
    console.log('  desc:', (t.description ?? '').slice(0, 400).replace(/\n/g, ' '));
    console.log('');
  }
  const credits = await db.select().from(creditLedger).where(eq(creditLedger.company_id, COMPANY_ID)).orderBy(desc(creditLedger.created_at)).limit(5);
  console.log('Credit ledger (latest 5):');
  for (const c of credits) console.log(' ', c.type, c.amount, c.reason);
  process.exit(0);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
