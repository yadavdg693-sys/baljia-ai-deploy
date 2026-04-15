// Infra Watchdog — platform-level health monitoring (SPEC-OPS-001)
// Not per-task (that's src/lib/agents/watchdog.ts) — this monitors the platform itself.
// Runs as a cron job every 15 minutes via platform-ops route.

import { db, tasks as tasksTable, agents } from '@/lib/db';
import { eq, and, lt, sql, count } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('InfraWatchdog');

export interface InfraHealthAlert {
  severity: 'warning' | 'critical';
  check: string;
  message: string;
  value: number;
}

export interface InfraHealthReport {
  queue_depth: number;
  stuck_count: number;
  error_rate_spike: boolean;
  error_rate_ratio: number;
  agents_down: string[];
  redis_ok: boolean;
  alerts: InfraHealthAlert[];
  checked_at: string;
}

export async function runInfraHealthCheck(): Promise<InfraHealthReport> {
  const alerts: InfraHealthAlert[] = [];
  const now = new Date();

  // 1. Queue depth: 'todo' tasks created more than 1 hour ago (stuck in queue)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [queueResult] = await db.select({ cnt: count() })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.status, 'todo'),
      lt(tasksTable.created_at, oneHourAgo),
    ));
  const queue_depth = queueResult?.cnt ?? 0;

  if (queue_depth > 10) {
    alerts.push({ severity: 'critical', check: 'queue_depth', message: `${queue_depth} tasks stuck in queue > 1 hour`, value: queue_depth });
  } else if (queue_depth > 3) {
    alerts.push({ severity: 'warning', check: 'queue_depth', message: `${queue_depth} tasks stuck in queue > 1 hour`, value: queue_depth });
  }

  // 2. Stuck executions: tasks 'in_progress' for more than 30 minutes
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const [stuckResult] = await db.select({ cnt: count() })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.status, 'in_progress'),
      lt(tasksTable.updated_at, thirtyMinAgo),
    ));
  const stuck_count = stuckResult?.cnt ?? 0;

  if (stuck_count > 0) {
    alerts.push({ severity: stuck_count > 3 ? 'critical' : 'warning', check: 'stuck_executions', message: `${stuck_count} tasks stuck in_progress > 30 min`, value: stuck_count });
  }

  // 3. Error rate spike: failures in last hour vs last 24h average
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [failedLastHour] = await db.select({ cnt: count() })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.status, 'failed'),
      sql`${tasksTable.updated_at} >= ${oneHourAgo}`,
    ));
  const [failedLast24h] = await db.select({ cnt: count() })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.status, 'failed'),
      sql`${tasksTable.updated_at} >= ${twentyFourHoursAgo}`,
    ));

  const hourlyFailures = failedLastHour?.cnt ?? 0;
  const dailyAvgPerHour = ((failedLast24h?.cnt ?? 0) / 24);
  const error_rate_ratio = dailyAvgPerHour > 0 ? hourlyFailures / dailyAvgPerHour : 0;
  const error_rate_spike = error_rate_ratio > 3;

  if (error_rate_spike) {
    alerts.push({ severity: 'critical', check: 'error_rate', message: `Error rate ${error_rate_ratio.toFixed(1)}x above 24h average`, value: error_rate_ratio });
  }

  // 4. Agent availability: check all 8 worker agents are active in DB
  const activeAgents = await db.select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.is_active, false));

  const agents_down = activeAgents.map(a => a.name ?? `agent-${a.id}`);

  if (agents_down.length > 0) {
    alerts.push({ severity: 'warning', check: 'agent_availability', message: `${agents_down.length} agent(s) inactive: ${agents_down.join(', ')}`, value: agents_down.length });
  }

  // 5. Redis connectivity
  let redis_ok = false;
  try {
    const { pingRedis } = await import('@/lib/redis');
    const redis = (await import('@/lib/redis')).getRedis();
    if (redis) {
      redis_ok = await pingRedis();
      if (!redis_ok) {
        alerts.push({ severity: 'warning', check: 'redis_connectivity', message: 'Redis ping failed', value: 0 });
      }
    } else {
      redis_ok = true; // No Redis configured — not a failure
    }
  } catch {
    alerts.push({ severity: 'warning', check: 'redis_connectivity', message: 'Redis ping failed', value: 0 });
  }

  const report: InfraHealthReport = {
    queue_depth,
    stuck_count,
    error_rate_spike,
    error_rate_ratio,
    agents_down,
    redis_ok,
    alerts,
    checked_at: now.toISOString(),
  };

  if (alerts.length > 0) {
    log.warn('Infra health alerts', { alertCount: alerts.length, alerts: alerts.map(a => a.message) });
  } else {
    log.info('Infra health check passed');
  }

  return report;
}
