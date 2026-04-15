import { NextRequest, NextResponse } from 'next/server';
import * as taskService from '@/lib/services/task.service';
import { updateTaskSchema } from '@/lib/validations';
import { requireAuth, requireCompanyOwnership, parseJsonBody, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';

async function getTaskWithAuth(taskId: string) {
  // H-SEC-003: UUID validation before DB query
  if (!isValidUUID(taskId)) {
    return { error: NextResponse.json({ error: 'Invalid taskId format' }, { status: 400 }) } as const;
  }
  const auth = await requireAuth();
  if (isApiError(auth)) return { error: auth } as const;

  const task = await taskService.getTask(taskId);
  if (!task) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const;

  const ownership = await requireCompanyOwnership(task.company_id, auth.user.id);
  if (isApiError(ownership)) return { error: ownership } as const;

  return { task } as const;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const result = await getTaskWithAuth(taskId);
  if ('error' in result) return result.error;

  return NextResponse.json(result.task);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const result = await getTaskWithAuth(taskId);
  if ('error' in result) return result.error;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await taskService.updateTask(taskId, parsed.data);
  return NextResponse.json(updated);
}
