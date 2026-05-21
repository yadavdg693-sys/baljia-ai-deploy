import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { getOwnedAgentRun, markRunControlHandled, requestRunControl } from '@/lib/agents/runtime/agent-run-api.service';
import { launchTaskInBackground } from '@/lib/agents/runtime/agent-run-background';
import * as taskService from '@/lib/services/task.service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;
  const { runId } = await params;
  if (!isValidUUID(runId)) return NextResponse.json({ error: 'Invalid runId format' }, { status: 400 });
  const run = await getOwnedAgentRun(runId, auth.user.id);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const control = await requestRunControl({
    runId,
    taskId: run.task_id,
    action: 'resume',
    requestedBy: auth.user.id,
    reason: typeof body.reason === 'string' ? body.reason : 'manual resume requested',
    payload: body,
  });
  if (run.task_status === 'failed' || run.task_status === 'failed_permanent' || run.task_status === 'blocked_in_run') {
    await taskService.updateTask(run.task_id, {
      status: 'todo',
      failure_class: null,
      started_at: null,
      completed_at: null,
      turn_count: 0,
      actual_credits_charged: 0,
    });
  } else if (run.task_status !== 'todo') {
    return NextResponse.json({
      error: `Cannot resume task in "${run.task_status}" status. Fork or replay from this run instead.`,
    }, { status: 409 });
  }

  await markRunControlHandled(control.id, { ...body, resumed_task_id: run.task_id });
  launchTaskInBackground(run.task_id, { requestedBy: auth.user.id, source: 'agent-runs.resume', runId });
  return NextResponse.json({
    ok: true,
    status: 'resume_queued',
    resumed_from_run_id: runId,
    task_id: run.task_id,
  }, { status: 202 });
}
