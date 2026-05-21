// Gate 1: admin queue of platform-ops triaged bugs awaiting approval.
// Shows the diagnosis + which files would change, with Approve/Reject
// buttons that route to the writer agent (Phase B).
//
// Auth: requires user.email in ADMIN_EMAILS.

import { getSessionFromCookies } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, desc, sql, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function isAdminEmail(email: string | null | undefined): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return adminEmails.length > 0 && adminEmails.includes((email ?? '').toLowerCase());
}

export default async function PlatformOpsFeedbackQueue() {
  const user = await getSessionFromCookies();
  if (!user) redirect('/login?next=/admin/feedback');
  if (!isAdminEmail(user.email)) redirect('/?error=admin-required');

  // All non-resolved/rejected/wont_fix bugs, sorted by severity then age
  const queue = await db
    .select({
      id: platformFeedback.id,
      title: platformFeedback.title,
      description: platformFeedback.description,
      severity: platformFeedback.severity,
      status: platformFeedback.status,
      source: platformFeedback.source,
      area: platformFeedback.area,
      occurrence_count: platformFeedback.occurrence_count,
      last_seen_at: platformFeedback.last_seen_at,
      diagnosis: platformFeedback.diagnosis,
      estimated_risk: platformFeedback.estimated_risk,
      ops_run_id: platformFeedback.ops_run_id,
      created_at: platformFeedback.created_at,
      reproduced_at: platformFeedback.reproduced_at,
    })
    .from(platformFeedback)
    .where(inArray(platformFeedback.status, ['open', 'awaiting_approval', 'approved_to_fix', 'pr_open']))
    .orderBy(
      sql`CASE WHEN ${platformFeedback.severity} = 'critical' THEN 0 WHEN ${platformFeedback.severity} = 'high' THEN 1 WHEN ${platformFeedback.severity} = 'medium' THEN 2 ELSE 3 END`,
      desc(platformFeedback.created_at),
    );

  // Stats — counts by status
  const counts = {
    awaiting: queue.filter((q) => q.status === 'awaiting_approval').length,
    open: queue.filter((q) => q.status === 'open').length,
    approved: queue.filter((q) => q.status === 'approved_to_fix').length,
    pr_open: queue.filter((q) => q.status === 'pr_open').length,
  };

  // Latest run cost summary
  const today = new Date().toISOString().split('T')[0];
  const [todayCost] = await db
    .select({
      cost: sql<number>`COALESCE(SUM(${platformOpsRuns.cost_cents}), 0)::int`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(platformOpsRuns)
    .where(sql`${platformOpsRuns.created_at} >= ${today + 'T00:00:00Z'}::timestamptz`);

  return (
    <div style={{ padding: '20px 32px', maxWidth: 1100, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22 }}>Platform-Ops Triage Queue</h1>
      <p style={{ color: '#666', fontSize: 13 }}>Bugs reported by Baljia agents, triaged by the platform-ops triage agent. Review the diagnosis and approve to dispatch the writer agent (Phase B), or reject if the bug isn&apos;t worth fixing.</p>

      <div style={{ display: 'flex', gap: 18, padding: '14px 0', flexWrap: 'wrap', fontSize: 13 }}>
        <span><strong>{counts.awaiting}</strong> awaiting approval (Gate 1)</span>
        <span><strong>{counts.open}</strong> not yet triaged</span>
        <span><strong>{counts.approved}</strong> approved (writer pending)</span>
        <span><strong>{counts.pr_open}</strong> PR open (Gate 2)</span>
        <span style={{ color: '#666' }}>Today: {todayCost?.count ?? 0} runs, ${(((todayCost?.cost ?? 0)) / 100).toFixed(2)} LLM cost</span>
      </div>

      {queue.length === 0 ? (
        <p style={{ padding: 40, textAlign: 'center', color: '#666' }}>Empty queue. Cron triage runs hourly at :05.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <tr>
              <th style={{ padding: 8 }}>Severity</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Source</th>
              <th style={{ padding: 8 }}>Seen</th>
              <th style={{ padding: 8 }}>Risk</th>
              <th style={{ padding: 8 }}>Title</th>
              <th style={{ padding: 8 }}>Triaged</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => {
              const sevColor = { critical: '#dc2626', high: '#d97706', medium: '#6b7280', low: '#9ca3af' }[row.severity ?? 'medium'] ?? '#6b7280';
              const statusColor = {
                'awaiting_approval': '#d97706',
                'open': '#9ca3af',
                'approved_to_fix': '#3b82f6',
                'pr_open': '#10b981',
              }[row.status ?? ''] ?? '#6b7280';
              return (
                <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}>
                    <span style={{ background: sevColor, color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{row.severity}</span>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ color: statusColor, fontSize: 12, fontWeight: 600 }}>{row.status}</span>
                  </td>
                  <td style={{ padding: 8, fontSize: 12 }}>
                    <span>{row.source ?? 'user'}</span>
                    {row.area && <span style={{ color: '#777' }}> / {row.area}</span>}
                  </td>
                  <td style={{ padding: 8, fontSize: 12 }}>{row.occurrence_count ?? 1}x</td>
                  <td style={{ padding: 8, fontSize: 12 }}>{row.estimated_risk ?? '—'}</td>
                  <td style={{ padding: 8 }}>
                    <Link href={`/admin/feedback/${row.id}`} style={{ color: '#1e40af', textDecoration: 'none' }}>{row.title}</Link>
                  </td>
                  <td style={{ padding: 8, fontSize: 11, color: '#666' }}>
                    {row.reproduced_at ? new Date(row.reproduced_at).toLocaleString() : '(not yet)'}
                  </td>
                  <td style={{ padding: 8 }}>
                    <Link href={`/admin/feedback/${row.id}`} style={{ background: '#e5e7eb', padding: '4px 12px', borderRadius: 4, textDecoration: 'none', color: '#111', fontSize: 12 }}>Review</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 30, fontSize: 11, color: '#999' }}>
        Kill switch: set PLATFORM_OPS_PAUSED=true to halt the cron. Daily LLM cap: ${process.env.PLATFORM_OPS_DAILY_BUDGET_USD ?? '20'}.
      </p>
    </div>
  );
}
