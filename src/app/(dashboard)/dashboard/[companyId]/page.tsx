import { getSessionFromCookies } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db, companies, tasks, documents, reports, creditLedger, documentSuggestions, emailThreads, dashboardLinks, platformEvents, adCampaigns, promoVideoJobs } from '@/lib/db';
import { eq, desc, asc, sql, and, gte, inArray } from 'drizzle-orm';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { isValidUUID } from '@/lib/uuid-validation';
import { mapPromoVideoJob } from '@/lib/services/promo-video-core.service';
import { stripTaskInternalFields } from '@/lib/services/task.service';

// Disable Next.js full-route caching for this page. Without this, a Server
// Component render can be cached and the founder won't see newly-created
// tasks until the cache invalidates. Triggered by platform-ops triage on
// 2026-04-28 — the original bug "Created task not appearing in dashboard"
// was caused (at least partially) by Server Component caching, not by a
// DB read-your-writes race (verified via stress reproducer: 0/50 invisible).
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function CompanyDashboard({ params }: Props) {
  const { companyId } = await params;
  const user = await getSessionFromCookies();
  if (!user) redirect('/login');
  const companyLookup = isValidUUID(companyId) ? eq(companies.id, companyId) : eq(companies.slug, companyId);

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
    .where(and(companyLookup, eq(companies.owner_id, user.id)))
    .limit(1);

  // No company OR not owned by this user → bounce to portfolio (which shows
  // their existing companies or an empty state with a CTA). Previously this
  // silently redirected to /onboarding even when the user already had other
  // companies, which lost context with no explanation.
  if (!company) redirect('/portfolio');
  const resolvedCompanyId = company.id;

  // If company was created via quick-start but pipeline hasn't run yet,
  // redirect to onboarding to auto-resume the pipeline (intentional UX:
  // these companies have no dashboard content to show yet).
  if (company.onboarding_status === 'pending_auth') {
    redirect(`/onboarding?resume=${company.id}`);
  }

  // Load tasks, documents, reports, credit balance in parallel
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [taskList, docList, reportList, balanceResult, usageResult, pendingSuggestions, emailList, linkList, setupEventRows, adRows, promoVideoRows] = await Promise.all([
    db.select()
      .from(tasks)
      .where(eq(tasks.company_id, resolvedCompanyId))
      .orderBy(asc(tasks.queue_order), desc(tasks.created_at)),

    db.select()
      .from(documents)
      .where(eq(documents.company_id, resolvedCompanyId))
      .orderBy(desc(documents.updated_at)),

    db.select()
      .from(reports)
      .where(eq(reports.company_id, resolvedCompanyId))
      .orderBy(desc(reports.created_at))
      .limit(10),

    db.select({ total: sql<number>`COALESCE(SUM(${creditLedger.amount}), 0)` })
      .from(creditLedger)
      .where(eq(creditLedger.company_id, resolvedCompanyId)),

    // C3: Last 7 days credit usage per day
    db.select({
      day: sql<string>`DATE(${creditLedger.created_at})`,
      used: sql<number>`COALESCE(SUM(ABS(${creditLedger.amount})), 0)`,
    })
      .from(creditLedger)
      .where(and(
        eq(creditLedger.company_id, resolvedCompanyId),
        sql`${creditLedger.amount} < 0`,
        gte(creditLedger.created_at, sevenDaysAgo),
      ))
      .groupBy(sql`DATE(${creditLedger.created_at})`)
      .orderBy(sql`DATE(${creditLedger.created_at})`),

    // C5: Pending document suggestions
    db.select()
      .from(documentSuggestions)
      .where(and(
        eq(documentSuggestions.company_id, resolvedCompanyId),
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
      body: emailThreads.body,
      created_at: emailThreads.created_at,
    })
      .from(emailThreads)
      .where(eq(emailThreads.company_id, resolvedCompanyId))
      .orderBy(desc(emailThreads.created_at))
      .limit(20),

    // Founder-managed quick links (rendered in the dashboard Links section)
    db.select({
      id: dashboardLinks.id,
      label: dashboardLinks.label,
      url: dashboardLinks.url,
    })
      .from(dashboardLinks)
      .where(eq(dashboardLinks.company_id, resolvedCompanyId)),

    db.select({
      id: platformEvents.id,
      event_type: platformEvents.event_type,
      payload: platformEvents.payload,
      created_at: platformEvents.created_at,
    })
      .from(platformEvents)
      .where(and(
        eq(platformEvents.company_id, resolvedCompanyId),
        inArray(platformEvents.event_type, ['onboarding_stage', 'onboarding_activity', 'onboarding_mood']),
      ))
      .orderBy(desc(platformEvents.created_at))
      .limit(30),

    db.select({
      id: adCampaigns.id,
      status: adCampaigns.status,
      daily_budget: adCampaigns.daily_budget,
      spend: adCampaigns.spend,
      created_at: adCampaigns.created_at,
    })
      .from(adCampaigns)
      .where(and(eq(adCampaigns.company_id, resolvedCompanyId), eq(adCampaigns.platform, 'meta')))
      .orderBy(desc(adCampaigns.created_at))
      .limit(10),

    db.select()
      .from(promoVideoJobs)
      .where(eq(promoVideoJobs.company_id, resolvedCompanyId))
      .orderBy(desc(promoVideoJobs.created_at))
      .limit(10),
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
      tasks={taskList.map(stripTaskInternalFields) as unknown as Parameters<typeof DashboardShell>[0]['tasks']}
      documents={docList as unknown as Parameters<typeof DashboardShell>[0]['documents']}
      reports={reportList as unknown as Parameters<typeof DashboardShell>[0]['reports']}
      creditBalance={creditBalance}
      recentUsage={recentUsage}
      pendingSuggestions={pendingSuggestions as unknown as Parameters<typeof DashboardShell>[0]['pendingSuggestions']}
      emails={emailList as unknown as Parameters<typeof DashboardShell>[0]['emails']}
      links={linkList}
      ads={adRows.map((ad) => ({
        ...ad,
        daily_budget: ad.daily_budget === null ? null : String(ad.daily_budget),
        spend: ad.spend === null ? null : String(ad.spend),
        created_at: ad.created_at instanceof Date ? ad.created_at.toISOString() : ad.created_at ? String(ad.created_at) : null,
      }))}
      promoVideos={promoVideoRows.map((row) => mapPromoVideoJob(row)) as unknown as Parameters<typeof DashboardShell>[0]['promoVideos']}
      setupEvents={setupEventRows.reverse().map((event) => ({
        id: event.id,
        event_type: event.event_type,
        payload: (event.payload ?? {}) as Record<string, unknown>,
        created_at: event.created_at instanceof Date ? event.created_at.toISOString() : String(event.created_at),
      }))}
      user={user as unknown as Parameters<typeof DashboardShell>[0]['user']}
    />
  );
}
