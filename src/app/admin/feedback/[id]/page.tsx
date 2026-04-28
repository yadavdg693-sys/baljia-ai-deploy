// Single bug detail with full diagnosis + Approve/Reject buttons.
// POST to /api/admin/feedback/[id]/decision when clicked.

import { getSessionFromCookies } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function isAdminEmail(email: string | null | undefined): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return adminEmails.length > 0 && adminEmails.includes((email ?? '').toLowerCase());
}

interface Props { params: Promise<{ id: string }>; }

export default async function PlatformOpsFeedbackDetail({ params }: Props) {
  const user = await getSessionFromCookies();
  if (!user) redirect('/login?next=/admin/feedback');
  if (!isAdminEmail(user.email)) redirect('/?error=admin-required');

  const { id } = await params;
  const [bug] = await db.select().from(platformFeedback).where(eq(platformFeedback.id, id)).limit(1);
  if (!bug) notFound();

  // Latest triage run for this bug
  const [run] = await db.select().from(platformOpsRuns)
    .where(eq(platformOpsRuns.feedback_id, bug.id))
    .orderBy(desc(platformOpsRuns.created_at))
    .limit(1);

  const isAwaitingApproval = bug.status === 'awaiting_approval';

  return (
    <div style={{ padding: '20px 32px', maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui' }}>
      <Link href="/admin/feedback" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>← Back to queue</Link>
      <h1 style={{ fontSize: 22, marginTop: 8 }}>{bug.title}</h1>

      <div style={{ display: 'flex', gap: 14, padding: '8px 0', fontSize: 12 }}>
        <span style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 4 }}>severity: <strong>{bug.severity}</strong></span>
        <span style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 4 }}>status: <strong>{bug.status}</strong></span>
        {bug.estimated_risk && <span style={{ background: '#e5e7eb', padding: '2px 8px', borderRadius: 4 }}>fix risk: <strong>{bug.estimated_risk}</strong></span>}
        <span style={{ color: '#666' }}>id: {bug.id.slice(0, 8)}…</span>
      </div>

      <h3 style={{ fontSize: 15, marginTop: 20 }}>Original report</h3>
      <pre style={{ background: '#f9fafb', padding: 14, fontSize: 12, whiteSpace: 'pre-wrap', borderRadius: 6, border: '1px solid #e5e7eb' }}>{bug.description ?? '(no description)'}</pre>

      <h3 style={{ fontSize: 15, marginTop: 24 }}>Triage diagnosis</h3>
      {bug.diagnosis ? (
        <pre style={{ background: '#fef3c7', padding: 14, fontSize: 12, whiteSpace: 'pre-wrap', borderRadius: 6, border: '1px solid #fbbf24' }}>{bug.diagnosis}</pre>
      ) : (
        <p style={{ color: '#666', fontSize: 12 }}>(not yet triaged — waiting for next cron run at :05)</p>
      )}

      {run && (
        <>
          <h3 style={{ fontSize: 15, marginTop: 24 }}>Audit row (latest run)</h3>
          <table style={{ fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
            <tbody>
              <tr><td style={{ padding: 4, color: '#666' }}>role</td><td style={{ padding: 4 }}>{run.agent_role}</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>phase</td><td style={{ padding: 4 }}>{run.phase}</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>status</td><td style={{ padding: 4 }}>{run.status}</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>turns</td><td style={{ padding: 4 }}>{run.turns ?? '—'}</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>wall clock</td><td style={{ padding: 4 }}>{run.wall_clock_seconds ?? '—'}s</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>cost</td><td style={{ padding: 4 }}>${((run.cost_cents ?? 0) / 100).toFixed(2)}</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>model</td><td style={{ padding: 4 }}>{run.llm_provider}/{run.llm_model}</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>files to modify</td><td style={{ padding: 4 }}>{(run.files_to_modify as string[] ?? []).join(', ') || '—'}</td></tr>
              <tr><td style={{ padding: 4, color: '#666' }}>reproduces</td><td style={{ padding: 4 }}>{run.reproduces === null ? '—' : run.reproduces ? 'YES' : 'NO (stale)'}</td></tr>
            </tbody>
          </table>
        </>
      )}

      {isAwaitingApproval && (
        <div style={{ marginTop: 30, padding: 16, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Gate 1 decision</h3>
          <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Approve dispatches the writer agent. Reject closes the bug as wont_fix.
          </p>
          <form method="POST" action={`/api/admin/feedback/${bug.id}/decision`} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" name="decision" value="approve" style={{ background: '#16a34a', color: 'white', padding: '8px 18px', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>✓ Approve → dispatch writer</button>
            <button type="submit" name="decision" value="reject" style={{ background: '#dc2626', color: 'white', padding: '8px 18px', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>✗ Reject (won&apos;t fix)</button>
            <button type="submit" name="decision" value="needs_more_info" style={{ background: '#f59e0b', color: 'white', padding: '8px 18px', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>? Needs more info</button>
          </form>
        </div>
      )}

      {bug.status === 'resolved' && bug.resolution && (
        <div style={{ marginTop: 30, padding: 16, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6 }}>
          <strong>Resolved</strong> — resolution: {bug.resolution}
        </div>
      )}
    </div>
  );
}
