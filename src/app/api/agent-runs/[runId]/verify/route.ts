import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { getOwnedAgentRun, markRunControlHandled, requestRunControl } from '@/lib/agents/runtime/agent-run-api.service';
import { verifyTaskInBackground } from '@/lib/agents/runtime/agent-run-background';

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
    action: 'verify',
    requestedBy: auth.user.id,
    reason: typeof body.reason === 'string' ? body.reason : 'manual verifier rerun requested',
    payload: body,
  });
  await markRunControlHandled(control.id, body);
  verifyTaskInBackground(run.task_id, { requestedBy: auth.user.id, source: 'agent-runs.verify', runId });
  return NextResponse.json({
    ok: true,
    status: 'verification_queued',
    task_id: run.task_id,
    control_id: control.id,
  }, { status: 202 });
}
