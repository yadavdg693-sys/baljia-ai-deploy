// Event Service — migrated to Drizzle + Neon
// Dual-write: Neon (persistence) + Upstash Redis (real-time pub/sub)

import { db, platformEvents } from '@/lib/db';
import { eq, gt, desc, and } from 'drizzle-orm';
import type { EventType, PlatformEvent } from '@/types';

const REDIS_CHANNEL = (companyId: string) => `events:${companyId}`;
const REDIS_PUBLIC_CHANNEL = 'events:public';

// Redis lazy singleton
let redisClient: import('@upstash/redis').Redis | null = null;

function getRedis(): import('@upstash/redis').Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const { Redis } = require('@upstash/redis');
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════
// EMIT
// ══════════════════════════════════════════════

export async function emit(
  companyId: string,
  eventType: EventType,
  payload: Record<string, unknown>,
  isPublic = false
): Promise<PlatformEvent> {
  const [event] = await db.insert(platformEvents).values({
    company_id: companyId,
    event_type: eventType,
    payload,
    is_public_safe: isPublic,
  }).returning();

  // Publish to Redis (non-blocking)
  const redis = getRedis();
  if (redis) {
    const message = JSON.stringify({
      id: event.id,
      event_type: eventType,
      payload,
      is_public_safe: isPublic,
      created_at: event.created_at,
    });

    const publishOps = [redis.publish(REDIS_CHANNEL(companyId), message)];
    if (isPublic) publishOps.push(redis.publish(REDIS_PUBLIC_CHANNEL, message));
    Promise.all(publishOps).catch(() => {});
  }

  return {
    id: event.id,
    company_id: event.company_id ?? '',
    event_type: event.event_type as EventType,
    payload: (event.payload ?? {}) as Record<string, unknown>,
    is_public_safe: event.is_public_safe ?? false,
    created_at: event.created_at instanceof Date ? event.created_at.toISOString() : String(event.created_at),
  };
}

// ══════════════════════════════════════════════
// SUBSCRIBE (placeholder — SSE uses DB polling)
// ══════════════════════════════════════════════

export async function subscribeToEvents(
  companyId: string,
  onMessage: (event: { event_type: string; payload: Record<string, unknown>; created_at: string }) => void
): Promise<(() => void) | null> {
  return null; // SSE routes use DB polling as fallback
}

// ══════════════════════════════════════════════
// QUERY
// ══════════════════════════════════════════════

export async function getCompanyEvents(companyId: string, limit = 50): Promise<PlatformEvent[]> {
  const rows = await db.select().from(platformEvents)
    .where(eq(platformEvents.company_id, companyId))
    .orderBy(desc(platformEvents.created_at))
    .limit(limit);
  return rows.map(mapEvent);
}

export async function getPublicEvents(limit = 100): Promise<PlatformEvent[]> {
  const rows = await db.select().from(platformEvents)
    .where(eq(platformEvents.is_public_safe, true))
    .orderBy(desc(platformEvents.created_at))
    .limit(limit);
  return rows.map(mapEvent);
}

// B4 FIX: Type-safe mapping from Drizzle row to PlatformEvent
function mapEvent(row: typeof platformEvents.$inferSelect): PlatformEvent {
  return {
    id: row.id,
    company_id: row.company_id ?? '',
    event_type: row.event_type as EventType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    is_public_safe: row.is_public_safe ?? false,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function getEventsSince(
  companyId: string,
  since: string,
  limit = 20
): Promise<PlatformEvent[]> {
  const rows = await db.select().from(platformEvents)
    .where(and(
      eq(platformEvents.company_id, companyId),
      gt(platformEvents.created_at, new Date(since))
    ))
    .orderBy(platformEvents.created_at)
    .limit(limit);
  return rows.map(mapEvent);
}
