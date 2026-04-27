// Audit any test artifacts I may have left in the DB this session.
import { db, tasks, dashboardLinks, recurringTasks, platformFeedback, emailThreads, companies } from '@/lib/db';
import { and, eq, like, or, sql, gte } from 'drizzle-orm';

async function main() {
  const cid = process.argv[2] || 'a7e330c0-7b6d-4a04-8860-ff2d36b10e2e';

  // Test markers used across this session
  const markers = ['AGENT-TEST', 'PARITY-UI', 'TEST_E2E_DEBUG', 'E2E-DEBUG', 'SUPPORT-INBOUND-TEST', 'DEBUG repro'];

  console.log('Test fixture residue audit\n');

  // Tasks
  const taskConds = markers.map((m) => like(tasks.title, `%${m}%`));
  const stale = await db.select({
    id: tasks.id,
    title: tasks.title,
    status: tasks.status,
    created_at: tasks.created_at,
  })
    .from(tasks)
    .where(and(eq(tasks.company_id, cid), or(...taskConds)))
    .limit(50);
  console.log(`Tasks matching test markers:  ${stale.length}`);
  const byStatus: Record<string, number> = {};
  for (const t of stale) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  for (const [s, c] of Object.entries(byStatus)) console.log(`  ${s.padEnd(20)} ${c}`);

  // Stuck tasks (the 22 the infra-watchdog flagged)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const stuck = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(
      eq(tasks.status, 'todo'),
      sql`${tasks.created_at} < ${oneHourAgo}`,
    ));
  console.log(`\nTodo tasks > 1hr old (platform-wide): ${stuck[0]?.count ?? 0}`);

  // Test markers in dashboardLinks
  const linkConds = markers.map((m) => like(dashboardLinks.label, `%${m}%`));
  const links = await db.select({ label: dashboardLinks.label })
    .from(dashboardLinks)
    .where(and(eq(dashboardLinks.company_id, cid), or(...linkConds)));
  console.log(`Dashboard links matching markers:  ${links.length}`);
  for (const l of links) console.log(`  - ${l.label}`);

  // Recurring tasks
  const recConds = markers.map((m) => like(recurringTasks.title, `%${m}%`));
  const recs = await db.select({ title: recurringTasks.title, is_active: recurringTasks.is_active })
    .from(recurringTasks)
    .where(and(eq(recurringTasks.company_id, cid), or(...recConds)));
  console.log(`Recurring tasks matching markers:  ${recs.length}`);
  for (const r of recs) console.log(`  - ${r.title} (active=${r.is_active})`);

  // Platform feedback (suggest_feature + report_platform_bug residue)
  const fbConds = markers.map((m) => like(platformFeedback.title, `%${m}%`));
  const fb = await db.select({ title: platformFeedback.title, type: platformFeedback.type })
    .from(platformFeedback)
    .where(and(eq(platformFeedback.company_id, cid), or(...fbConds)));
  console.log(`Platform feedback rows matching markers:  ${fb.length}`);
  for (const f of fb) console.log(`  - [${f.type}] ${f.title}`);

  // Email threads (support inbound test residue)
  const emailConds = markers.map((m) => like(emailThreads.subject, `%${m}%`));
  const emails = await db.select({ subject: emailThreads.subject })
    .from(emailThreads)
    .where(and(eq(emailThreads.company_id, cid), or(...emailConds)));
  console.log(`Email threads matching markers:  ${emails.length}`);

  // Test scripts on disk
  console.log(`\n--- Test scripts created this session ---`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
