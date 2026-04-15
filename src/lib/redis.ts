// Unified Redis client — uses ioredis (TCP) with Redis Cloud
// Replaces @upstash/redis REST client throughout the codebase.
// Lazy-initialized singleton. Falls back gracefully if not configured.

import Redis from 'ioredis';
import { createLogger } from '@/lib/logger';

const log = createLogger('Redis');

let client: Redis | null = null;
let initAttempted = false;

/**
 * Get the Redis client singleton.
 * Returns null if REDIS_URL is not configured or connection fails.
 */
export function getRedis(): Redis | null {
  if (client) return client;
  if (initAttempted) return null;
  initAttempted = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    log.info('REDIS_URL not configured, Redis features disabled');
    return null;
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: false,
    });

    client.on('error', (err) => {
      log.warn('Redis connection error', { error: err.message });
    });

    client.on('connect', () => {
      log.info('Redis connected');
    });

    return client;
  } catch (error) {
    log.warn('Failed to initialize Redis client');
    return null;
  }
}

/**
 * Check if Redis is available and responsive.
 */
export async function pingRedis(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
