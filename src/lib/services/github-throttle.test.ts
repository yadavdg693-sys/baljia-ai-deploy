// Unit tests for the in-process GitHub throttle.

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('githubFetch throttle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('returns the response unchanged on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const { githubFetch } = await import('@/lib/services/github-throttle');
    const res = await githubFetch('https://api.github.com/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('retries on 429 with Retry-After, returns success after retry', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } });
      }
      return new Response('ok', { status: 200 });
    }));
    const { githubFetch } = await import('@/lib/services/github-throttle');
    const start = Date.now();
    const res = await githubFetch('https://api.github.com/test');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(900); // 1s Retry-After honored
    expect(elapsed).toBeLessThan(3000);
  });

  it('returns the 429 after max retries exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })));
    const { githubFetch } = await import('@/lib/services/github-throttle');
    const res = await githubFetch('https://api.github.com/x');
    expect(res.status).toBe(429);
  }, 30_000);

  it('caps concurrency: 30 simultaneous calls do not all run at once', async () => {
    let inflight = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 50));
      inflight--;
      return new Response('ok', { status: 200 });
    }));
    const { githubFetch } = await import('@/lib/services/github-throttle');
    const requests = Array.from({ length: 30 }, () => githubFetch('https://api.github.com/'));
    await Promise.all(requests);
    // Default cap is 20 — should never exceed it.
    expect(peak).toBeLessThanOrEqual(20);
    expect(peak).toBeGreaterThan(1); // sanity: parallelism is happening
  });
});
