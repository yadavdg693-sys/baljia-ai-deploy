import { NextRequest, NextResponse } from 'next/server';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { requireAuth, requireCompanyOwnership, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';

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

  const retryableStatuses = ['failed', 'failed_permanent'];
  if (!retryableStatuses.includes(task.status)) {
    return NextResponse.json(
      { error: `Cannot retry task in "${task.status}" status` },
      { status: 400 }
    );
  }

  const ownership = await requireCompanyOwnership(task.company_id, auth.user.id);
  if (isApiError(ownership)) return ownership;

  const retried = await taskService.retryTask(taskId);

  await eventService.emit(task.company_id, 'task_retried', {
    task_id: task.id,
    title: task.title,
    previous_status: task.status,
  });

  return NextResponse.json(taskService.stripTaskInternalFields(retried));
}
