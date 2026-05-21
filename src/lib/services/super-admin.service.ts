import {
  adCampaigns,
  agents,
  chatSessions,
  companies,
  creditLedger,
  db,
  documents,
  emailThreads,
  platformEvents,
  reports,
  revenueLedger,
  runs,
  subscriptions,
  superAdminAuditEvents,
  tasks,
  users,
} from '@/lib/db';
import {
  normalizeSuperAdminCompanyFilters,
  type RawSuperAdminCompanyFilters,
} from '@/lib/super-admin';
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';

export type SuperAdminActor = {
  id: string;
  email: string;
  name: string | null;
};

type SuperAdminCompaniesInput = RawSuperAdminCompanyFilters;

// Super-admin reads intentionally fail closed if audit persistence is unavailable,
// so sensitive cross-company views are not served without an audit trail.
export async function recordSuperAdminAudit(
  actor: SuperAdminActor,
  action: string,
  target?: { type: string; id: string },
  metadata?: Record<string, unknown>,
) {
  await db.insert(superAdminAuditEvents).values({
    admin_user_id: actor.id,
    admin_email: actor.email,
    action,
    target_type: target?.type,
    target_id: target?.id,
    metadata,
  });
}

export async function getSuperAdminOverview(actor: SuperAdminActor) {
  await recordSuperAdminAudit(actor, 'view_overview');

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [companyStats] = await db
    .select({
      totalCompanies: sql<number>`COUNT(*)::int`,
      activeCompanies: sql<number>`COUNT(*) FILTER (WHERE ${companies.deleted_at} IS NULL AND ${companies.execution_state} = 'active')::int`,
      paidCompanies: sql<number>`COUNT(*) FILTER (WHERE ${companies.billing_state} IN ('active', 'paid'))::int`,
      onboardingCompanies: sql<number>`COUNT(*) FILTER (WHERE ${companies.onboarding_status} NOT IN ('complete', 'completed'))::int`,
    })
    .from(companies);

  const [userStats] = await db
    .select({
      totalUsers: sql<number>`COUNT(*)::int`,
      users7d: sql<number>`COUNT(*) FILTER (WHERE ${users.created_at} >= ${since7d})::int`,
    })
    .from(users);

  const [taskStats] = await db
    .select({
      totalTasks: sql<number>`COUNT(*)::int`,
      runningTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'in_progress')::int`,
      failedTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} IN ('failed', 'failed_permanent'))::int`,
      completedTasks7d: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed' AND ${tasks.completed_at} >= ${since7d})::int`,
    })
    .from(tasks);

  const [creditStats] = await db
    .select({
      creditsUsed7d: sql<number>`COALESCE(SUM(ABS(${creditLedger.amount})) FILTER (WHERE ${creditLedger.amount} < 0 AND ${creditLedger.created_at} >= ${since7d}), 0)::int`,
      creditEvents24h: sql<number>`COUNT(*) FILTER (WHERE ${creditLedger.created_at} >= ${since24h})::int`,
    })
    .from(creditLedger);

  const [subscriptionStats] = await db
    .select({
      activeSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.status} = 'active')::int`,
      trialSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.plan_type} = 'trial')::int`,
    })
    .from(subscriptions);

  const [revenueStats] = await db
    .select({
      totalRevenue: sql<string>`COALESCE(SUM(${revenueLedger.net_amount}), 0)::text`,
      revenue7d: sql<string>`COALESCE(SUM(${revenueLedger.net_amount}) FILTER (WHERE ${revenueLedger.created_at} >= ${since7d}), 0)::text`,
    })
    .from(revenueLedger);

  const recentCompanies = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      lifecycle: companies.lifecycle,
      plan_tier: companies.plan_tier,
      billing_state: companies.billing_state,
      onboarding_status: companies.onboarding_status,
      created_at: companies.created_at,
      owner_email: users.email,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .orderBy(desc(companies.created_at))
    .limit(8);

  return { companyStats, userStats, taskStats, creditStats, subscriptionStats, revenueStats, recentCompanies };
}

