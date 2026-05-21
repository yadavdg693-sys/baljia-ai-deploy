import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { getOwnedAgentRun, requestRunControl } from '@/lib/agents/runtime/agent-run-api.service';

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
    action: 'abort',
    requestedBy: auth.user.id,
    reason: typeof body.reason === 'string' ? body.reason : 'manual abort requested',
    payload: body,
  });
  return NextResponse.json({ ok: true, status: 'abort_requested', control }, { status: 202 });
}
