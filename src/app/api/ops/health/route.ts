import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-utils';
import * as failureService from '@/lib/services/failure.service';
import { db, platformEvents, tasks, companies, platformFeedback } from '@/lib/db';
import { gte, desc, count, sql } from 'drizzle-orm';

// GET /api/ops/health
// Admin-only: returns platform health metrics for the ops monitoring surface
export async function GET() {
  const authResult = await requireAdmin();
  if (authResult instanceof NextResponse) return authResult;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Failure summary
  const failureSummary = await failureService.getFailureSummary();
  const topFailures = await failureService.getTopFailures(5);
  const recentFailures = await failureService.getRecentFailures(since24h.toISOString());

  // Guardrail events (last 24h)
  const guardrailEvents = await db
    .select({ payload: platformEvents.payload, created_at: platformEvents.created_at })
    .from(platformEvents)
    .where(
      sql`${platformEvents.event_type} IN ('guardrail_escalation', 'guardrail_cleared') AND ${platformEvents.created_at} >= ${since24h}`
    )
    .orderBy(desc(platformEvents.created_at))
    .limit(20);

  const onboardingIssues = await db
    .select({
      id: platformFeedback.id,
      title: platformFeedback.title,
      severity: platformFeedback.severity,
      status: platformFeedback.status,
      source: platformFeedback.source,
      occurrence_count: platformFeedback.occurrence_count,
      last_seen_at: platformFeedback.last_seen_at,
      metadata: platformFeedback.metadata,
    })
    .from(platformFeedback)
    .where(sql`${platformFeedback.area} = 'onboarding' AND ${platformFeedback.last_seen_at} >= ${since24h}`)
    .orderBy(sql`${platformFeedback.last_seen_at} DESC NULLS LAST`)
    .limit(20);

  const [onboardingIssueStats] = await db
    .select({
      rows_24h: count(),
      total_occurrences_24h: sql<number>`COALESCE(SUM(${platformFeedback.occurrence_count}), 0)::int`,
      open: sql<number>`COUNT(*) FILTER (WHERE ${platformFeedback.status} IN ('open', 'awaiting_approval', 'approved_to_fix', 'pr_open'))::int`,
    })
    .from(platformFeedback)
    .where(sql`${platformFeedback.area} = 'onboarding' AND ${platformFeedback.last_seen_at} >= ${since24h}`);

  // Task status distribution (last 7 days)
  const taskStats = await db
    .select({ status: tasks.status, count: count() })
    .from(tasks)
    .where(gte(tasks.created_at, since7d))
    .groupBy(tasks.status);

  // Companies by execution_state
  const companyStates = await db
    .select({ execution_state: companies.execution_state, count: count() })
    .from(companies)
    .groupBy(companies.execution_state);

  // Recent platform events volume (last 24h)
  const [eventVolume] = await db
    .select({ count: count() })
    .from(platformEvents)
    .where(gte(platformEvents.created_at, since24h));

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    failure_summary: failureSummary,
    top_failures: topFailures.map((f) => ({
      id: f.id,
      category: f.category,
      description: f.description,
      occurrence_count: f.occurrence_count,
      fix_status: f.fix_status,
      regression_sensitive: f.regression_sensitive,
      last_seen_at: f.last_seen_at,
    })),
    recent_failures_24h: recentFailures.length,
    onboarding_issues_24h: {
      rows: onboardingIssueStats?.rows_24h ?? 0,
      total_occurrences: onboardingIssueStats?.total_occurrences_24h ?? 0,
      open: onboardingIssueStats?.open ?? 0,
      recent: onboardingIssues,
    },
    guardrail_events_24h: guardrailEvents,
    task_stats_7d: taskStats,
    company_execution_states: companyStates,
    event_volume_24h: eventVolume?.count ?? 0,
  });
}
