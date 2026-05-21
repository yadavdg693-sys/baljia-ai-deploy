import { NextResponse } from 'next/server';
import { getFailureSummary, getTopFailures } from '@/lib/services/failure.service';
import { getLiveWallMetrics } from '@/lib/services/live-stream.service';
import { requireAdmin, isApiError } from '@/lib/api-utils';
import { db, platformFeedback } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

// GET /api/ops/dashboard — platform ops monitoring (admin only)
// FIX: C-SEC-002 — now requires authentication
// FIX: G-RBAC-001 — now requires admin role (ADMIN_EMAILS env)
export async function GET() {
  // G-RBAC-001: Require admin access (was previously open to all authed users)
  const auth = await requireAdmin();
  if (isApiError(auth)) return auth;

  try {
    const [failures, topFailures, metrics] = await Promise.all([
      getFailureSummary(),
      getTopFailures(5),
      getLiveWallMetrics(),
    ]);
    const [onboardingIssues] = await db
      .select({
        open: sql<number>`COUNT(*) FILTER (WHERE ${platformFeedback.status} IN ('open', 'awaiting_approval', 'approved_to_fix', 'pr_open'))::int`,
        totalOccurrences: sql<number>`COALESCE(SUM(${platformFeedback.occurrence_count}), 0)::int`,
      })
      .from(platformFeedback)
      .where(eq(platformFeedback.area, 'onboarding'));

    const recentOnboardingIssues = await db
      .select({
        id: platformFeedback.id,
        title: platformFeedback.title,
        severity: platformFeedback.severity,
        status: platformFeedback.status,
        source: platformFeedback.source,
        occurrence_count: platformFeedback.occurrence_count,
        last_seen_at: platformFeedback.last_seen_at,
      })
      .from(platformFeedback)
      .where(sql`${platformFeedback.area} = 'onboarding' AND ${platformFeedback.status} IN ('open', 'awaiting_approval', 'approved_to_fix', 'pr_open')`)
      .orderBy(sql`${platformFeedback.last_seen_at} DESC NULLS LAST`)
      .limit(5);

    return NextResponse.json({
      ok: true,
      platform: {
        active_companies: metrics.active_companies,
        tasks_today: metrics.tasks_today,
        tasks_running: metrics.tasks_running,
        messages_today: metrics.messages_today,
        emails_today: metrics.emails_today,
        arr: metrics.annual_run_rate,
      },
      failures: {
        total_fingerprints: failures.total_fingerprints,
        total_occurrences: failures.total_occurrences,
        fixed: failures.fixed,
        unfixed: failures.unfixed,
        by_category: failures.by_category,
      },
      onboarding_issues: {
        open: onboardingIssues?.open ?? 0,
        total_occurrences: onboardingIssues?.totalOccurrences ?? 0,
        recent: recentOnboardingIssues,
      },
      top_failures: topFailures.map((f) => ({
        id: f.id,
        category: f.category,
        pattern: (f.description ?? '').slice(0, 100),  // DB: description (not error_pattern)
        occurrences: f.occurrence_count,
        fix_status: f.fix_status,
        last_seen: f.last_seen_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Dashboard error' },
      { status: 500 }
    );
  }
}
