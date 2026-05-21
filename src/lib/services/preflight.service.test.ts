// Preflight tests — exercise the per-integration check matrix without hitting
// real upstreams. Each test stubs `fetch` and the env vars to drive the path
// being verified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const providerMocks = vi.hoisted(() => ({
  getAnthropicOAuthToken: vi.fn(async (): Promise<string | null> => 'oauth-token'),
  isAnthropicOAuthAvailable: vi.fn(() => true),
  isBedrockAvailable: vi.fn(() => false),
  isDirectAnthropicAvailable: vi.fn(() => false),
  isGeminiAvailable: vi.fn(() => false),
  isMoonshotAvailable: vi.fn(() => false),
  isOpenAIAvailable: vi.fn(() => false),
  isOpenRouterAvailable: vi.fn(() => false),
}));

vi.mock('@/lib/db', () => ({
  db: { execute: vi.fn(async () => [{ ok: 1 }]) },
}));

vi.mock('@/lib/anthropic-oauth', () => ({
  getAnthropicOAuthToken: providerMocks.getAnthropicOAuthToken,
  isAnthropicOAuthAvailable: providerMocks.isAnthropicOAuthAvailable,
}));

vi.mock('@/lib/llm-provider', () => ({
  isBedrockAvailable: providerMocks.isBedrockAvailable,
  isDirectAnthropicAvailable: providerMocks.isDirectAnthropicAvailable,
  isGeminiAvailable: providerMocks.isGeminiAvailable,
  isMoonshotAvailable: providerMocks.isMoonshotAvailable,
  isOpenAIAvailable: providerMocks.isOpenAIAvailable,
  isOpenRouterAvailable: providerMocks.isOpenRouterAvailable,
}));

const ALL_GREEN_ENV = {
  GITHUB_TOKEN: 'gh_pat_' + 'A'.repeat(60), // 67 chars, looks valid
  RENDER_API_KEY: 'rnd_test_key',
  RENDER_OWNER_ID: 'tea-test',
  POSTMARK_SERVER_TOKEN: 'pm-test-token',
  DATABASE_URL: 'postgresql://test',
};

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function mockFetchOk() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
}

function mockFetchByUrl(map: Record<string, number>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    for (const [pattern, status] of Object.entries(map)) {
      if (url.includes(pattern)) return new Response('', { status });
    }
    return new Response('', { status: 200 });
  }));
}

function mockFetchJsonByUrl(handler: (url: string) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }));
}

