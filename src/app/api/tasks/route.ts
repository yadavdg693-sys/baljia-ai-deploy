import { NextRequest, NextResponse } from 'next/server';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { createTaskSchema } from '@/lib/validations';
import { requireAuthAndCompany, getRequiredCompanyId, resolveBodyCompanyId, parseJsonBody, isApiError } from '@/lib/api-utils';
import { routeTaskStrict } from '@/lib/services/router.service';
import { engineeringContractBlockReason } from '@/lib/agents/execution-contract';

export async function GET(request: NextRequest) {
  const companyId = await getRequiredCompanyId(request);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const tasks = await taskService.getTasks(companyId);
  return NextResponse.json(tasks.map(taskService.stripTaskInternalFields));
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const { company_id: _rawId, ...rest } = body as Record<string, unknown>;
  const companyId = await resolveBodyCompanyId(body as Record<string, unknown>);
  if (isApiError(companyId)) return companyId;

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const parsed = createTaskSchema.safeParse(rest);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const agentId = routeTaskStrict(parsed.data.tag);
  if (agentId === null) {
    return NextResponse.json({ error: `Unknown task tag "${parsed.data.tag}".` }, { status: 400 });
  }
  const contractBlockReason = engineeringContractBlockReason({
    ...parsed.data,
    assigned_to_agent_id: agentId,
  });
  if (contractBlockReason) {
    return NextResponse.json({ error: contractBlockReason }, { status: 400 });
  }

  const task = await taskService.createTask({ company_id: companyId, ...parsed.data });

  await eventService.emit(companyId, 'task_created', {
    task_id: task.id,
    title: task.title,
  });

  return NextResponse.json(taskService.stripTaskInternalFields(task), { status: 201 });
}
