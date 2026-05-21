import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runJourney } from './journey-runner.service';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('runJourney — happy path', () => {
  it('walks 2 steps with cookie persistence between them', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 1) {
        return new Response('register form', {
          status: 200,
          headers: { 'set-cookie': 'sid=abc123; Path=/; HttpOnly' },
        });
      }
      // Second call — must include the cookie from step 1
      const cookie = (init?.headers as Record<string, string>)?.Cookie ?? '';
      if (!cookie.includes('sid=abc123')) throw new Error('cookie not persisted');
      return new Response('dashboard', { status: 200 });
    }));

    const result = await runJourney({
      journey_name: 'register-then-dashboard',
      base_url: 'https://example.com',
      steps: [
        { step: 'register', path: '/register', expect_status: 200 },
        { step: 'dashboard', path: '/dashboard', expect_status: 200 },
      ],
    });

    expect(result.allPassed).toBe(true);
    expect(result.summary).toMatch(/^JOURNEY PASS/);
    expect(result.summary).toMatch(/2 steps passed/);
  });
});

describe('runJourney — failure paths', () => {
  it('stops at first failed step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const result = await runJourney({
      journey_name: 'two-step',
      base_url: 'https://x.com',
      steps: [
        { step: 'first',  path: '/a', expect_status: 200 },
        { step: 'second', path: '/b', expect_status: 200 },
      ],
    });
    expect(result.allPassed).toBe(false);
    expect(result.passedSteps).toBe(0);
    expect(result.ranSteps).toBe(1); // stopped after first failure
    expect(result.summary).toMatch(/JOURNEY FAIL/);
  });

  it('treats fetch threw as step failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect refused'); }));
    const result = await runJourney({
      journey_name: 'unreachable',
      base_url: 'https://nowhere.test',
      steps: [{ step: 'probe', path: '/', expect_status: 200 }],
    });
    expect(result.allPassed).toBe(false);
    expect(result.summary).toMatch(/connect refused|threw/);
  });

  it('expect_status accepts an array of valid statuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 302, headers: { location: '/dashboard' } })));
    const result = await runJourney({
      journey_name: 'redirect-or-201',
      base_url: 'https://x.com',
      steps: [{ step: 'create', method: 'POST', path: '/create', expect_status: [302, 201] }],
    });
    expect(result.allPassed).toBe(true);
  });

  it('sends same-origin headers on mutating requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      if (headers.Origin !== 'https://x.com') return new Response('missing origin', { status: 403 });
      if (headers.Referer !== 'https://x.com/') return new Response('missing referer', { status: 403 });
      return new Response('ok', { status: 201 });
    }));

    const result = await runJourney({
      journey_name: 'better-auth-compatible-post',
      base_url: 'https://x.com',
      steps: [{ step: 'create', method: 'POST', path: '/api/create', body: { title: 'A' }, body_type: 'json', expect_status: 201 }],
    });

    expect(result.allPassed).toBe(true);
  });

  it('expect_body_not_contains catches forbidden text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Registration failed: try again', { status: 200 })));
    const result = await runJourney({
      journey_name: 'no-error-toast',
      base_url: 'https://x.com',
      steps: [{ step: 'register', path: '/register', expect_status: 200, expect_body_not_contains: 'Registration failed' }],
    });
    expect(result.allPassed).toBe(false);
  });
});
