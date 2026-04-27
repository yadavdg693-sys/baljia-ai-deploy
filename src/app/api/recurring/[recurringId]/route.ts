import { NextRequest, NextResponse } from 'next/server';
import { db, recurringTasks } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { requireAuth, requireCompanyOwnership, parseJsonBody, isApiError } from '@/lib/api-utils';
import { updateRecurringTaskSchema } from '@/lib/validations';
import { isValidUUID } from '@/lib/uuid-validation';

const MONTHLY_ESTIMATE = { daily: 30, weekly: 4, biweekly: 2, monthly: 1 } as const;

async function getRecurringWithAuth(recurringId: string) {
  if (!isValidUUID(recurringId)) {
    return { error: NextResponse.json({ error: 'Invalid recurringId format' }, { status: 400 }) } as const;
  }
  const auth = await requireAuth();
  if (isApiError(auth)) return { error: auth } as const;

  const [row] = await db.select().from(recurringTasks).where(eq(recurringTasks.id, recurringId)).limit(1);
  if (!row) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const;

  const ownership = await requireCompanyOwnership(row.company_id, auth.user.id);
  if (isApiError(ownership)) return { error: ownership } as const;

  return { row, userId: auth.user.id } as const;
}

// PATCH /api/recurring/:id — update title / description / tag / cadence / pause+resume
// Cadence changes also recompute monthly_credits_estimate so the founder sees an
// accurate spend forecast immediately.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recurringId: string }> }
) {
  const { recurringId } = await params;
  const result = await getRecurringWithAuth(recurringId);
  if ('error' in result) return result.error;

  const body = await parseJsonBody(request);
  if (isApiError(body)) return body;

  const parsed = updateRecurringTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.tag !== undefined) updates.tag = parsed.data.tag;
  if (parsed.data.cadence !== undefined) {
    updates.cadence = parsed.data.cadence;
    updates.monthly_credits_estimate = MONTHLY_ESTIMATE[parsed.data.cadence];
  }
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  const [updated] = await db.update(recurringTasks)
    .set(updates as Record<string, unknown>)
    .where(eq(recurringTasks.id, recurringId))
    .returning();

  return NextResponse.json(updated);
}

// DELETE /api/recurring/:id — same as the bulk endpoint but matches REST shape.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ recurringId: string }> }
) {
  const { recurringId } = await params;
  const result = await getRecurringWithAuth(recurringId);
  if ('error' in result) return result.error;

  await db.delete(recurringTasks).where(and(
    eq(recurringTasks.id, recurringId),
    eq(recurringTasks.company_id, result.row.company_id),
  ));
  return NextResponse.json({ ok: true });
}
