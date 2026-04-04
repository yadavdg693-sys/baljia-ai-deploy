import { NextRequest, NextResponse } from 'next/server';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { requireAuth, requireCompanyOwnership, isApiError } from '@/lib/api-utils';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const task = await taskService.getTask(taskId);
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (task.status !== 'created') {
    return NextResponse.json(
      { error: `Cannot approve task in "${task.status}" status` },
      { status: 400 }
    );
  }

  const ownership = await requireCompanyOwnership(task.company_id, auth.user.id);
  if (isApiError(ownership)) return ownership;

  const approved = await taskService.approveTask(taskId);

  await eventService.emit(task.company_id, 'task_approved', {
    task_id: task.id,
    title: task.title,
  });

  return NextResponse.json(approved);
}
