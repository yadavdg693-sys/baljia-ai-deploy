import { NextRequest, NextResponse } from 'next/server';
import { launchTask, processQueue } from '@/lib/agents/worker-launcher';
import { requireAuth, requireAuthAndCompany, isApiError } from '@/lib/api-utils';
import { db, tasks } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { checkRateLimitAsync } from '@/lib/rate-limiter';

// POST /api/worker/launch
// Body: { taskId: string } — launch a specific task
// Body: { companyId: string } — process next task in queue
// FIX: C-SEC-005 — now verifies company ownership before launching
// FIX: G-SEC-003 — rate limited to 10 req/min
export async function POST(request: NextRequest) {
  // G-SEC-003: Rate limit task launches (10/min per IP, Redis-backed)
  const rateLimited = await checkRateLimitAsync(request, { maxRequests: 10, windowMs: 60000, keyPrefix: 'worker_launch' });
  if (rateLimited) return rateLimited;

  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Launch specific task
  if (body.taskId) {
    // C-SEC-005: Verify the user owns the company this task belongs to
    const [task] = await db.select({ company_id: tasks.company_id })
      .from(tasks).where(eq(tasks.id, body.taskId)).limit(1);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const ownerCheck = await requireAuthAndCompany(task.company_id);
    if (isApiError(ownerCheck)) return ownerCheck;

    try {
      const execution = await launchTask(body.taskId);
      return NextResponse.json({
        ok: true,
        execution: {
          id: execution.id,
          status: execution.status,
          turn_count: execution.turn_count,
          error_summary: execution.error_summary,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Launch failed' },
        { status: 500 }
      );
    }
  }

  // Process queue for a company
  if (body.companyId) {
    // C-SEC-005: Verify ownership
    const ownerCheck = await requireAuthAndCompany(body.companyId);
    if (isApiError(ownerCheck)) return ownerCheck;

    try {
      const count = await processQueue(body.companyId);
      return NextResponse.json({ ok: true, tasks_processed: count });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Queue processing failed' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: 'taskId or companyId required' }, { status: 400 });
}
