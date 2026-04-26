// Cron: queue tick — CF replacement for Render's scripts/worker-boot.ts poller.
// Render runs a long-lived background worker that polls every 5s; CF Workers
// can't host that (no persistent processes). This 1-min cron asks each company
// with authorized todo work to drain one queue slot.
//
// processQueue() calls launchTask(), which atomically claims the slot via
// claimSlotAndCharge / claimSlotOnly (single CTE, WHERE status='todo' + slot
// busy guard). Concurrent ticks are safe — losers see status!=todo or
// slot_occupied and bail.
//
// Auth: x-cron-secret header (matches night-shift, lease-reclaim, etc.).
// Triggered by `* * * * *` in wrangler.toml; CF Worker scheduled() handler
// dispatches via internal fetch to this route.
//
// Render path is unaffected: scripts/worker-boot.ts continues to poll directly.

import { NextRequest, NextResponse } from 'next/server';
import { db, companies, tasks } from '@/lib/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { processQueue } from '@/lib/agents/worker-launcher';
import { createLogger } from '@/lib/logger';
import type { Lifecycle } from '@/types';

const log = createLogger('CronQueueTick');

// Cap per-tick fanout. With a 1-min cron this is plenty; large fleets just
// wait one extra cycle. Keeps a single tick from blowing past CF's 30s wall
// clock if a batch of tasks all need to launch.
const MAX_COMPANIES_PER_TICK = 50;

// Lifecycles that may receive new task launches (matches worker-launcher
// ACTIVE_LIFECYCLES + night-shift cron gating). suspended/dormant/etc skipped.
const ACTIVE_LIFECYCLES: Lifecycle[] = ['trial_active', 'full_active'];

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

  // Find companies with at least one authorized todo task. authorized_by IS
  // NOT NULL covers founder-approved, system (Day-0 starters), night_shift,
  // recurring, and remediation. Pending CEO-proposed tasks awaiting Approve
  // stay parked.
  let candidates: { id: string }[];
  try {
    candidates = await db
      .selectDistinct({ id: companies.id })
      .from(companies)
      .innerJoin(tasks, eq(tasks.company_id, companies.id))
      .where(and(
        inArray(companies.lifecycle, ACTIVE_LIFECYCLES),
        eq(companies.execution_state, 'active'),
        eq(tasks.status, 'todo'),
        isNotNull(tasks.authorized_by),
      ))
      .limit(MAX_COMPANIES_PER_TICK);
  } catch (err) {
    log.error('Failed to fetch companies with authorized work', {}, err);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (candidates.length === 0) {
    return NextResponse.json({ companies_ticked: 0, errors: 0 });
  }

  log.info('Queue tick starting', { companies: candidates.length });

  // Promise.allSettled so one company's failure doesn't kill the batch.
  // processQueue itself swallows per-task errors; this guards against
  // unexpected throws (DB blip, etc.).
  const results = await Promise.allSettled(
    candidates.map((c) => processQueue(c.id)),
  );

  let launched = 0;
  let errors = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      launched += r.value;
    } else {
      errors++;
      log.error('processQueue threw', {
        companyId: candidates[i].id,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  log.info('Queue tick complete', {
    companies_ticked: candidates.length,
    tasks_launched: launched,
    errors,
  });

  return NextResponse.json({
    companies_ticked: candidates.length,
    tasks_launched: launched,
    errors,
  });
}
