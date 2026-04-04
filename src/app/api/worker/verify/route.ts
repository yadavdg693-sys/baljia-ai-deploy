import { NextRequest, NextResponse } from 'next/server';
import { verifyAndUpdate } from '@/lib/services/verification.service';
import { requireAuth, isApiError } from '@/lib/api-utils';

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
