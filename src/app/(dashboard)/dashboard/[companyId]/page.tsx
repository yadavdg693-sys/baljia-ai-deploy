import { getSessionFromCookies } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db, companies, tasks, documents, reports, creditLedger, documentSuggestions, emailThreads } from '@/lib/db';
import { eq, desc, asc, sql, and, gte, inArray } from 'drizzle-orm';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function CompanyDashboard({ params }: Props) {
  const { companyId } = await params;
  const user = await getSessionFromCookies();
  if (!user) redirect('/login');

  // C3-FIX: Load company WITH ownership check — prevents cross-tenant dashboard access
  const [company] = await db
    .select({
      id: companies.id,
      owner_id: companies.owner_id,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      original_idea: companies.original_idea,
      claim_status: companies.claim_status,
      onboarding_status: companies.onboarding_status,
      plan_tier: companies.plan_tier,
      lifecycle: companies.lifecycle,
      execution_state: companies.execution_state,
      billing_state: companies.billing_state,
      hosting_state: companies.hosting_state,
      company_stage: companies.company_stage,
      subdomain: companies.subdomain,
      email_identity: companies.email_identity,
      company_email: companies.company_email,
      github_repo: companies.github_repo,
      render_service_id: companies.render_service_id,
      custom_domain: companies.custom_domain,
      timezone: companies.timezone,
      created_at: companies.created_at,
      updated_at: companies.updated_at,
      deleted_at: companies.deleted_at,
    })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.owner_id, user.id)))
    .limit(1);

  if (!company) redirect('/onboarding');

  // If company was created via quick-start but pipeline hasn't run yet,
  // redirect to onboarding to auto-resume the pipeline
  if (company.onboarding_status === 'pending_auth') {
    redirect(`/onboarding?resume=${company.id}`);
  }

  // Load tasks, documents, reports, credit balance in parallel
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [taskList, docList, reportList, balanceResult, usageResult, pendingSuggestions, emailList, liveCountResult] = await Promise.all([
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

    // Email threads (inbox + sent) — latest 20 for the preview panel
    db.select({
      id: emailThreads.id,
      subject: emailThreads.subject,
      to_address: emailThreads.to_address,
      from_address: emailThreads.from_address,
      direction: emailThreads.direction,
      created_at: emailThreads.created_at,
    })
      .from(emailThreads)
      .where(eq(emailThreads.company_id, companyId))
      .orderBy(desc(emailThreads.created_at))
      .limit(20),

    // Live companies count — drives the LiveBanner at top of shell
    db.select({ count: sql<number>`count(*)::int` })
      .from(companies)
      .where(inArray(companies.lifecycle, ['trial_active', 'full_active'])),
  ]);

  const creditBalance = Number(balanceResult[0]?.total ?? 0);
  const liveCompanyCount = Number(liveCountResult[0]?.count ?? 0);

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
      emails={emailList as unknown as Parameters<typeof DashboardShell>[0]['emails']}
      user={user as unknown as Parameters<typeof DashboardShell>[0]['user']}
      liveCompanyCount={liveCompanyCount}
    />
  );
}
