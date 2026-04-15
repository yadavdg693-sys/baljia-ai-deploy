// Redis Rate Limiter — persistent rate limiting via Redis Cloud (ioredis)
// Replaces in-memory rate limiter for multi-server / serverless deployments
// FIX: G-SEC-003 — rate limits now survive restarts and work across replicas
//
// Falls back to in-memory if REDIS_URL is not configured.

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getRedis as getRedisClient } from '@/lib/redis';

const log = createLogger('RateLimit');

// ══════════════════════════════════════════════
// REDIS CLIENT (lazy init via shared singleton)
// ══════════════════════════════════════════════

function getRedis() {
  return getRedisClient();
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

// Lua script for atomic INCR + EXPIRE — eliminates the race condition where
// a crash between INCR and SET leaves a key with no TTL (permanent lockout).
const LUA_RATE_LIMIT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`;

async function checkRedisLimit(
  redis: ReturnType<typeof getRedis> & object,
  key: string,
  maxRequests: number,
  windowSec: number
): Promise<NextResponse | null> {
  try {
    const count = await (redis as unknown as { eval: (script: string, numKeys: number, ...args: (string | number)[]) => Promise<number> })
      .eval(LUA_RATE_LIMIT, 1, key, windowSec);

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

/**
 * Check a custom rate limit key (e.g. for email limits).
 */
export async function checkCustomRateLimitAsync(
  customKey: string,
  options?: Omit<RateLimitOptions, 'keyPrefix'>
): Promise<NextResponse | null> {
  const maxRequests = options?.maxRequests ?? 10;
  const windowMs = options?.windowMs ?? 60000;
  const windowSec = Math.ceil(windowMs / 1000);
  const key = `rl:custom:${customKey}`;

  const redis = await getRedis();
  if (redis) {
    return checkRedisLimit(redis, key, maxRequests, windowSec);
  }

  return checkMemoryLimit(key, maxRequests, windowMs);
}

// ══════════════════════════════════════════════
// ESCALATION LADDER (SPEC-CEO-001)
// 6-step escalation: observe → soft-limit → degrade → cooldown → flag → suspend
// Tracked per company in Redis. De-escalates after cooldown window passes.
// ══════════════════════════════════════════════

export type EscalationLevel = 'observe' | 'soft_limit' | 'degrade' | 'cooldown' | 'flag' | 'suspend';

const ESCALATION_ORDER: EscalationLevel[] = ['observe', 'soft_limit', 'degrade', 'cooldown', 'flag', 'suspend'];

interface EscalationState {
  level: EscalationLevel;
  violation_count: number;
  last_violation_at: number;
  level_changed_at: number;
}

// Thresholds: violations needed to escalate, within a time window (ms)
const ESCALATION_THRESHOLDS: Record<EscalationLevel, { violations: number; windowMs: number }> = {
  observe:    { violations: 3,  windowMs: 5 * 60_000 },     // 3 in 5 min → soft_limit
  soft_limit: { violations: 5,  windowMs: 10 * 60_000 },    // 5 in 10 min → degrade
  degrade:    { violations: 10, windowMs: 15 * 60_000 },     // 10 in 15 min → cooldown
  cooldown:   { violations: 3,  windowMs: 60 * 60_000 },     // 3 cooldown triggers in 1 hr → flag
  flag:       { violations: 5,  windowMs: 24 * 60 * 60_000 }, // 5 flags in 24 hr → suspend
  suspend:    { violations: Infinity, windowMs: 0 },          // terminal — manual unblock
};

// De-escalation: how long without violations before stepping down one level
const DE_ESCALATION_MS: Record<EscalationLevel, number> = {
  observe:    0,                    // baseline — no de-escalation needed
  soft_limit: 10 * 60_000,         // 10 min clean → observe
  degrade:    15 * 60_000,         // 15 min clean → soft_limit
  cooldown:   30 * 60_000,         // 30 min clean → degrade
  flag:       60 * 60_000,         // 1 hr clean → cooldown
  suspend:    Infinity,            // manual only
};

// In-memory fallback for escalation state
const memoryEscalation = new Map<string, EscalationState>();

function defaultEscalationState(): EscalationState {
  return { level: 'observe', violation_count: 0, last_violation_at: 0, level_changed_at: Date.now() };
}

/** Get current escalation state for a company */
async function getEscalationState(companyId: string): Promise<EscalationState> {
  const key = `rl:escalation:${companyId}`;
  const redis = await getRedis();

  if (redis) {
    try {
      const data = await redis.get(key);
      if (data) {
        return typeof data === 'string' ? JSON.parse(data) as EscalationState : data as EscalationState;
      }
    } catch { /* fall through to memory */ }
  }

  return memoryEscalation.get(companyId) ?? defaultEscalationState();
}

/** Persist escalation state */
async function setEscalationState(companyId: string, state: EscalationState): Promise<void> {
  const key = `rl:escalation:${companyId}`;
  const redis = await getRedis();

  if (redis) {
    try {
      // TTL of 24 hours — escalation state doesn't need to persist forever
      await redis.set(key, JSON.stringify(state), 'EX', 86400);
      return;
    } catch { /* fall through to memory */ }
  }

  memoryEscalation.set(companyId, state);
}

/** Check for de-escalation (time-based decay) */
function checkDeEscalation(state: EscalationState): EscalationState {
  const now = Date.now();
  const currentIdx = ESCALATION_ORDER.indexOf(state.level);
  if (currentIdx <= 0) return state; // already at observe

  const timeSinceViolation = now - state.last_violation_at;
  const deEscMs = DE_ESCALATION_MS[state.level];

  if (timeSinceViolation >= deEscMs && deEscMs < Infinity) {
    const newLevel = ESCALATION_ORDER[currentIdx - 1];
    log.info('Rate limit de-escalation', { level: state.level, newLevel, timeSinceViolation });
    return { level: newLevel, violation_count: 0, last_violation_at: state.last_violation_at, level_changed_at: now };
  }

  return state;
}

/** Record a violation and potentially escalate */
function recordViolation(state: EscalationState): EscalationState {
  const now = Date.now();
  const threshold = ESCALATION_THRESHOLDS[state.level];
  const currentIdx = ESCALATION_ORDER.indexOf(state.level);

  // Reset violation counter if outside the window
  const inWindow = (now - state.level_changed_at) <= threshold.windowMs;
  const newCount = inWindow ? state.violation_count + 1 : 1;

  // Check if we should escalate
  if (newCount >= threshold.violations && currentIdx < ESCALATION_ORDER.length - 1) {
    const newLevel = ESCALATION_ORDER[currentIdx + 1];
    log.warn('Rate limit escalation', { level: state.level, newLevel, violations: newCount });
    return { level: newLevel, violation_count: 0, last_violation_at: now, level_changed_at: now };
  }

  return { ...state, violation_count: newCount, last_violation_at: now };
}

/**
 * Rate limit check with 6-step escalation ladder.
 * Call this for company-scoped endpoints (chat, task creation, etc.)
 * Returns null if allowed, or a NextResponse (429/warning) if limited.
 */
export async function checkRateLimitWithEscalation(
  companyId: string,
  options?: Omit<RateLimitOptions, 'keyPrefix'> & { endpoint?: string },
): Promise<NextResponse | null> {
  const maxRequests = options?.maxRequests ?? 30;
  const windowMs = options?.windowMs ?? 60000;

  // 1. Check base rate limit (count-based)
  const baseResult = await checkCompanyRateLimitAsync(companyId, { maxRequests, windowMs });

  // 2. Get escalation state (with de-escalation check)
  let state = await getEscalationState(companyId);
  state = checkDeEscalation(state);

  // 3. If base limit exceeded, record violation and escalate
  if (baseResult !== null) {
    state = recordViolation(state);
    await setEscalationState(companyId, state);
  }

  // 4. Apply escalation-level behavior
  switch (state.level) {
    case 'observe':
      // No action — just return base result
      return baseResult;

    case 'soft_limit': {
      // Add warning header but allow the request
      if (baseResult) return baseResult;
      // No 429, but warn via header
      return null; // Caller should check getEscalationLevel() to add headers
    }

    case 'degrade': {
      // Block non-essential endpoints only
      const essential = !options?.endpoint || ['chat', 'tasks'].includes(options.endpoint);
      if (!essential) {
        return make429Response(maxRequests, 60);
      }
      return baseResult;
    }

    case 'cooldown':
      // Full 429 for all endpoints
      return baseResult ?? make429Response(maxRequests, 120);

    case 'flag':
      // Full 429 + logged for manual review
      log.error('Rate limit FLAGGED for manual review', { companyId, violations: state.violation_count });
      return make429Response(maxRequests, 300);

    case 'suspend':
      // Persistent block
      return make429Response(maxRequests, 3600);
  }
}

/** Get the current escalation level for a company (for header injection) */
export async function getEscalationLevel(companyId: string): Promise<EscalationLevel> {
  const state = await getEscalationState(companyId);
  return checkDeEscalation(state).level;
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