export async function getSuperAdminCompanies(actor: SuperAdminActor, input: SuperAdminCompaniesInput = {}) {
  const normalizedInput = normalizeSuperAdminCompanyFilters(input);

  await recordSuperAdminAudit(actor, 'view_company_list', undefined, {
    q: normalizedInput.q,
    lifecycle: normalizedInput.lifecycle,
    billingState: normalizedInput.billingState,
    taskHealth: normalizedInput.taskHealth,
    activity: normalizedInput.activity,
    limit: normalizedInput.limit,
  });

  const filters: SQL[] = [];
  const q = normalizedInput.q;
  const now = new Date();
  const stuckCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  if (q) {
    filters.push(or(ilike(companies.name, `%${q}%`), ilike(companies.slug, `%${q}%`), ilike(users.email, `%${q}%`))!);
  }

  if (normalizedInput.lifecycle) {
    filters.push(eq(companies.lifecycle, normalizedInput.lifecycle));
  }

  if (normalizedInput.billingState) {
    filters.push(eq(companies.billing_state, normalizedInput.billingState));
  }

  if (normalizedInput.taskHealth === 'failed') {
    filters.push(sql`EXISTS (
      SELECT 1 FROM ${tasks}
      WHERE ${tasks.company_id} = ${companies.id}
      AND ${tasks.status} IN ('failed', 'failed_permanent')
    )`);
  } else if (normalizedInput.taskHealth === 'running') {
    filters.push(sql`EXISTS (
      SELECT 1 FROM ${tasks}
      WHERE ${tasks.company_id} = ${companies.id}
      AND ${tasks.status} = 'in_progress'
    )`);
  } else if (normalizedInput.taskHealth === 'stuck') {
    filters.push(sql`EXISTS (
      SELECT 1 FROM ${tasks}
      WHERE ${tasks.company_id} = ${companies.id}
      AND ${tasks.status} = 'in_progress'
      AND ${tasks.started_at} <= ${stuckCutoff}
    )`);
  } else if (normalizedInput.taskHealth === 'no_tasks') {
    filters.push(sql`NOT EXISTS (
      SELECT 1 FROM ${tasks}
      WHERE ${tasks.company_id} = ${companies.id}
    )`);
  }

  if (normalizedInput.activity === 'last_24h') {
    filters.push(sql`EXISTS (
      SELECT 1 FROM ${platformEvents}
      WHERE ${platformEvents.company_id} = ${companies.id}
      AND ${platformEvents.created_at} >= ${since24h}
    )`);
  } else if (normalizedInput.activity === 'last_7d') {
    filters.push(sql`EXISTS (
      SELECT 1 FROM ${platformEvents}
      WHERE ${platformEvents.company_id} = ${companies.id}
      AND ${platformEvents.created_at} >= ${since7d}
    )`);
  } else if (normalizedInput.activity === 'quiet_7d') {
    filters.push(sql`NOT EXISTS (
      SELECT 1 FROM ${platformEvents}
      WHERE ${platformEvents.company_id} = ${companies.id}
      AND ${platformEvents.created_at} >= ${since7d}
    )`);
  }

  return db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      owner_email: users.email,
      lifecycle: companies.lifecycle,
      execution_state: companies.execution_state,
      billing_state: companies.billing_state,
      hosting_state: companies.hosting_state,
      onboarding_status: companies.onboarding_status,
      plan_tier: companies.plan_tier,
      created_at: companies.created_at,
      updated_at: companies.updated_at,
      task_count: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id})`,
      failed_task_count: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id} AND ${tasks.status} IN ('failed', 'failed_permanent'))`,
      running_task_count: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id} AND ${tasks.status} = 'in_progress')`,
      credit_balance: sql<number>`COALESCE((SELECT ${creditLedger.balance_after} FROM ${creditLedger} WHERE ${creditLedger.company_id} = ${companies.id} ORDER BY ${creditLedger.created_at} DESC LIMIT 1), 0)::int`,
      last_task_at: sql<Date | null>`(SELECT MAX(${tasks.updated_at}) FROM ${tasks} WHERE ${tasks.company_id} = ${companies.id})`,
      last_event_at: sql<Date | null>`(SELECT MAX(${platformEvents.created_at}) FROM ${platformEvents} WHERE ${platformEvents.company_id} = ${companies.id})`,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(companies.created_at))
    .limit(normalizedInput.limit);
}

export async function getSuperAdminCompanyDetail(actor: SuperAdminActor, companyId: string) {
  await recordSuperAdminAudit(actor, 'view_company_detail', { type: 'company', id: companyId });

  const [company] = await db
    .select({
      id: companies.id,
      owner_id: companies.owner_id,
      owner_email: users.email,
      owner_name: users.name,
      name: companies.name,
      slug: companies.slug,
      one_liner: companies.one_liner,
      original_idea: companies.original_idea,
      claim_status: companies.claim_status,
      onboarding_status: companies.onboarding_status,
      onboarding_journey: companies.onboarding_journey,
      plan_tier: companies.plan_tier,
      lifecycle: companies.lifecycle,
      execution_state: companies.execution_state,
      billing_state: companies.billing_state,
      hosting_state: companies.hosting_state,
      subdomain: companies.subdomain,
      email_identity: companies.email_identity,
      github_repo: companies.github_repo,
      render_service_id: companies.render_service_id,
      neon_database_id: companies.neon_database_id,
      custom_domain: companies.custom_domain,
      company_email: companies.company_email,
      timezone: companies.timezone,
      created_at: companies.created_at,
      updated_at: companies.updated_at,
      deleted_at: companies.deleted_at,
    })
    .from(companies)
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) {
    return null;
  }

  const [
    counts,
    creditBalance,
    subscription,
    recentTasks,
    recentEvents,
    recentReports,
  ] = await Promise.all([
    db
      .select({
        tasks: sql<number>`(SELECT COUNT(*)::int FROM ${tasks} WHERE ${tasks.company_id} = ${companyId})`,
        documents: sql<number>`(SELECT COUNT(*)::int FROM ${documents} WHERE ${documents.company_id} = ${companyId})`,
        reports: sql<number>`(SELECT COUNT(*)::int FROM ${reports} WHERE ${reports.company_id} = ${companyId})`,
        emailThreads: sql<number>`(SELECT COUNT(*)::int FROM ${emailThreads} WHERE ${emailThreads.company_id} = ${companyId})`,
        chatSessions: sql<number>`(SELECT COUNT(*)::int FROM ${chatSessions} WHERE ${chatSessions.company_id} = ${companyId})`,
        adCampaigns: sql<number>`(SELECT COUNT(*)::int FROM ${adCampaigns} WHERE ${adCampaigns.company_id} = ${companyId})`,
        runs: sql<number>`(SELECT COUNT(*)::int FROM ${runs} INNER JOIN ${tasks} ON ${runs.task_id} = ${tasks.id} WHERE ${tasks.company_id} = ${companyId})`,
        events: sql<number>`(SELECT COUNT(*)::int FROM ${platformEvents} WHERE ${platformEvents.company_id} = ${companyId})`,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1),
    db
      .select({
        balance: creditLedger.balance_after,
      })
      .from(creditLedger)
      .where(eq(creditLedger.company_id, companyId))
      .orderBy(desc(creditLedger.created_at))
      .limit(1),
    db
      .select({
        id: subscriptions.id,
        plan_type: subscriptions.plan_type,
        status: subscriptions.status,
        trial_ends_at: subscriptions.trial_ends_at,
        night_shifts_remaining: subscriptions.night_shifts_remaining,
        night_shifts_total: subscriptions.night_shifts_total,
        current_period_start: subscriptions.current_period_start,
        current_period_end: subscriptions.current_period_end,
        created_at: subscriptions.created_at,
      })
      .from(subscriptions)
      .where(eq(subscriptions.company_id, companyId))
      .orderBy(desc(subscriptions.created_at))
      .limit(1),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        tag: tasks.tag,
        task_type: tasks.task_type,
        status: tasks.status,
        priority: tasks.priority,
        assigned_to_agent_id: tasks.assigned_to_agent_id,
        estimated_credits: tasks.estimated_credits,
        actual_credits_charged: tasks.actual_credits_charged,
        started_at: tasks.started_at,
        completed_at: tasks.completed_at,
        created_at: tasks.created_at,
        updated_at: tasks.updated_at,
      })
      .from(tasks)
      .where(eq(tasks.company_id, companyId))
      .orderBy(desc(tasks.created_at))
      .limit(10),
    db
      .select({
        id: platformEvents.id,
        event_type: platformEvents.event_type,
        is_public_safe: platformEvents.is_public_safe,
        created_at: platformEvents.created_at,
      })
      .from(platformEvents)
      .where(eq(platformEvents.company_id, companyId))
      .orderBy(desc(platformEvents.created_at))
      .limit(10),
    db
      .select({
        id: reports.id,
        task_id: reports.task_id,
        title: reports.title,
        report_type: reports.report_type,
        created_at: reports.created_at,
      })
      .from(reports)
      .where(eq(reports.company_id, companyId))
      .orderBy(desc(reports.created_at))
      .limit(10),
  ]);

  return {
    company,
    counts: counts[0],
    creditBalance: creditBalance[0]?.balance ?? 0,
    subscription: subscription[0] ?? null,
    recentTasks,
    recentEvents,
    recentReports,
  };
}

export async function getSuperAdminOperations(actor: SuperAdminActor) {
  await recordSuperAdminAudit(actor, 'view_operations');

  const now = new Date();
  const stuckCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [taskStats] = await db
    .select({
      totalTasks: sql<number>`COUNT(*)::int`,
      queuedTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'todo')::int`,
      runningTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'in_progress')::int`,
      stuckTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'in_progress' AND ${tasks.started_at} <= ${stuckCutoff})::int`,
      failedTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} IN ('failed', 'failed_permanent'))::int`,
      failedPermanentTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'failed_permanent')::int`,
      completed24h: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed' AND ${tasks.completed_at} >= ${since24h})::int`,
      completed7d: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed' AND ${tasks.completed_at} >= ${since7d})::int`,
    })
    .from(tasks);

  const [runStats] = await db
    .select({
      totalRuns: sql<number>`COUNT(*)::int`,
      runningRuns: sql<number>`COUNT(*) FILTER (WHERE ${runs.status} = 'running')::int`,
      failedRuns: sql<number>`COUNT(*) FILTER (WHERE ${runs.status} = 'failed')::int`,
      completedRuns24h: sql<number>`COUNT(*) FILTER (WHERE ${runs.status} IN ('completed', 'done') AND ${runs.ended_at} >= ${since24h})::int`,
    })
    .from(runs);

  const [eventStats] = await db
    .select({
      events24h: sql<number>`COUNT(*) FILTER (WHERE ${platformEvents.created_at} >= ${since24h})::int`,
      events7d: sql<number>`COUNT(*) FILTER (WHERE ${platformEvents.created_at} >= ${since7d})::int`,
      privateEvents7d: sql<number>`COUNT(*) FILTER (WHERE ${platformEvents.created_at} >= ${since7d} AND ${platformEvents.is_public_safe} = false)::int`,
    })
    .from(platformEvents);

  const recentFailedTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      tag: tasks.tag,
      status: tasks.status,
      failure_class: tasks.failure_class,
      actual_credits_charged: tasks.actual_credits_charged,
      completed_at: tasks.completed_at,
      updated_at: tasks.updated_at,
      company_id: companies.id,
      company_name: companies.name,
      owner_email: users.email,
    })
    .from(tasks)
    .innerJoin(companies, eq(tasks.company_id, companies.id))
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(or(eq(tasks.status, 'failed'), eq(tasks.status, 'failed_permanent')))
    .orderBy(desc(tasks.updated_at))
    .limit(12);

  const stuckTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      tag: tasks.tag,
      status: tasks.status,
      started_at: tasks.started_at,
      lease_expires_at: tasks.lease_expires_at,
      attempt_count: tasks.attempt_count,
      company_id: companies.id,
      company_name: companies.name,
      owner_email: users.email,
    })
    .from(tasks)
    .innerJoin(companies, eq(tasks.company_id, companies.id))
    .leftJoin(users, eq(companies.owner_id, users.id))
    .where(and(eq(tasks.status, 'in_progress'), lte(tasks.started_at, stuckCutoff)))
    .orderBy(desc(tasks.started_at))
    .limit(12);

  const recentRuns = await db
    .select({
      id: runs.id,
      status: runs.status,
      execution_mode: runs.execution_mode,
      failure_class: runs.failure_class,
      turn_count: runs.turn_count,
      started_at: runs.started_at,
      ended_at: runs.ended_at,
      task_id: tasks.id,
      task_title: tasks.title,
      company_id: companies.id,
      company_name: companies.name,
      agent_name: agents.name,
    })
    .from(runs)
    .innerJoin(tasks, eq(runs.task_id, tasks.id))
    .innerJoin(companies, eq(tasks.company_id, companies.id))
    .leftJoin(agents, eq(runs.agent_id, agents.id))
    .orderBy(desc(runs.created_at))
    .limit(12);

  const recentPlatformEvents = await db
    .select({
      id: platformEvents.id,
      event_type: platformEvents.event_type,
      is_public_safe: platformEvents.is_public_safe,
      created_at: platformEvents.created_at,
      company_id: companies.id,
      company_name: companies.name,
    })
    .from(platformEvents)
    .leftJoin(companies, eq(platformEvents.company_id, companies.id))
    .where(gte(platformEvents.created_at, since7d))
    .orderBy(desc(platformEvents.created_at))
    .limit(12);

  return {
    taskStats,
    runStats,
    eventStats,
    recentFailedTasks,
    stuckTasks,
    recentRuns,
    recentPlatformEvents,
  };
}