describe('preflightCheck', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    setEnv(ALL_GREEN_ENV);
    providerMocks.getAnthropicOAuthToken.mockResolvedValue('oauth-token');
    providerMocks.isAnthropicOAuthAvailable.mockReturnValue(true);
    providerMocks.isBedrockAvailable.mockReturnValue(false);
    providerMocks.isDirectAnthropicAvailable.mockReturnValue(false);
    providerMocks.isGeminiAvailable.mockReturnValue(false);
    providerMocks.isMoonshotAvailable.mockReturnValue(false);
    providerMocks.isOpenAIAvailable.mockReturnValue(false);
    providerMocks.isOpenRouterAvailable.mockReturnValue(false);
    const { _clearPreflightCache } = await import('./preflight.service');
    _clearPreflightCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('returns ok=true when all integrations respond healthily', async () => {
    mockFetchOk();
    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('flags GitHub when token is truncated (length < 40)', async () => {
    setEnv({ ...ALL_GREEN_ENV, GITHUB_TOKEN: 'gh_short' });
    mockFetchOk();
    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true });
    expect(result.ok).toBe(false);
    const ghFailure = result.failures.find((f) => f.integration === 'github');
    expect(ghFailure?.reason).toMatch(/truncated/i);
  });

  it('flags Render when API returns 401', async () => {
    mockFetchByUrl({ 'api.render.com': 401 });
    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true });
    expect(result.ok).toBe(false);
    const renderFailure = result.failures.find((f) => f.integration === 'render');
    expect(renderFailure?.reason).toMatch(/HTTP 401/);
  });

  it('flags recent Render pipeline-minute exhaustion when quota event probing is enabled', async () => {
    mockFetchJsonByUrl((url) => {
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 1 } };
      if (url.includes('api.render.com/v1/owners')) return { status: 200, body: [{ owner: { id: 'tea-test' } }] };
      if (url.includes('api.render.com/v1/services?')) return { status: 200, body: [{ service: { id: 'srv-quota' } }] };
      if (url.includes('/services/srv-quota/events')) {
        return {
          status: 200,
          body: [{
            event: {
              type: 'pipeline_minutes_exhausted',
              timestamp: new Date().toISOString(),
              details: { buildId: 'bld-quota', deployId: 'dep-quota' },
            },
          }],
        };
      }
      if (url.includes('api.postmarkapp.com/server')) return { status: 200, body: { ok: true } };
      return { status: 200, body: { ok: true } };
    });

    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true, renderQuotaEvents: true });

    expect(result.ok).toBe(false);
    const renderFailure = result.failures.find((f) => f.integration === 'render');
    expect(renderFailure?.reason).toContain('pipeline_minutes_exhausted');
    expect(renderFailure?.reason).toContain('service_id=srv-quota');
    expect(renderFailure?.reason).toContain('build_id=bld-quota');
    expect(renderFailure?.reason).toContain('earliest_retry_after=');
  });

  it('scans paginated Render services for quota events', async () => {
    process.env.RENDER_PREFLIGHT_QUOTA_SERVICE_LIMIT = '26';
    mockFetchJsonByUrl((url) => {
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 1 } };
      if (url.includes('api.render.com/v1/owners')) return { status: 200, body: [{ owner: { id: 'tea-test' } }] };
      if (url.includes('api.render.com/v1/services?limit=1&cursor=page-2')) {
        return { status: 200, body: [{ service: { id: 'srv-page-2' }, cursor: 'page-3' }] };
      }
      if (url.includes('api.render.com/v1/services?limit=25')) {
        return {
          status: 200,
          body: Array.from({ length: 25 }, (_, index) => ({
            service: { id: `srv-page-1-${index}` },
            cursor: index === 24 ? 'page-2' : `page-1-${index}`,
          })),
        };
      }
      if (url.includes('/services/srv-page-2/events')) {
        return {
          status: 200,
          body: [{
            event: {
              type: 'pipeline_minutes_exhausted',
              timestamp: new Date().toISOString(),
              details: { buildId: 'bld-page-2' },
            },
          }],
        };
      }
      if (url.includes('/services/') && url.includes('/events')) return { status: 200, body: [] };
      if (url.includes('api.postmarkapp.com/server')) return { status: 200, body: { ok: true } };
      return { status: 200, body: { ok: true } };
    });

    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true, renderQuotaEvents: true });

    expect(result.ok).toBe(false);
    const renderFailure = result.failures.find((f) => f.integration === 'render');
    expect(renderFailure?.reason).toContain('service_id=srv-page-2');
    expect(renderFailure?.reason).toContain('build_id=bld-page-2');
  });

  it('does not flag recent Render quota events cleared by a newer live deploy', async () => {
    const quotaTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const liveTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    mockFetchJsonByUrl((url) => {
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 1 } };
      if (url.includes('api.render.com/v1/owners')) return { status: 200, body: [{ owner: { id: 'tea-test' } }] };
      if (url.includes('api.render.com/v1/services?')) return { status: 200, body: [{ service: { id: 'srv-restored' } }] };
      if (url.includes('/services/srv-restored/events')) {
        return {
          status: 200,
          body: [{
            event: {
              type: 'pipeline_minutes_exhausted',
              timestamp: quotaTimestamp,
              details: { buildId: 'bld-quota' },
            },
          }],
        };
      }
      if (url.includes('/services/srv-restored/deploys')) {
        return {
          status: 200,
          body: [{
            deploy: {
              id: 'dep-live-after-quota',
              status: 'live',
              finishedAt: liveTimestamp,
            },
          }],
        };
      }
      if (url.includes('api.postmarkapp.com/server')) return { status: 200, body: { ok: true } };
      return { status: 200, body: { ok: true } };
    });

    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true, renderQuotaEvents: true });

    expect(result.ok).toBe(true);
  });

  it('does not flag recent account-level quota events cleared by a newer live deploy on another service', async () => {
    const quotaTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const liveTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    mockFetchJsonByUrl((url) => {
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 1 } };
      if (url.includes('api.render.com/v1/owners')) return { status: 200, body: [{ owner: { id: 'tea-test' } }] };
      if (url.includes('api.render.com/v1/services?')) {
        return {
          status: 200,
          body: [
            { service: { id: 'srv-quota-failed' } },
            { service: { id: 'srv-restored-elsewhere' } },
          ],
        };
      }
      if (url.includes('/services/srv-quota-failed/events')) {
        return {
          status: 200,
          body: [{
            event: {
              type: 'pipeline_minutes_exhausted',
              timestamp: quotaTimestamp,
              details: { buildId: 'bld-quota' },
            },
          }],
        };
      }
      if (url.includes('/services/srv-restored-elsewhere/events')) return { status: 200, body: [] };
      if (url.includes('/services/srv-quota-failed/deploys')) return { status: 200, body: [] };
      if (url.includes('/services/srv-restored-elsewhere/deploys')) {
        return {
          status: 200,
          body: [{
            deploy: {
              id: 'dep-live-after-quota',
              status: 'live',
              finishedAt: liveTimestamp,
            },
          }],
        };
      }
      if (url.includes('api.postmarkapp.com/server')) return { status: 200, body: { ok: true } };
      return { status: 200, body: { ok: true } };
    });

    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true, renderQuotaEvents: true });

    expect(result.ok).toBe(true);
  });

  it('does not flag old Render pipeline-minute events outside the blocker window', async () => {
    process.env.RENDER_PIPELINE_BLOCKER_WINDOW_MS = String(60 * 60 * 1000);
    const oldTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    mockFetchJsonByUrl((url) => {
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 1 } };
      if (url.includes('api.render.com/v1/owners')) return { status: 200, body: [{ owner: { id: 'tea-test' } }] };
      if (url.includes('api.render.com/v1/services?')) return { status: 200, body: [{ service: { id: 'srv-old' } }] };
      if (url.includes('/services/srv-old/events')) {
        return {
          status: 200,
          body: [{
            event: {
              type: 'pipeline_minutes_exhausted',
              timestamp: oldTimestamp,
              details: { buildId: 'bld-old' },
            },
          }],
        };
      }
      if (url.includes('api.postmarkapp.com/server')) return { status: 200, body: { ok: true } };
      return { status: 200, body: { ok: true } };
    });

    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true, renderQuotaEvents: true });

    expect(result.ok).toBe(true);
  });

  it('returns ALL failures when multiple integrations are broken (not just first)', async () => {
    setEnv({ ...ALL_GREEN_ENV, GITHUB_TOKEN: undefined, POSTMARK_SERVER_TOKEN: undefined });
    mockFetchOk();
    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true });
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(2);
    const integrations = result.failures.map((f) => f.integration);
    expect(integrations).toContain('github');
    expect(integrations).toContain('postmark');
  });

  it('accepts configured fallback LLM providers when Claude OAuth refresh is unusable', async () => {
    providerMocks.getAnthropicOAuthToken.mockResolvedValue(null);
    providerMocks.isOpenRouterAvailable.mockReturnValue(true);
    mockFetchOk();
    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true });
    expect(result.ok).toBe(true);
  });

  it('flags LLM preflight when Claude OAuth is unusable and no fallback provider exists', async () => {
    providerMocks.getAnthropicOAuthToken.mockResolvedValue(null);
    mockFetchOk();
    const { preflightCheck } = await import('./preflight.service');
    const result = await preflightCheck({ bypassCache: true });
    expect(result.ok).toBe(false);
    const llmFailure = result.failures.find((f) => f.integration === 'anthropic');
    expect(llmFailure?.reason).toMatch(/fallback LLM provider/i);
  });

  it('caches results for 60s when bypassCache is not set', async () => {
    mockFetchOk();
    const { preflightCheck, _clearPreflightCache } = await import('./preflight.service');
    _clearPreflightCache();
    const r1 = await preflightCheck();
    const r2 = await preflightCheck();
    // Cached → identical checkedAt timestamp (not re-run)
    expect(r2.checkedAt).toBe(r1.checkedAt);
  });
});

describe('formatPreflightFailures', () => {
  it('produces a one-line error message suitable for task_failed events', async () => {
    const { formatPreflightFailures } = await import('./preflight.service');
    const msg = formatPreflightFailures([
      { integration: 'github', reason: 'GITHUB_TOKEN truncated' },
      { integration: 'render', reason: 'HTTP 401' },
    ]);
    expect(msg).toMatch(/^Preflight failed:/);
    expect(msg).toContain('github');
    expect(msg).toContain('render');
  });
});
