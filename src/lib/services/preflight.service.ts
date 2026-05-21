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

import { getAnthropicOAuthToken, isAnthropicOAuthAvailable } from '@/lib/anthropic-oauth';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import {
  isBedrockAvailable,
  isDirectAnthropicAvailable,
  isGeminiAvailable,
  isMoonshotAvailable,
  isOpenAIAvailable,
  isOpenRouterAvailable,
} from '@/lib/llm-provider';

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
const DEFAULT_RENDER_PIPELINE_BLOCKER_WINDOW_MS = 24 * 60 * 60 * 1000;

type RenderServiceListEntry = {
  cursor?: string;
  id?: string;
  service?: { id?: string };
};

type RenderServiceEventEntry = {
  type?: string;
  timestamp?: string;
  details?: { buildId?: string; deployId?: string };
  event?: {
    type?: string;
    timestamp?: string;
    details?: { buildId?: string; deployId?: string };
  };
};

type RenderDeployListEntry = {
  deploy?: {
    id?: string;
    status?: string;
    finishedAt?: string | null;
    commit?: { id?: string; message?: string };
  };
  id?: string;
  status?: string;
  finishedAt?: string | null;
  commit?: { id?: string; message?: string };
};

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

function renderPipelineBlockerWindowMs(): number {
  const raw = Number(process.env.RENDER_PIPELINE_BLOCKER_WINDOW_MS ?? DEFAULT_RENDER_PIPELINE_BLOCKER_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RENDER_PIPELINE_BLOCKER_WINDOW_MS;
}

function isRecentTimestamp(timestamp: string | undefined, nowMs: number, windowMs: number): boolean {
  if (!timestamp) return true;
  const eventMs = Date.parse(timestamp);
  if (!Number.isFinite(eventMs)) return true;
  return eventMs >= nowMs - windowMs;
}

function renderQuotaRetryAfterIso(timestamp: string | undefined, windowMs: number): string | null {
  if (!timestamp) return null;
  const eventMs = Date.parse(timestamp);
  if (!Number.isFinite(eventMs)) return null;
  return new Date(eventMs + windowMs).toISOString();
}

function deployFinishedAfterEvent(
  deploy: RenderDeployListEntry['deploy'] | RenderDeployListEntry | undefined,
  eventTimestamp: string | undefined,
): boolean {
  if (!deploy || !eventTimestamp) return false;
  const status = String(deploy.status ?? '').toLowerCase();
  if (status !== 'live' && status !== 'succeeded') return false;

  const eventMs = Date.parse(eventTimestamp);
  const finishedMs = Date.parse(String(deploy.finishedAt ?? ''));
  if (!Number.isFinite(eventMs) || !Number.isFinite(finishedMs)) return false;
  return finishedMs > eventMs;
}

async function renderQuotaEventClearedByLiveDeploy(
  token: string,
  serviceId: string,
  eventTimestamp: string | undefined,
): Promise<boolean> {
  const deploysRes = await pingWithTimeout(`https://api.render.com/v1/services/${serviceId}/deploys?limit=5`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const deploysData = await deploysRes.json().catch(() => []) as RenderDeployListEntry[] | { message?: string };
  if (!deploysRes.ok || !Array.isArray(deploysData)) return false;

  return deploysData
    .map((entry) => entry.deploy ?? entry)
    .some((deploy) => deployFinishedAfterEvent(deploy, eventTimestamp));
}

async function renderQuotaEventClearedByAnyLiveDeploy(
  token: string,
  serviceIds: string[],
  eventTimestamp: string | undefined,
): Promise<boolean> {
  const checks = await Promise.all(serviceIds.map((serviceId) =>
    renderQuotaEventClearedByLiveDeploy(token, serviceId, eventTimestamp)));
  return checks.some(Boolean);
}

async function fetchRenderServiceIdsForQuotaProbe(token: string, serviceLimit: number): Promise<string[] | { error: string }> {
  const serviceIds: string[] = [];
  let cursor: string | null = null;

  while (serviceIds.length < serviceLimit) {
    const pageSize = Math.min(25, serviceLimit - serviceIds.length);
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const servicesRes = await pingWithTimeout(`https://api.render.com/v1/services?limit=${pageSize}${cursorParam}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const servicesData = await servicesRes.json().catch(() => []) as RenderServiceListEntry[] | { message?: string };
    if (!servicesRes.ok || !Array.isArray(servicesData)) {
      return { error: `HTTP ${servicesRes.status}` };
    }
    if (servicesData.length === 0) break;

    for (const entry of servicesData) {
      const serviceId = entry.service?.id ?? entry.id;
      if (typeof serviceId === 'string' && serviceId.length > 0) {
        serviceIds.push(serviceId);
      }
    }

    const nextCursor = servicesData.at(-1)?.cursor;
    if (servicesData.length < pageSize || !nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return serviceIds.slice(0, serviceLimit);
}

async function checkRenderQuotaEvents(token: string): Promise<PreflightFailure | null> {
  const windowMs = renderPipelineBlockerWindowMs();
  const serviceLimit = Math.max(1, Math.min(100, Number(process.env.RENDER_PREFLIGHT_QUOTA_SERVICE_LIMIT ?? 50) || 50));

  try {
    const serviceIds = await fetchRenderServiceIdsForQuotaProbe(token, serviceLimit);
    if ('error' in serviceIds) {
      return { integration: 'render', reason: `Render quota probe /services returned ${serviceIds.error}` };
    }
    if (serviceIds.length === 0) return null;

    const nowMs = Date.now();
    const eventResults = await Promise.all(serviceIds.map(async (serviceId) => {
      const eventsRes = await pingWithTimeout(`https://api.render.com/v1/services/${serviceId}/events?limit=5`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const eventsData = await eventsRes.json().catch(() => []) as RenderServiceEventEntry[] | { message?: string };
      if (!eventsRes.ok || !Array.isArray(eventsData)) {
        return { serviceId, error: `HTTP ${eventsRes.status}` };
      }
      const event = eventsData
        .map((entry) => entry.event ?? entry)
        .find((candidate) =>
          candidate.type === 'pipeline_minutes_exhausted' &&
          isRecentTimestamp(candidate.timestamp, nowMs, windowMs));
      return event ? { serviceId, event } : null;
    }));

    const quotaEvents = eventResults.filter((result): result is { serviceId: string; event: NonNullable<RenderServiceEventEntry['event']> } =>
      Boolean(result && 'event' in result));
    if (quotaEvents.length === 0) return null;

    const quotaBlocker = quotaEvents.reduce((latest, candidate) => {
      const latestMs = Date.parse(String(latest.event.timestamp ?? ''));
      const candidateMs = Date.parse(String(candidate.event.timestamp ?? ''));
      if (!Number.isFinite(latestMs)) return latest;
      if (!Number.isFinite(candidateMs)) return candidate;
      return candidateMs > latestMs ? candidate : latest;
    });
    const cleared = await renderQuotaEventClearedByAnyLiveDeploy(token, serviceIds, quotaBlocker.event.timestamp);
    if (cleared) return null;

    const { serviceId, event } = quotaBlocker;
    const details = event.details ?? {};
    const retryAfterIso = renderQuotaRetryAfterIso(event.timestamp, windowMs);
    return {
      integration: 'render',
      reason: [
        'recent pipeline_minutes_exhausted event detected before canary launch',
        `service_id=${serviceId}`,
        `event_time=${event.timestamp ?? 'unknown'}`,
        details.buildId ? `build_id=${details.buildId}` : '',
        details.deployId ? `deploy_id=${details.deployId}` : '',
        `window_minutes=${Math.round(windowMs / 60000)}`,
        retryAfterIso ? `earliest_retry_after=${retryAfterIso}` : '',
        'restore Render build minutes/quota before triggering deploy/replay',
      ].filter(Boolean).join('; '),
    };
  } catch (err) {
    return { integration: 'render', reason: `Render quota probe threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkRender(opts: { quotaEvents?: boolean } = {}): Promise<PreflightFailure | null> {
  const token = process.env.RENDER_API_KEY;
  if (!token) return { integration: 'render', reason: 'RENDER_API_KEY env var not set' };
  if (!process.env.RENDER_OWNER_ID) return { integration: 'render', reason: 'RENDER_OWNER_ID env var not set' };
  try {
    const r = await pingWithTimeout('https://api.render.com/v1/owners?limit=1', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!r.ok) return { integration: 'render', reason: `Render /owners returned HTTP ${r.status}` };
    if (opts.quotaEvents) return checkRenderQuotaEvents(token);
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

async function checkAnthropic(): Promise<PreflightFailure | null> {
  // Validate OAuth by forcing a refresh when needed. A credentials file alone is
  // not enough: stale invalid_grant tokens used to let canaries launch and then
  // waste the first provider attempt.
  if (isAnthropicOAuthAvailable()) {
    const token = await getAnthropicOAuthToken();
    if (token) return null;
  }

  if (isDirectAnthropicAvailable() || isBedrockAvailable()) return null;

  // Anthropic is preferred, but Engineering can still run when provider routing
  // has another configured live LLM path. Treat that as healthy preflight; the
  // provider loop will skip/fail Anthropic and continue to the next provider.
  if (isOpenRouterAvailable() || isOpenAIAvailable() || isMoonshotAvailable() || isGeminiAvailable()) {
    return null;
  }

  return {
    integration: 'anthropic',
    reason: 'No usable Claude OAuth, ANTHROPIC_API_KEY, Bedrock creds, or fallback LLM provider credentials available',
  };
}

export interface PreflightOptions {
  /** Skip cache. Used by smoke tests and recovery flows. */
  bypassCache?: boolean;
  /** Inspect recent Render service events for account-level build-minute exhaustion. Use before canary/deploy runs. */
  renderQuotaEvents?: boolean;
  /** Skip specific integrations (e.g., when a task scope doesn't touch them). */
  skip?: Array<'github' | 'render' | 'postmark' | 'neon' | 'anthropic'>;
}

/**
 * Run all preflight checks in parallel. Returns the aggregate result.
 * Cached for 60s — safe to call on every task launch.
 */
export async function preflightCheck(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const now = Date.now();
  if (!opts.bypassCache && !opts.renderQuotaEvents && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  const skip = new Set(opts.skip ?? []);
  const checks: Array<Promise<PreflightFailure | null>> = [];
  if (!skip.has('github'))    checks.push(checkGitHub());
  if (!skip.has('render'))    checks.push(checkRender({ quotaEvents: opts.renderQuotaEvents === true }));
  if (!skip.has('postmark'))  checks.push(checkPostmark());
  if (!skip.has('neon'))      checks.push(checkNeon());
  if (!skip.has('anthropic')) checks.push(checkAnthropic());

  const results = await Promise.all(checks);
  const failures = results.filter((r): r is PreflightFailure => r !== null);
  const result: PreflightResult = { ok: failures.length === 0, failures, checkedAt: now };

  if (!opts.renderQuotaEvents) {
    cached = result;
    cachedAt = now;
  }

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
