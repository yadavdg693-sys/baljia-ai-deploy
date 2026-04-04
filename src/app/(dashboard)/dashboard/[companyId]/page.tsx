import { getSessionFromCookies } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db, companies, tasks, documents, reports, creditLedger, documentSuggestions } from '@/lib/db';
import { eq, desc, asc, sql, and, gte } from 'drizzle-orm';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function CompanyDashboard({ params }: Props) {
  const { companyId } = await params;
  const user = await getSessionFromCookies();
  if (!user) redirect('/login');

  // Load company
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) redirect('/onboarding');

  // Load tasks, documents, reports, credit balance in parallel
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [taskList, docList, reportList, balanceResult, usageResult, pendingSuggestions] = await Promise.all([
    db.select()
      .from(tasks)
      .where(eq(tasks.company_id, companyId))
      .orderBy(asc(tasks.queue_order), desc(tasks.created_at)),

    db.select()
      .from(documents)
      .where(eq(documents.company_id, companyId))
      .orderBy(desc(documents.updated_at)),

    db.select()
      .from(reports)
      .where(eq(reports.company_id, companyId))
      .orderBy(desc(reports.created_at))
      .limit(10),

    db.select({ total: sql<number>`COALESCE(SUM(${creditLedger.amount}), 0)` })
      .from(creditLedger)
      .where(eq(creditLedger.company_id, companyId)),

    // C3: Last 7 days credit usage per day
    db.select({
      day: sql<string>`DATE(${creditLedger.created_at})`,
      used: sql<number>`COALESCE(SUM(ABS(${creditLedger.amount})), 0)`,
    })
      .from(creditLedger)
      .where(and(
        eq(creditLedger.company_id, companyId),
        sql`${creditLedger.amount} < 0`,
        gte(creditLedger.created_at, sevenDaysAgo),
      ))
      .groupBy(sql`DATE(${creditLedger.created_at})`)
      .orderBy(sql`DATE(${creditLedger.created_at})`),

    // C5: Pending document suggestions
    db.select()
      .from(documentSuggestions)
      .where(and(
        eq(documentSuggestions.company_id, companyId),
        eq(documentSuggestions.status, 'pending'),
      ))
      .orderBy(desc(documentSuggestions.created_at))
      .limit(5),
  ]);

  const creditBalance = Number(balanceResult[0]?.total ?? 0);

  // Build 7-day usage array (fill gaps with 0)
  const usageMap = new Map(usageResult.map((r) => [r.day, Number(r.used)]));
  const recentUsage: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    recentUsage.push(usageMap.get(key) ?? 0);
  }

  // Drizzle returns Date objects for timestamps; DashboardShell expects string dates.
  // Next.js serializes Date→string when passing server→client, so this is safe at runtime.
  return (
    <DashboardShell
      company={company as unknown as Parameters<typeof DashboardShell>[0]['company']}
      tasks={taskList as unknown as Parameters<typeof DashboardShell>[0]['tasks']}
      documents={docList as unknown as Parameters<typeof DashboardShell>[0]['documents']}
      reports={reportList as unknown as Parameters<typeof DashboardShell>[0]['reports']}
      creditBalance={creditBalance}
      recentUsage={recentUsage}
      pendingSuggestions={pendingSuggestions as unknown as Parameters<typeof DashboardShell>[0]['pendingSuggestions']}
      user={user as unknown as Parameters<typeof DashboardShell>[0]['user']}
    />
  );
}
