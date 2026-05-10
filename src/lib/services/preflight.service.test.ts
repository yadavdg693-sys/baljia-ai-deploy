// Preflight tests — exercise the per-integration check matrix without hitting
// real upstreams. Each test stubs `fetch` and the env vars to drive the path
// being verified.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { execute: vi.fn(async () => [{ ok: 1 }]) },
}));

vi.mock('@/lib/anthropic-oauth', () => ({
  isAnthropicOAuthAvailable: () => true,
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

describe('preflightCheck', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    setEnv(ALL_GREEN_ENV);
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
