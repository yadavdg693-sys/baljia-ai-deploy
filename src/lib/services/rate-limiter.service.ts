// Rate Limiter — migrated to Drizzle + Neon
// In-memory sliding window (per-instance). For production: use Redis.
import { db, tasks, creditLedger } from '@/lib/db';
import { eq, and, gte, sql } from 'drizzle-orm';

const windows = new Map<string, number[]>();

const LIMITS = {
  api_calls: { max: 100, windowMs: 60_000 },
  chat_messages: { max: 30, windowMs: 60_000 },
  task_creation: { max: 10, windowMs: 60_000 },
  worker_launch: { max: 5, windowMs: 60_000 },
  night_shift: { max: 1, windowMs: 3_600_000 },
} as const;

type LimitType = keyof typeof LIMITS;

export function checkRateLimit(
  key: string,
  limitType: LimitType
): { allowed: boolean; remaining: number; resetMs: number } {
  const limit = LIMITS[limitType];
  const now = Date.now();
  const windowKey = `${key}:${limitType}`;

  let timestamps = windows.get(windowKey) ?? [];
  timestamps = timestamps.filter((t) => now - t < limit.windowMs);

  if (timestamps.length >= limit.max) {
    const oldestInWindow = timestamps[0];
    const resetMs = limit.windowMs - (now - oldestInWindow);
    return { allowed: false, remaining: 0, resetMs };
  }

  timestamps.push(now);
  windows.set(windowKey, timestamps);
  return { allowed: true, remaining: limit.max - timestamps.length, resetMs: 0 };
}

export function getRateLimitHeaders(
  result: ReturnType<typeof checkRateLimit>,
  limitType: LimitType
): Record<string, string> {
  const limit = LIMITS[limitType];
  return {
    'X-RateLimit-Limit': limit.max.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetMs > 0
      ? new Date(Date.now() + result.resetMs).toISOString()
      : '',
  };
}

export function cleanupExpiredWindows(): void {
  const now = Date.now();
  const maxWindow = 3_600_000;
  for (const [key, timestamps] of windows.entries()) {
    const active = timestamps.filter((t) => now - t < maxWindow);
    if (active.length === 0) windows.delete(key);
    else windows.set(key, active);
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredWindows, 300_000);
}

export async function checkAbuse(companyId: string): Promise<{
  isAbusive: boolean;
  signals: string[];
}> {
  const signals: string[] = [];
  const oneHourAgo = new Date(Date.now() - 3_600_000);

  const [recentTasksRow] = await db.select({ count: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.company_id, companyId), gte(tasks.created_at, oneHourAgo)));

  if ((recentTasksRow?.count ?? 0) > 50) {
    signals.push(`High task creation rate: ${recentTasksRow?.count} tasks in last hour`);
  }

  const [recentDebitsRow] = await db.select({ count: sql<number>`count(*)` })
    .from(creditLedger)
    .where(and(
      eq(creditLedger.company_id, companyId),
      eq(creditLedger.entry_type, 'task_deduction'),
      gte(creditLedger.created_at, oneHourAgo)
    ));

  if ((recentDebitsRow?.count ?? 0) > 20) {
    signals.push(`High credit consumption: ${recentDebitsRow?.count} debits in last hour`);
  }

  return { isAbusive: signals.length >= 2, signals };
}
