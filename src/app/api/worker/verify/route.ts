import { NextRequest, NextResponse } from 'next/server';
import { verifyAndUpdate } from '@/lib/services/verification.service';
import { requireAuth, isApiError } from '@/lib/api-utils';
import { db, tasks, companies } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

// POST /api/worker/verify — run verification on a completed task
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (isApiError(auth)) return auth;

  let body: { taskId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  // Verify the task belongs to a company owned by the authenticated user
  const [task] = await db.select({ company_id: tasks.company_id })
    .from(tasks).where(eq(tasks.id, body.taskId)).limit(1);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const [company] = await db.select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.id, task.company_id), eq(companies.owner_id, auth.user.id)))
    .limit(1);

  if (!company) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await verifyAndUpdate(body.taskId);
    return NextResponse.json({
      ok: true,
      verification: {
        level: result.level,
        passed: result.passed,
        summary: result.summary,
        checks: result.checks,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verification failed' },
      { status: 500 }
    );
  }
}
