// Show the latest smoke-test engineering task to verify prompt fix worked
import { db, companies, tasks, users } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';

async function main() {
  const [user] = await db.select({ id: users.id })
    .from(users).where(eq(users.email, 'smoke-test@baljia.app')).limit(1);
  if (!user) { console.log('no smoke user'); process.exit(1); }

  const [company] = await db.select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies).where(and(eq(companies.owner_id, user.id), eq(companies.onboarding_status, 'completed')))
    .orderBy(desc(companies.created_at)).limit(1);
  if (!company) { console.log('no completed company'); process.exit(1); }
  console.log(`Latest smoke company: ${company.name} (${company.slug})`);
  console.log();

  const companyTasks = await db.select().from(tasks)
    .where(and(eq(tasks.company_id, company.id), eq(tasks.source, 'onboarding')))
    .orderBy(tasks.queue_order);

  for (const t of companyTasks) {
    console.log('──────────────────────────────────────────────');
    console.log(`[${t.tag}] priority=${t.priority} complexity=${t.complexity} hours=${t.estimated_hours}`);
    console.log(`TITLE: ${t.title}`);
    console.log();
    console.log(`DESCRIPTION:`);
    console.log(t.description);
    console.log();
    console.log(`REASONING: ${t.suggestion_reasoning}`);
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
