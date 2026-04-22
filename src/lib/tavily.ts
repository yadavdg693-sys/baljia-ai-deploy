// Tavily API client with round-robin key rotation
// Keys are loaded from TAVILY_API_KEYS (comma-separated) with TAVILY_API_KEY as fallback.
// Each request picks the next key in the pool, distributing load across all keys.

import { createLogger } from '@/lib/logger';

const log = createLogger('Tavily');

let keys: string[] = [];
let keyIndex = 0;

function getKeys(): string[] {
  if (keys.length > 0) return keys;

  // Primary: comma-separated pool
  const pool = process.env.TAVILY_API_KEYS;
  if (pool) {
    keys = pool.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }

  // Fallback: single key
  if (keys.length === 0) {
    const single = process.env.TAVILY_API_KEY;
    if (single && single !== 'placeholder') {
      keys = [single];
    }
  }

  if (keys.length > 0) {
    log.info(`Tavily key pool initialized: ${keys.length} key(s)`);
  }
  return keys;
}

/** Get the next API key via round-robin. Returns null if no keys configured. */
export function getNextTavilyKey(): string | null {
  const pool = getKeys();
  if (pool.length === 0) return null;
  const key = pool[keyIndex % pool.length];
  keyIndex++;
  return key;
}

/** Check if Tavily is available (at least one key configured). */
export function isTavilyAvailable(): boolean {
  return getKeys().length > 0;
}

export interface TavilySearchOptions {
  query: string;
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeAnswer?: boolean;
  includeRawContent?: boolean;
  timeoutMs?: number;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
}

/**
 * Search via Tavily with automatic key rotation.
 * On 401/429 from one key, retries once with the next key.
 */
export async function tavilySearch(opts: TavilySearchOptions): Promise<TavilyResponse> {
  const {
    query,
    maxResults = 5,
    searchDepth = 'advanced',
    includeAnswer = true,
    includeRawContent = false,
    timeoutMs = 15000,
  } = opts;

  const pool = getKeys();
  if (pool.length === 0) {
    throw new Error('No Tavily API keys configured (set TAVILY_API_KEYS or TAVILY_API_KEY)');
  }

  // Try up to 2 keys on auth/rate errors
  const maxAttempts = Math.min(2, pool.length);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = getNextTavilyKey()!;
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          query,
          max_results: maxResults,
          search_depth: searchDepth,
          include_answer: includeAnswer,
          include_raw_content: includeRawContent,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 401 || res.status === 429) {
        log.warn(`Tavily key ${key.slice(0, 12)}... got ${res.status}, rotating`, { attempt });
        continue;
      }

      if (!res.ok) {
        throw new Error(`Tavily HTTP ${res.status}`);
      }

      const data = await res.json();
      return {
        answer: data.answer ?? undefined,
        results: (data.results ?? []) as TavilyResult[],
      };
    } catch (err) {
      if (attempt < maxAttempts - 1 && err instanceof Error && /401|429/.test(err.message)) {
        continue;
      }
      throw err;
    }
  }

  throw new Error('All Tavily keys exhausted (401/429)');
}

/**
 * Convenience: search and return a formatted text summary.
 * Used by onboarding and CEO tool handlers.
 */
export async function tavilySearchText(
  query: string,
  maxResults = 5,
  searchDepth: 'basic' | 'advanced' = 'advanced',
): Promise<string | null> {
  try {
    const data = await tavilySearch({ query, maxResults, searchDepth });

    const parts: string[] = [];
    if (data.answer) parts.push(data.answer);
    if (data.results?.length) {
      parts.push(
        data.results
          .slice(0, 5)
          .map(r => `${r.title}: ${r.content}${r.url ? ` (${r.url})` : ''}`)
          .join('\n')
      );
    }
    return parts.join('\n\n').slice(0, 2500) || null;
  } catch (err) {
    log.warn('Tavily search error', {
      query: query.slice(0, 80),
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}
