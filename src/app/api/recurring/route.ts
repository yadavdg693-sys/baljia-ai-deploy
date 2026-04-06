import { NextRequest, NextResponse } from 'next/server';
import * as recurringService from '@/lib/services/recurring.service';
import { requireAuth, requireAuthAndCompany, isApiError } from '@/lib/api-utils';
import { createRecurringTaskSchema } from '@/lib/validations';

// GET /api/recurring?companyId=xyz — list recurring tasks + budget
export async function GET(request: NextRequest) {
  const companyId = request.nextUrl.searchParams.get('companyId');
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  const [tasks, budget] = await Promise.all([
    recurringService.getRecurringTasks(companyId),
    recurringService.getMonthlyBudgetEstimate(companyId),
  ]);

  return NextResponse.json({ tasks, budget });
}

// POST /api/recurring — create recurring task
export async function POST(request: NextRequest) {
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const companyId = rawBody.companyId as string;
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  // Validate cadence and other fields via Zod schema
  const parsed = createRecurringTaskSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body = { ...parsed.data, companyId };

  const auth = await requireAuthAndCompany(body.companyId);
  if (isApiError(auth)) return auth;

  try {
    const task = await recurringService.createRecurring({
      company_id: body.companyId,
      title: body.title,
      description: body.description,
      tag: body.tag,
      cadence: body.cadence,
    });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create recurring task' },
      { status: 500 }
    );
  }
}

// DELETE /api/recurring?id=xyz&companyId=abc — delete recurring task
// FIX: C-SEC-006 — now requires company ownership verification
export async function DELETE(request: NextRequest) {
  const recurringId = request.nextUrl.searchParams.get('id');
  const companyId = request.nextUrl.searchParams.get('companyId');

  if (!recurringId) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });

  const auth = await requireAuthAndCompany(companyId);
  if (isApiError(auth)) return auth;

  try {
    await recurringService.deleteRecurring(recurringId, companyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete' },
      { status: 500 }
    );
  }
}
