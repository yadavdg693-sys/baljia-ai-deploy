// Stage A: verify engineering task is ready to fire on Markmeld
import { db, companies, tasks, creditLedger } from '@/lib/db';
import { eq, and, desc, sql } from 'drizzle-orm';

async function main() {
  const [user] = await db.select({ id: sql<string>`id` }).from(db.$with('u').as(sql<string>`SELECT id FROM users WHERE email = 'smoke-test@baljia.app' LIMIT 1` as never) as never).catch(() => [{ id: null }]);
  // Simpler path: query by slug
  const [company] = await db.select().from(companies)
    .where(eq(companies.slug, 'markmeld')).limit(1);
  if (!company) {
    console.log('❌ No company with slug=markmeld');
    process.exit(1);
  }
  console.log('Company:', company.name, company.id);
  console.log('  lifecycle:      ', company.lifecycle);
  console.log('  execution_state:', company.execution_state);
  console.log('  billing_state:  ', company.billing_state);
  console.log('  hosting_state:  ', company.hosting_state);
  console.log('  github_repo:    ', company.github_repo ?? '(none)');
  console.log('  neon_database_id:', company.neon_database_id ?? '(none)');
  console.log('  render_service_id:', company.render_service_id ?? '(none)');

  // Credits (sum the ledger)
  const ledger = await db.select().from(creditLedger).where(eq(creditLedger.company_id, company.id));
  const balance = ledger.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  console.log('  credit balance:', balance);

  const companyTasks = await db.select().from(tasks)
    .where(and(eq(tasks.company_id, company.id), eq(tasks.source, 'onboarding')))
    .orderBy(desc(tasks.queue_order));
  console.log('Tasks:');
  for (const t of companyTasks) {
    console.log(`  [${t.tag}] ${t.title} — status=${t.status} priority=${t.priority} complexity=${t.complexity} hours=${t.estimated_hours}`);
  }

  // Check what's needed to fire the engineering task
  const eng = companyTasks.find((t) => t.tag === 'engineering');
  console.log('\n--- Readiness for launchTask ---');
  console.log('  Engineering task exists?   ', !!eng);
  console.log('  Status is todo?            ', eng?.status === 'todo');
  console.log('  Lifecycle allows execution?', ['trial_active', 'full_active'].includes(company.lifecycle ?? ''));
  console.log('  Not suspended?             ', company.execution_state !== 'suspended');
  console.log('  Credits >= 1?              ', balance >= 1);
  console.log('  Neon DB provisioned?       ', !!company.neon_database_id);
  console.log('  GitHub repo provisioned?   ', !!company.github_repo);
  console.log('  Render service?            ', company.render_service_id ?? '(none — will be created by agent)');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
