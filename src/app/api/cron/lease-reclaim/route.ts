// Lease reclaim cron — every 5 min, find tasks whose lease has expired (worker
// died / was killed before releasing) and unlock them so another worker can
// reclaim. Worker's own claim query already reclaims expired leases, so this
// is defensive: it surfaces stuck-forever cases and logs them.
//
// Also caps attempts: any task with attempt_count >= MAX_ATTEMPTS and an
// expired lease gets marked failed so it stops cycling.

import { NextRequest, NextResponse } from 'next/server';
import { db, tasks } from '@/lib/db';
import { sql, and, eq, lt, isNotNull, gte } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('LeaseReclaim');
const MAX_ATTEMPTS = 5;

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 });
  }
  const provided = request.headers.get('x-cron-secret') ?? '';
  if (provided !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  // 1. Tasks with expired leases that are still in_progress — reset to todo
  //    so the worker claim query picks them up. Lease columns cleared.
  const expired = await db
    .update(tasks)
    .set({
      status: 'todo',
      lease_holder: null,
      lease_expires_at: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(tasks.status, 'in_progress'),
        isNotNull(tasks.lease_expires_at),
        lt(tasks.lease_expires_at, now),
        // don't reset already-exhausted attempts — those go to failed below
        lt(tasks.attempt_count, MAX_ATTEMPTS),
      ),
    )
    .returning({ id: tasks.id, title: tasks.title, attempt_count: tasks.attempt_count });

  for (const row of expired) {
    log.warn('Reclaimed expired-lease task', {
      taskId: row.id,
      title: row.title,
      attemptCount: row.attempt_count,
    });
  }

  // 2. Tasks that hit the attempt cap — mark permanently failed
  const exhausted = await db
    .update(tasks)
    .set({
      status: 'failed_permanent',
      failure_class: 'scope_overflow',
      lease_holder: null,
      lease_expires_at: null,
      completed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(tasks.status, 'in_progress'),
        isNotNull(tasks.lease_expires_at),
        lt(tasks.lease_expires_at, now),
        gte(tasks.attempt_count, MAX_ATTEMPTS),
      ),
    )
    .returning({ id: tasks.id, title: tasks.title });

  for (const row of exhausted) {
    log.error('Task marked failed_permanent: attempt cap reached', {
      taskId: row.id,
      title: row.title,
    });
  }

  return NextResponse.json({
    reclaimed: expired.length,
    exhausted: exhausted.length,
    timestamp: now.toISOString(),
  });
}

// Unused, kept to satisfy linter about imports
void sql;
