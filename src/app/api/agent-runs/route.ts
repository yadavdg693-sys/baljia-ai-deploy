import { NextRequest, NextResponse } from 'next/server';
import { db, tasks } from '@/lib/db';
import { requireAuth, requireCompanyOwnership, isApiError } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/uuid-validation';
import { listOwnedAgentRuns } from '@/lib/agents/runtime/agent-run-api.service';
import { launchTaskInBackground } from '@/lib/agents/runtime/agent-run-background';
import { eq } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 20), 100);
  const runs = await listOwnedAgentRuns(auth.user.id, Number.isFinite(limit) ? limit : 20);
  return NextResponse.json({ runs });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  let body: { taskId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.taskId || !isValidUUID(body.taskId)) {
    return NextResponse.json({ error: 'taskId must be a valid UUID' }, { status: 400 });
  }

  const [task] = await db.select({ company_id: tasks.company_id }).from(tasks).where(eq(tasks.id, body.taskId)).limit(1);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const ownership = await requireCompanyOwnership(task.company_id, auth.user.id);
  if (isApiError(ownership)) return ownership;

  launchTaskInBackground(body.taskId, { requestedBy: auth.user.id, source: 'agent-runs.create' });
  return NextResponse.json({
    ok: true,
    status: 'launch_queued',
    task_id: body.taskId,
  }, { status: 202 });
}
