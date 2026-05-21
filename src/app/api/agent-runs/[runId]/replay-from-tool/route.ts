import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { getOwnedAgentRun, markRunControlHandled, requestRunControl } from '@/lib/agents/runtime/agent-run-api.service';
import { launchTaskInBackground } from '@/lib/agents/runtime/agent-run-background';
import * as taskService from '@/lib/services/task.service';
import type { ExecutionMode, VerificationLevel } from '@/types';

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
    action: 'replay_from_tool',
    requestedBy: auth.user.id,
    reason: typeof body.reason === 'string' ? body.reason : 'manual replay requested',
    payload: body,
  });

  const replayAnchor = typeof body.tool_call_id === 'string'
    ? `tool_call_id=${body.tool_call_id}`
    : typeof body.sequence === 'number'
      ? `sequence=${body.sequence}`
      : 'latest failed or selected tool call';
  const childTask = await taskService.createTask({
    company_id: run.company_id,
    title: `Replay: ${run.task_title}`,
    description: [
      `Replay Engineering Agent run ${runId} from ${replayAnchor}.`,
      typeof body.reason === 'string' ? `Reason: ${body.reason}` : null,
      '',
      'Original task:',
      run.task_description ?? run.task_title,
      '',
      'Replay requirements:',
      '- Reconstruct state from structured run events/tool calls before editing.',
      '- Re-run the failed or selected tool step with corrected inputs.',
      '- Parent Engineering Agent must pass the full completion gate before reporting done.',
    ].filter(Boolean).join('\n'),
    tag: run.task_tag,
    priority: run.task_priority ?? 50,
    source: 'auto_remediation',
    status: 'todo',
    assigned_to_agent_id: run.agent_id ?? 30,
    estimated_credits: run.task_estimated_credits ?? 1,
    max_turns: run.task_max_turns ?? 200,
    execution_mode: run.execution_mode as ExecutionMode,
    verification_level: (run.task_verification_level ?? undefined) as VerificationLevel | undefined,
    related_task_ids: [run.task_id],
    authorized_by: 'system',
    authorization_reason: `Replay requested from agent run ${runId}`,
  });

  await markRunControlHandled(control.id, { ...body, child_task_id: childTask.id });
  if (body.launch !== false) {
    launchTaskInBackground(childTask.id, { requestedBy: auth.user.id, source: 'agent-runs.replay', runId });
  }
  return NextResponse.json({
    ok: true,
    status: body.launch === false ? 'replay_task_created' : 'replay_queued',
    source_run_id: runId,
    task_id: childTask.id,
    control_id: control.id,
  }, { status: body.launch === false ? 201 : 202 });
}
