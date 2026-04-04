// Redis Rate Limiter — persistent rate limiting via Upstash Redis
// Replaces in-memory rate limiter for multi-server / serverless deployments
// FIX: G-SEC-003 — rate limits now survive restarts and work across replicas
//
// Falls back to in-memory if UPSTASH_REDIS_REST_URL is not configured.

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('RateLimit');

// ══════════════════════════════════════════════
// REDIS CLIENT (lazy init)
// ══════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;

let redisInitAttempted = false;

async function getRedis() {
  if (redisClient) return redisClient;
  if (redisInitAttempted) return null;

  redisInitAttempted = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    log.info('Upstash Redis not configured, using in-memory rate limiter');
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({ url, token });
    log.info('Redis rate limiter initialized');
    return redisClient;
  } catch (error) {
    log.warn('Failed to init Redis, using in-memory fallback');
    return null;
  }
}

// ══════════════════════════════════════════════
// IN-MEMORY FALLBACK (same as before)
// ══════════════════════════════════════════════

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function memoryCleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt < now) memoryStore.delete(key);
  }
}

function checkMemoryLimit(key: string, maxRequests: number, windowMs: number): NextResponse | null {
  memoryCleanup();
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.resetAt < now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return make429Response(maxRequests, Math.ceil((entry.resetAt - now) / 1000));
  }
  return null;
}

// ══════════════════════════════════════════════
// REDIS-BACKED LIMIT CHECK
// ══════════════════════════════════════════════

async function checkRedisLimit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redis: any,
  key: string,
  maxRequests: number,
  windowSec: number
): Promise<NextResponse | null> {
  try {
    const count = await redis.incr(key);

    // First request in window — set expiry
    if (count === 1) {
      await redis.set(key, '1', { ex: windowSec });
    }

    if (count > maxRequests) {
      const ttl = await redis.ttl(key);
      return make429Response(maxRequests, ttl > 0 ? ttl : windowSec);
    }

    return null;
  } catch (error) {
    // Redis failure — fall back to memory
    log.warn('Redis rate limit check failed, using memory fallback');
    return checkMemoryLimit(key, maxRequests, windowSec * 1000);
  }
}

// ══════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════

interface RateLimitOptions {
  /** Max requests per window. Default: 60 */
  maxRequests?: number;
  /** Window size in ms. Default: 60000 (1 minute) */
  windowMs?: number;
  /** Key prefix for different rate limit buckets */
  keyPrefix?: string;
}

/**
 * Check rate limit for a request (by IP).
 * Uses Redis if available, falls back to in-memory.
 */
export function checkRateLimit(
  request: NextRequest,
  options?: RateLimitOptions
): NextResponse | null {
  const maxRequests = options?.maxRequests ?? 60;
  const windowMs = options?.windowMs ?? 60000;
  const prefix = options?.keyPrefix ?? 'global';

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';
  const key = `rl:${prefix}:${ip}`;

  // Try Redis (async) — but checkRateLimit is sync in API routes
  // For now, use memory. Redis is used by checkRateLimitAsync.
  return checkMemoryLimit(key, maxRequests, windowMs);
}

/**
 * Async rate limit check — uses Redis when available.
 * Preferred over checkRateLimit when you can await.
 */
export async function checkRateLimitAsync(
  request: NextRequest,
  options?: RateLimitOptions
): Promise<NextResponse | null> {
  const maxRequests = options?.maxRequests ?? 60;
  const windowMs = options?.windowMs ?? 60000;
  const windowSec = Math.ceil(windowMs / 1000);
  const prefix = options?.keyPrefix ?? 'global';

  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';
  const key = `rl:${prefix}:${ip}`;

  const redis = await getRedis();
  if (redis) {
    return checkRedisLimit(redis, key, maxRequests, windowSec);
  }

  return checkMemoryLimit(key, maxRequests, windowMs);
}

/**
 * Check rate limit by companyId (for task execution endpoints).
 */
export async function checkCompanyRateLimitAsync(
  companyId: string,
  options?: Omit<RateLimitOptions, 'keyPrefix'>
): Promise<NextResponse | null> {
  const maxRequests = options?.maxRequests ?? 30;
  const windowMs = options?.windowMs ?? 60000;
  const windowSec = Math.ceil(windowMs / 1000);
  const key = `rl:company:${companyId}`;

  const redis = await getRedis();
  if (redis) {
    return checkRedisLimit(redis, key, maxRequests, windowSec);
  }

  return checkMemoryLimit(key, maxRequests, windowMs);
}

/**
 * Sync company rate limit (in-memory only).
 * Kept for backward compatibility with existing sync API routes.
 */
export function checkCompanyRateLimit(
  companyId: string,
  options?: Omit<RateLimitOptions, 'keyPrefix'>
): NextResponse | null {
  const maxRequests = options?.maxRequests ?? 30;
  const windowMs = options?.windowMs ?? 60000;
  const key = `rl:company:${companyId}`;
  return checkMemoryLimit(key, maxRequests, windowMs);
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function make429Response(maxRequests: number, retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests', retryAfter: retryAfterSec },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': '0',
      },
    }
  );
}