export async function getSuperAdminBilling(actor: SuperAdminActor) {
  await recordSuperAdminAudit(actor, 'view_billing');

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [subscriptionStats] = await db
    .select({
      totalSubscriptions: sql<number>`COUNT(*)::int`,
      activeSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.status} = 'active')::int`,
      trialSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.plan_type} = 'trial')::int`,
      pastDueSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.status} = 'past_due')::int`,
      cancelledSubscriptions: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.status} = 'cancelled')::int`,
      nightShiftsRemaining: sql<number>`COALESCE(SUM(${subscriptions.night_shifts_remaining}), 0)::int`,
    })
    .from(subscriptions);

  const [creditStats] = await db
    .select({
      creditsAdded7d: sql<number>`COALESCE(SUM(${creditLedger.amount}) FILTER (WHERE ${creditLedger.amount} > 0 AND ${creditLedger.created_at} >= ${since7d}), 0)::int`,
      creditsUsed7d: sql<number>`COALESCE(SUM(ABS(${creditLedger.amount})) FILTER (WHERE ${creditLedger.amount} < 0 AND ${creditLedger.created_at} >= ${since7d}), 0)::int`,
      creditEvents7d: sql<number>`COUNT(*) FILTER (WHERE ${creditLedger.created_at} >= ${since7d})::int`,
      negativeBalanceCompanies: sql<number>`(
        SELECT COUNT(*)::int
        FROM (
          SELECT DISTINCT ON (${creditLedger.company_id}) ${creditLedger.company_id}, ${creditLedger.balance_after}
          FROM ${creditLedger}
          ORDER BY ${creditLedger.company_id}, ${creditLedger.created_at} DESC
        ) latest
        WHERE latest.balance_after < 0
      )`,
    })
    .from(creditLedger);

  const [revenueStats] = await db
    .select({
      grossRevenue: sql<string>`COALESCE(SUM(${revenueLedger.gross_amount}), 0)::text`,
      netRevenue: sql<string>`COALESCE(SUM(${revenueLedger.net_amount}), 0)::text`,
      grossRevenue7d: sql<string>`COALESCE(SUM(${revenueLedger.gross_amount}) FILTER (WHERE ${revenueLedger.created_at} >= ${since7d}), 0)::text`,
      netRevenue7d: sql<string>`COALESCE(SUM(${revenueLedger.net_amount}) FILTER (WHERE ${revenueLedger.created_at} >= ${since7d}), 0)::text`,
    })
    .from(revenueLedger);

  const recentSubscriptions = await db
    .select({
      id: subscriptions.id,
      plan_type: subscriptions.plan_type,
      status: subscriptions.status,
      trial_ends_at: subscriptions.trial_ends_at,
      night_shifts_remaining: subscriptions.night_shifts_remaining,
      night_shifts_total: subscriptions.night_shifts_total,
      current_period_start: subscriptions.current_period_start,
      current_period_end: subscriptions.current_period_end,
      created_at: subscriptions.created_at,
      company_id: companies.id,
      company_name: companies.name,
      owner_email: users.email,
    })
    .from(subscriptions)
    .leftJoin(companies, eq(subscriptions.company_id, companies.id))
    .leftJoin(users, eq(companies.owner_id, users.id))
    .orderBy(desc(subscriptions.created_at))
    .limit(12);

  const recentCreditLedger = await db
    .select({
      id: creditLedger.id,
      entry_type: creditLedger.entry_type,
      amount: creditLedger.amount,
      balance_after: creditLedger.balance_after,
      task_id: creditLedger.task_id,
      created_at: creditLedger.created_at,
      company_id: companies.id,
      company_name: companies.name,
    })
    .from(creditLedger)
    .leftJoin(companies, eq(creditLedger.company_id, companies.id))
    .orderBy(desc(creditLedger.created_at))
    .limit(12);

  const recentRevenue = await db
    .select({
      id: revenueLedger.id,
      entry_type: revenueLedger.entry_type,
      gross_amount: revenueLedger.gross_amount,
      net_amount: revenueLedger.net_amount,
      platform_fee_rate: revenueLedger.platform_fee_rate,
      created_at: revenueLedger.created_at,
      company_id: companies.id,
      company_name: companies.name,
    })
    .from(revenueLedger)
    .leftJoin(companies, eq(revenueLedger.company_id, companies.id))
    .orderBy(desc(revenueLedger.created_at))
    .limit(12);

  return {
    subscriptionStats,
    creditStats,
    revenueStats,
    recentSubscriptions,
    recentCreditLedger,
    recentRevenue,
  };
}

function normalizeAuditAction(value: string | string[] | undefined): string | undefined {
  const normalized = Array.isArray(value) ? value[0]?.trim() : value?.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 100);
}

export async function getSuperAdminAuditLog(
  actor: SuperAdminActor,
  input: { action?: string | string[]; limit?: number } = {}
) {
  const action = normalizeAuditAction(input.action);
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));

  await recordSuperAdminAudit(actor, 'view_audit_log', undefined, {
    action,
    limit,
  });

  const filters: SQL[] = [];
  if (action) {
    filters.push(eq(superAdminAuditEvents.action, action));
  }

  return db
    .select({
      id: superAdminAuditEvents.id,
      admin_email: superAdminAuditEvents.admin_email,
      action: superAdminAuditEvents.action,
      target_type: superAdminAuditEvents.target_type,
      target_id: superAdminAuditEvents.target_id,
      created_at: superAdminAuditEvents.created_at,
    })
    .from(superAdminAuditEvents)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(superAdminAuditEvents.created_at))
    .limit(limit);
}
