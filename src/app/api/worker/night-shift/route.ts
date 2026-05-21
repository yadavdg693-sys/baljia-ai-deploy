import { NextRequest, NextResponse } from 'next/server';
import { runNightShift } from '@/lib/services/night-shift.service';
import { requireAuthAndCompany, isApiError } from '@/lib/api-utils';

// POST /api/worker/night-shift — run night shift for a company
export async function POST(request: NextRequest) {
  let body: { companyId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.companyId) {
    return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
  }

  const auth = await requireAuthAndCompany(body.companyId);
  if (isApiError(auth)) return auth;

  try {
    const cycle = await runNightShift(body.companyId);
    return NextResponse.json({
      ok: true,
      cycle: {
        id: cycle.id,
        executed_tasks: cycle.executed_tasks,
        planned_tasks: cycle.planned_tasks,
        summary: cycle.summary,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Night shift failed' },
      { status: 500 }
    );
  }
}
