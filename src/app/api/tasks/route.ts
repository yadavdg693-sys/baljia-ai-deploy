import { NextRequest, NextResponse } from 'next/server';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { createTaskSchema } from '@/lib/validations';
import { requireAuthAndCompany, getRequiredCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  const companyId = getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const tasks = await taskService.getTasks(companyId);
  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const { company_id: companyId, ...rest } = body as Record<string, unknown>;
  if (!companyId || typeof companyId !== 'string') {
    return NextResponse.json({ error: 'company_id required' }, { status: 400 });
  }

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const parsed = createTaskSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const task = await taskService.createTask({ company_id: companyId, ...parsed.data });

  await eventService.emit(companyId, 'task_created', {
    task_id: task.id,
    title: task.title,
  });

  return NextResponse.json(task, { status: 201 });
}
