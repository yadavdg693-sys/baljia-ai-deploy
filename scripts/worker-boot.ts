// Durable task worker — polls the tasks table, claims with a lease, executes
// launchTask, heartbeats the lease, releases on completion/failure.
//
// Intended to run as a separate Render Background Worker service (see render.yaml).
// Run locally: npx tsx scripts/worker-boot.ts
//
// Design (per ARCHITECTURE_AUDIT A2/B1):
// - One SQL UPDATE atomically claims a todo task + sets lease. Losers get NULL back.
// - Lease TTL: 5 min. Heartbeat every 60s extends it.
// - On crash, lease expires naturally. Another worker picks it up next poll.
// - attempt_count incremented on each claim. Hard-cap stops infinite reclaim loops.
// - Graceful shutdown on SIGTERM: finish current task, don't claim new ones.
//
// Credit/slot semantics: launchTask() still calls creditService.claimSlotAndCharge
// internally, which uses idempotency_key on credit_ledger — safe against double
// charge on reclaim. Previous (crashed) attempt's credit debit stands; reclaim
// does NOT re-charge because the idempotency key matches.

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { hostname } from 'os';
import { randomBytes } from 'crypto';
import { db, tasks } from '@/lib/db';
import { and, eq, lt, or, isNull, sql } from 'drizzle-orm';
import { launchTask } from '@/lib/agents/worker-launcher';
import { createLogger } from '@/lib/logger';

const log = createLogger('Worker');

// ── Configuration ──────────────────────────────
const POLL_INTERVAL_MS = 5_000;           // 5s between polls when idle
const LEASE_TTL_MS = 5 * 60 * 1000;        // 5 min lease (covers most tasks; heartbeat extends)
const HEARTBEAT_INTERVAL_MS = 60_000;      // heartbeat every 60s → lease extended by LEASE_TTL
const MAX_ATTEMPTS = 5;                    // hard cap on reclaim attempts per task
const WORKER_ID = `${hostname()}-${process.pid}-${randomBytes(4).toString('hex')}`;

let shuttingDown = false;
process.on('SIGTERM', () => {
  log.info('SIGTERM received — graceful shutdown after current task', { workerId: WORKER_ID });
  shuttingDown = true;
});
process.on('SIGINT', () => {
  log.info('SIGINT received — graceful shutdown after current task', { workerId: WORKER_ID });
  shuttingDown = true;
});

// ── Claim loop ─────────────────────────────────

/**
 * Atomic claim: picks one todo task (or an expired-lease reclaim), locks it
 * to this worker, sets lease_expires_at, increments attempt_count. Returns
 * the claimed task row or null.
 *
 * Query strategy: single UPDATE ... WHERE id = (SELECT id FROM ... FOR UPDATE
 * SKIP LOCKED LIMIT 1) RETURNING *. This is the standard "queue-as-a-table"
 * pattern — safe under concurrent workers because the FOR UPDATE SKIP LOCKED
 * subselect ensures each row is claimed by exactly one worker.
 */
async function claimOne(): Promise<typeof tasks.$inferSelect | null> {
  // Drizzle doesn't expose FOR UPDATE SKIP LOCKED cleanly; use raw SQL
  // for the inner pick. This is intentional — queue semantics trump ORM
  // abstraction here.
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_TTL_MS);

  const rows = await db.execute(sql`
    UPDATE tasks SET
      lease_holder = ${WORKER_ID},
      lease_expires_at = ${leaseUntil},
      attempt_count = COALESCE(attempt_count, 0) + 1,
      updated_at = NOW()
    WHERE id = (
      SELECT id FROM tasks
      WHERE status = 'todo'
        AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
        AND COALESCE(attempt_count, 0) < ${MAX_ATTEMPTS}
      ORDER BY priority DESC NULLS LAST, queue_order ASC NULLS LAST, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);

  // Drizzle's execute result shape varies by driver. Normalize:
  const rowArray = (rows as unknown as { rows?: unknown[] }).rows
    ?? (rows as unknown as unknown[])
    ?? [];
  return rowArray.length > 0
    ? (rowArray[0] as typeof tasks.$inferSelect)
    : null;
}

/**
 * Heartbeat — extend the lease if the worker is still owner.
 * Returns false if another worker has stolen the lease (expired and reclaimed).
 */
async function heartbeat(taskId: string): Promise<boolean> {
  const newExpiry = new Date(Date.now() + LEASE_TTL_MS);
  const result = await db.execute(sql`
    UPDATE tasks SET
      lease_expires_at = ${newExpiry},
      updated_at = NOW()
    WHERE id = ${taskId}
      AND lease_holder = ${WORKER_ID}
    RETURNING id
  `);
  const rowArray = (result as unknown as { rows?: unknown[] }).rows
    ?? (result as unknown as unknown[])
    ?? [];
  return rowArray.length > 0;
}

/**
 * Release lease (on completion or failure). Status transition is handled
 * by launchTask/verification.
 */
async function releaseLease(taskId: string): Promise<void> {
  await db.update(tasks)
    .set({ lease_holder: null, lease_expires_at: null })
    .where(and(eq(tasks.id, taskId), eq(tasks.lease_holder, WORKER_ID)));
}

// ── Main loop ──────────────────────────────────

async function processOne(task: typeof tasks.$inferSelect): Promise<void> {
  const taskId = task.id;
  log.info('Claimed task', {
    workerId: WORKER_ID,
    taskId,
    title: task.title,
    attempt: task.attempt_count,
    priority: task.priority,
  });

  // Start heartbeat loop
  const heartbeatInterval = setInterval(async () => {
    const stillMine = await heartbeat(taskId).catch((err) => {
      log.warn('Heartbeat error', { taskId, error: err instanceof Error ? err.message : String(err) });
      return true; // assume still mine — let next heartbeat decide
    });
    if (!stillMine) {
      log.warn('Lost lease (another worker reclaimed)', { taskId, workerId: WORKER_ID });
      clearInterval(heartbeatInterval);
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const execution = await launchTask(taskId);
    log.info('Task completed', {
      taskId,
      executionId: execution.id,
      status: execution.status,
      turns: execution.turn_count,
      wallSec: execution.wall_clock_seconds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Task execution failed', { taskId, error: msg });
    // Don't re-throw — loop continues. Task status was set by launchTask's
    // own error handling; lease will be released below.
  } finally {
    clearInterval(heartbeatInterval);
    await releaseLease(taskId).catch((err) => {
      log.warn('Release lease failed', { taskId, error: err instanceof Error ? err.message : String(err) });
    });
  }
}

async function pollLoop(): Promise<void> {
  log.info('Worker boot', { workerId: WORKER_ID, pollMs: POLL_INTERVAL_MS, leaseTtlMs: LEASE_TTL_MS });

  while (!shuttingDown) {
    try {
      const task = await claimOne();
      if (task) {
        await processOne(task);
        // Immediately try another claim — don't sleep between tasks
        continue;
      }
    } catch (err) {
      log.error('Claim loop error', { error: err instanceof Error ? err.message : String(err) });
    }

    // Idle — sleep before next poll
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  log.info('Worker shutdown complete', { workerId: WORKER_ID });
  process.exit(0);
}

pollLoop().catch((err) => {
  log.error('Fatal worker error', { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
