// Preflight environment + credential checks.
//
// Runs BEFORE the engineering agent starts a task. Catches the failure modes
// that historically wasted entire 200-turn runs:
//   - GitHub token missing / truncated / expired
//   - Render API key invalid
//   - Postmark token invalid
//   - Neon database unreachable
//   - Anthropic OAuth file missing or expired
//
// Each integration ping is short-circuited (no retries) and the whole sweep
// completes in well under a second when creds are healthy. Results are cached
// for 60s so rapid-fire task launches don't hammer the upstreams.

import { isAnthropicOAuthAvailable } from '@/lib/anthropic-oauth';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('Preflight');

export interface PreflightFailure {
  integration: string;
  reason: string;
}

export interface PreflightResult {
  ok: boolean;
  failures: PreflightFailure[];
  checkedAt: number;
}

const CACHE_TTL_MS = 60_000;
let cached: PreflightResult | null = null;
let cachedAt = 0;

const FETCH_TIMEOUT_MS = 5_000;

async function pingWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function checkGitHub(): Promise<PreflightFailure | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { integration: 'github', reason: 'GITHUB_TOKEN env var not set' };
  // Stale-token shape we observed this session: 92 vs 93 chars (truncation in .env)
  if (token.length < 40) return { integration: 'github', reason: `GITHUB_TOKEN looks truncated (length=${token.length}, expected 40+)` };
  try {
    const r = await pingWithTimeout('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'baljia-preflight' },
    });
    if (!r.ok) return { integration: 'github', reason: `GitHub /user returned HTTP ${r.status}` };
    return null;
  } catch (err) {
    return { integration: 'github', reason: `GitHub /user threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkRender(): Promise<PreflightFailure | null> {
  const token = process.env.RENDER_API_KEY;
  if (!token) return { integration: 'render', reason: 'RENDER_API_KEY env var not set' };
  if (!process.env.RENDER_OWNER_ID) return { integration: 'render', reason: 'RENDER_OWNER_ID env var not set' };
  try {
    const r = await pingWithTimeout('https://api.render.com/v1/owners?limit=1', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!r.ok) return { integration: 'render', reason: `Render /owners returned HTTP ${r.status}` };
    return null;
  } catch (err) {
    return { integration: 'render', reason: `Render /owners threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkPostmark(): Promise<PreflightFailure | null> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return { integration: 'postmark', reason: 'POSTMARK_SERVER_TOKEN env var not set' };
  try {
    const r = await pingWithTimeout('https://api.postmarkapp.com/server', {
      headers: { 'X-Postmark-Server-Token': token, Accept: 'application/json' },
    });
    if (!r.ok) return { integration: 'postmark', reason: `Postmark /server returned HTTP ${r.status}` };
    return null;
  } catch (err) {
    return { integration: 'postmark', reason: `Postmark /server threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkNeon(): Promise<PreflightFailure | null> {
  if (!process.env.DATABASE_URL) return { integration: 'neon', reason: 'DATABASE_URL env var not set' };
  try {
    await db.execute(sql`SELECT 1 as ok`);
    return null;
  } catch (err) {
    return { integration: 'neon', reason: `Neon SELECT 1 threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkAnthropic(): PreflightFailure | null {
  // OAuth file check is sync (file presence + token expiry). Direct API key
  // is also acceptable. Bedrock paths are also acceptable.
  if (isAnthropicOAuthAvailable()) return null;
  if (process.env.ANTHROPIC_API_KEY) return null;
  if (process.env.AWS_BEDROCK_API_KEY) return null;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return null;
  return { integration: 'anthropic', reason: 'No Claude OAuth, ANTHROPIC_API_KEY, or Bedrock creds available' };
}

export interface PreflightOptions {
  /** Skip cache. Used by smoke tests and recovery flows. */
  bypassCache?: boolean;
  /** Skip specific integrations (e.g., when a task scope doesn't touch them). */
  skip?: Array<'github' | 'render' | 'postmark' | 'neon' | 'anthropic'>;
}

/**
 * Run all preflight checks in parallel. Returns the aggregate result.
 * Cached for 60s — safe to call on every task launch.
 */
export async function preflightCheck(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const now = Date.now();
  if (!opts.bypassCache && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const skip = new Set(opts.skip ?? []);
  const checks: Array<Promise<PreflightFailure | null>> = [];
  if (!skip.has('github'))    checks.push(checkGitHub());
  if (!skip.has('render'))    checks.push(checkRender());
  if (!skip.has('postmark'))  checks.push(checkPostmark());
  if (!skip.has('neon'))      checks.push(checkNeon());
  if (!skip.has('anthropic')) checks.push(Promise.resolve(checkAnthropic()));

  const results = await Promise.all(checks);
  const failures = results.filter((r): r is PreflightFailure => r !== null);
  const result: PreflightResult = { ok: failures.length === 0, failures, checkedAt: now };

  cached = result;
  cachedAt = now;

  if (!result.ok) {
    log.warn('Preflight failures detected', { failures: result.failures });
  }

  return result;
}

/** Format failures into a single error message suitable for task_failed events. */
export function formatPreflightFailures(failures: PreflightFailure[]): string {
  return `Preflight failed: ${failures.map((f) => `${f.integration} (${f.reason})`).join('; ')}`;
}

/** Test helper — clears the 60s cache so tests see fresh state. */
export function _clearPreflightCache(): void {
  cached = null;
  cachedAt = 0;
}
