// Gate 1 decision endpoint: admin approves or rejects a triaged bug.
// approve  → status='approved_to_fix' (writer agent picks up next)
// reject   → status='wont_fix', resolution='rejected'
// needs_more_info → status='open' (re-triage on next cron)

import { NextRequest, NextResponse } from 'next/server';
import { db, platformFeedback } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/api-utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminFeedbackDecision');

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  let decision: string;
  let note: string | undefined;

  // Accept form-encoded (HTML form posts) or JSON
  const ctype = request.headers.get('content-type') ?? '';
  if (ctype.includes('application/json')) {
    const body = await request.json() as { decision?: string; note?: string };
    decision = String(body.decision ?? '').trim();
    note = body.note;
  } else {
    const form = await request.formData();
    decision = String(form.get('decision') ?? '').trim();
    note = form.get('note') as string | undefined;
  }

  const [bug] = await db.select().from(platformFeedback).where(eq(platformFeedback.id, id)).limit(1);
  if (!bug) return NextResponse.json({ error: 'bug not found' }, { status: 404 });
  if (bug.status !== 'awaiting_approval') {
    return NextResponse.json({
      error: `bug not in awaiting_approval (current: ${bug.status})`,
    }, { status: 400 });
  }

  const adminEmail = auth.user.email ?? 'unknown';
  const now = new Date();

  switch (decision) {
    case 'approve':
      await db.update(platformFeedback).set({
        status: 'approved_to_fix',
        approved_at: now,
        approved_by: `human:${adminEmail}`,
      }).where(eq(platformFeedback.id, id));
      log.info('Bug approved', { id, by: adminEmail });
      break;

    case 'reject':
      await db.update(platformFeedback).set({
        status: 'wont_fix',
        resolution: 'rejected',
        approved_at: now,
        approved_by: `human:${adminEmail}`,
      }).where(eq(platformFeedback.id, id));
      log.info('Bug rejected', { id, by: adminEmail, note });
      break;

    case 'needs_more_info':
      // Reset to open so next cron triage re-runs
      await db.update(platformFeedback).set({
        status: 'open',
        ops_run_id: null,  // force fresh triage
      }).where(eq(platformFeedback.id, id));
      log.info('Bug needs more info, reset to open', { id, by: adminEmail });
      break;

    default:
      return NextResponse.json({ error: `invalid decision: ${decision}` }, { status: 400 });
  }

  // After form post, redirect back to queue
  if (!ctype.includes('application/json')) {
    return NextResponse.redirect(new URL('/admin/feedback', request.url));
  }
  return NextResponse.json({ ok: true, decision, id });
}
