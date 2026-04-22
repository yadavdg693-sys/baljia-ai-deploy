import { NextRequest, NextResponse } from 'next/server';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import * as creditService from '@/lib/services/credit.service';
import { launchTask } from '@/lib/agents/worker-launcher';
import { requireAuth, requireCompanyOwnership, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('TaskApprove');

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  if (!isValidUUID(taskId)) return NextResponse.json({ error: 'Invalid taskId format' }, { status: 400 });
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const task = await taskService.getTask(taskId);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (task.status !== 'todo') {
    return NextResponse.json(
      { error: `Cannot approve task in "${task.status}" status` },
      { status: 400 }
    );
  }

  const ownership = await requireCompanyOwnership(task.company_id, auth.user.id);
  if (isApiError(ownership)) return ownership;

  // ── Pre-launch validation (fast, ~50ms) ──
  // Catch the common blockers synchronously so the founder gets immediate feedback.
  const [company] = await db.select({ lifecycle: companies.lifecycle, execution_state: companies.execution_state })
    .from(companies).where(eq(companies.id, task.company_id)).limit(1);

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const ACTIVE_LIFECYCLES = ['trial_active', 'full_active'];
  if (!ACTIVE_LIFECYCLES.includes(company.lifecycle ?? '')) {
    return NextResponse.json(
      { error: `Your account (${(company.lifecycle ?? 'unknown').replace(/_/g, ' ')}) cannot run tasks right now.` },
      { status: 409 }
    );
  }
  if (company.execution_state === 'suspended') {
    return NextResponse.json({ error: 'Execution is suspended on this account.' }, { status: 409 });
  }

  const balance = await creditService.getBalance(task.company_id);
  if (balance < 1) {
    return NextResponse.json({ error: 'Insufficient credits. Purchase more to run tasks.' }, { status: 409 });
  }

  // ── Approve ──
  await taskService.updateTask(taskId, {
    authorized_by: 'founder',
    authorization_reason: `Founder approved via dashboard (user: ${auth.user.id})`,
  });

  await eventService.emit(task.company_id, 'task_approved', {
    task_id: task.id,
    title: task.title,
  });

  // ── Launch in background ──
  // launchTask handles slot claim, credit deduction, agent dispatch, verification.
  // It runs for minutes/hours — don't block the HTTP response.
  // On Render (long-running Node process), the promise continues after response is sent.
  launchTask(taskId).catch((err) => {
    log.error('Background task launch failed', {
      taskId,
      title: task.title,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  });

  return NextResponse.json({
    id: task.id,
    title: task.title,
    status: 'in_progress',
    launched: true,
  });
}
