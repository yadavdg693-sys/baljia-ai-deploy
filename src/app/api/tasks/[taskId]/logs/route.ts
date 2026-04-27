// GET /api/tasks/:taskId/logs — execution log for a task (founder-safe surface).
// Mirrors the CEO `get_task_execution_logs` tool but exposed via REST so the
// TaskDetailDialog can show the same step-by-step view the chat shows.

import { NextRequest, NextResponse } from 'next/server';
import { db, taskExecutions } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import { requireAuth, requireCompanyOwnership, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { getAgentName } from '@/lib/services/router.service';

// Founder-safe event whitelist (matches handleGetTaskExecutionLogs in ceo.tool-handlers.ts).
const SAFE_EVENT_TYPES = new Set([
  'task_started',
  'task_completed',
  'task_failed',
  'progress',
  'message',
  'error_summary',
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  if (!isValidUUID(taskId)) {
    return NextResponse.json({ error: 'Invalid taskId format' }, { status: 400 });
  }

  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const task = await taskService.getTask(taskId);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ownership = await requireCompanyOwnership(task.company_id, auth.user.id);
  if (isApiError(ownership)) return ownership;

  const [execution] = await db.select({
    execution_log: taskExecutions.execution_log,
    turn_count: taskExecutions.turn_count,
    agent_id: taskExecutions.agent_id,
    started_at: taskExecutions.started_at,
    completed_at: taskExecutions.completed_at,
  })
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, taskId))
    .orderBy(desc(taskExecutions.started_at))
    .limit(1);

  if (!execution) {
    return NextResponse.json({
      task_id: taskId,
      status: task.status,
      events: [],
      summary: 'No execution logs available for this task yet.',
    });
  }

  const rawLogs = (execution.execution_log ?? []) as Array<Record<string, unknown>>;
  const events = rawLogs
    .filter((entry) => {
      const evt = String(entry.event ?? '');
      return SAFE_EVENT_TYPES.has(evt) || typeof entry.message === 'string';
    })
    .map((entry, idx) => ({
      idx,
      event: String(entry.event ?? entry.message ?? ''),
      timestamp: entry.timestamp ?? null,
      message: typeof entry.message === 'string' ? entry.message : null,
    }));

  return NextResponse.json({
    task_id: taskId,
    status: task.status,
    agent_name: execution.agent_id ? getAgentName(execution.agent_id) : null,
    turn_count: execution.turn_count ?? 0,
    started_at: execution.started_at,
    completed_at: execution.completed_at,
    events,
  });
}
