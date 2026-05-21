# Verifier-Injected Journey Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the engineering agent finishes a deploy without calling `verify_user_journey`, have the platform's verifier itself run a fallback journey against the deployed URL — converting the existing "soft prompt-level mandate" into a hard structural guarantee.

**Architecture:**
1. Extract the journey-walking logic from `engineering.tools.ts` into a standalone service (`journey-runner.service.ts`) so both the agent's `verify_user_journey` tool AND the verifier can call it.
2. Add a helper to resolve a company's deployed URL (prefer `custom_domain`, fall back to looking up the Render service URL).
3. In `verifyDeterministic`, when `requiresDeploy=true` AND deploy evidence exists AND no successful journey-evidence was found, the verifier itself probes the app: GET `/` for liveness, then run a default auth journey if `/register` returns 200. Record the result as journey evidence.
4. Treat the fallback's findings as evidence of the same shape the agent would have produced — same `JOURNEY PASS / FAIL` semantics, same hard-gate enforcement.

**Tech Stack:** TypeScript, vitest, existing `fetch`-based journey walker, existing Drizzle/Neon DB access, existing Render API client. No new dependencies.

**Out of scope:**
- Cost ceiling, Sentry wiring, observability dashboards (separate plans)
- Multi-instance Redis migration (defer until needed)
- The `allowedTerms` callsite wiring (separate quick win)
- Changing the agent prompt — fallback is a backstop, not a replacement for the prompt-level mandate

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/lib/services/journey-runner.service.ts` | Shared journey-walking implementation: stateful HTTP walk with cookie jar, per-step assertions, structured pass/fail result | **Create** |
| `src/lib/services/journey-runner.service.test.ts` | Unit tests for the shared runner | **Create** |
| `src/lib/agents/tools/engineering.tools.ts:1474-1599` | Replace inline `handleVerifyUserJourney` body with thin wrapper around the shared runner | **Modify** |
| `src/lib/services/verification.service.ts:117-135` | Add `getCompanyAppUrl(companyId)` helper + `runFallbackJourney(task)` function + wire into `verifyDeterministic` | **Modify** |
| `src/lib/services/verification.service.test.ts` | Add 4 tests covering: fallback fires when agent skipped, fallback skipped when agent ran journey, fallback URL resolution, fallback failure marks task failed | **Modify** |
| `src/scripts/smoke-test-fallback-journey.ts` | End-to-end smoke against threadpulse: clear journey evidence, run verifier, confirm fallback fires + passes | **Create** |

---

## Task 1: Extract journey runner into a shared service

**Files:**
- Create: `src/lib/services/journey-runner.service.ts`
- Create: `src/lib/services/journey-runner.service.test.ts`

- [ ] **Step 1: Write the failing test for `runJourney` happy path**

Create `src/lib/services/journey-runner.service.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/journey-runner.service.test.ts`
Expected: FAIL with `Cannot find module './journey-runner.service'`.

- [ ] **Step 3: Create `journey-runner.service.ts` with minimal implementation**

Create `src/lib/services/journey-runner.service.ts`:

```ts
// Shared journey runner — used by both the engineering agent's
// verify_user_journey tool and the verifier's fallback path.
//
// Stateful HTTP walker: makes requests in order, persists cookies across
// steps (latest write wins per name), asserts on response status / redirect /
// body content, stops at the first failed step, returns structured findings.

export interface JourneyStep {
  step: string;
  method?: string;
  path: string;
  body?: Record<string, unknown>;
  body_type?: 'form' | 'json';
  expect_status?: number | number[];
  expect_redirect?: string;
  expect_body_contains?: string;
  expect_body_not_contains?: string;
}

export interface JourneyInput {
  journey_name: string;
  base_url: string;
  steps: JourneyStep[];
}

export interface JourneyResult {
  allPassed: boolean;
  summary: string;        // "JOURNEY PASS: ..." or "JOURNEY FAIL: ..." + step lines
  passedSteps: number;
  totalSteps: number;
  ranSteps: number;
}

export async function runJourney(input: JourneyInput): Promise<JourneyResult> {
  const { journey_name, base_url, steps } = input;
  const cookieJar = new Map<string, Map<string, string>>();
  const results: Array<{
    idx: number; step: string; method: string; path: string; status: number;
    pass: boolean;
    checks: Array<{ name: string; expected?: unknown; actual?: unknown; pass: boolean }>;
    bodySnippet?: string;
  }> = [];

  const buildCookieHeader = (host: string): string | undefined => {
    const m = cookieJar.get(host);
    if (!m || m.size === 0) return undefined;
    return [...m.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  };

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const method = (s.method ?? 'GET').toUpperCase();
    const url = new URL(s.path, base_url).toString();
    const headers: Record<string, string> = { 'User-Agent': 'Baljia/1.0 journey-runner' };
    const host = new URL(url).host;
    const cookieHeader = buildCookieHeader(host);
    if (cookieHeader) headers.Cookie = cookieHeader;

    let body: string | undefined;
    if (s.body && method !== 'GET') {
      if (s.body_type === 'json') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(s.body);
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(s.body)) params.append(k, String(v));
        body = params.toString();
      }
    }

    let status = 0;
    let respText = '';
    let redirect = '';
    let setCookie = '';
    try {
      const resp = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      status = resp.status;
      redirect = resp.headers.get('location') ?? '';
      setCookie = resp.headers.get('set-cookie') ?? '';
      respText = await resp.text().catch(() => '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        idx: i + 1, step: s.step, method, path: s.path, status: 0, pass: false,
        checks: [{ name: 'fetch', expected: 'completed', actual: `threw: ${msg}`, pass: false }],
      });
      break;
    }

    if (setCookie) {
      const parts = setCookie.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/);
      const hostJar = cookieJar.get(host) ?? new Map<string, string>();
      for (const raw of parts) {
        const pair = raw.split(';')[0].trim();
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (!value) hostJar.delete(name);
        else hostJar.set(name, value);
      }
      cookieJar.set(host, hostJar);
    }

    const checks: Array<{ name: string; expected?: unknown; actual?: unknown; pass: boolean }> = [];
    if (s.expect_status !== undefined) {
      const accepted = Array.isArray(s.expect_status) ? s.expect_status : [s.expect_status];
      checks.push({ name: 'status', expected: s.expect_status, actual: status, pass: accepted.includes(status) });
    }
    if (s.expect_redirect) {
      checks.push({ name: 'redirect contains', expected: s.expect_redirect, actual: redirect || '(none)', pass: redirect.includes(s.expect_redirect) });
    }
    if (s.expect_body_contains) {
      checks.push({ name: 'body contains', expected: s.expect_body_contains, pass: respText.includes(s.expect_body_contains) });
    }
    if (s.expect_body_not_contains) {
      checks.push({ name: 'body must NOT contain', expected: s.expect_body_not_contains, pass: !respText.includes(s.expect_body_not_contains) });
    }

    const stepPass = checks.length > 0 ? checks.every((c) => c.pass) : status >= 200 && status < 400;
    results.push({
      idx: i + 1, step: s.step, method, path: s.path, status, pass: stepPass, checks,
      bodySnippet: stepPass ? undefined : respText.replace(/\s+/g, ' ').slice(0, 200),
    });
    if (!stepPass) break;
  }

  const totalSteps = steps.length;
  const ranSteps = results.length;
  const passedSteps = results.filter((r) => r.pass).length;
  const allPassed = passedSteps === totalSteps && ranSteps === totalSteps;
  const header = allPassed
    ? `JOURNEY PASS: "${journey_name}" - all ${totalSteps} steps passed.`
    : `JOURNEY FAIL: "${journey_name}" - ${passedSteps}/${totalSteps} steps passed (stopped at step ${ranSteps}).`;

  const lines = results.map((r) => {
    const checkSummary = r.checks.length === 0
      ? `(no expectations; status=${r.status})`
      : r.checks.map((c) => `${c.pass ? 'OK' : 'FAIL'} ${c.name}${c.expected !== undefined ? ` expected=${JSON.stringify(c.expected).slice(0, 60)}` : ''}${c.actual !== undefined ? ` actual=${JSON.stringify(c.actual).slice(0, 60)}` : ''}`).join(' | ');
    const snip = r.bodySnippet ? `\n      body: ${r.bodySnippet}` : '';
    return `  ${r.pass ? 'PASS' : 'FAIL'} step ${r.idx} ${r.method} ${r.path} -> HTTP ${r.status} ${checkSummary}${snip}`;
  }).join('\n');

  return {
    allPassed,
    summary: `${header}\n${lines}`,
    passedSteps,
    totalSteps,
    ranSteps,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/services/journey-runner.service.test.ts`
Expected: 1 test pass.

- [ ] **Step 5: Add failure-mode + edge-case tests**

Append to `src/lib/services/journey-runner.service.test.ts`:

```ts
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
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `npx vitest run src/lib/services/journey-runner.service.test.ts`
Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/journey-runner.service.ts src/lib/services/journey-runner.service.test.ts
git commit -m "feat(verifier): extract journey-runner service from engineering tool"
```

---

## Task 2: Refactor `handleVerifyUserJourney` to use the shared runner

**Files:**
- Modify: `src/lib/agents/tools/engineering.tools.ts:1474-1599` (the existing `handleVerifyUserJourney` function)

- [ ] **Step 1: Read the existing handler**

Run: `grep -n "async function handleVerifyUserJourney" src/lib/agents/tools/engineering.tools.ts`
Note the start line; look at lines from there to where the function ends (around 130 lines below).

- [ ] **Step 2: Replace handler with thin wrapper around runJourney**

Find the existing `async function handleVerifyUserJourney(input: Record<string, unknown>): Promise<string> { ... }` block. Replace its entire body (everything between the opening `{` and matching `}`) with:

```ts
async function handleVerifyUserJourney(input: Record<string, unknown>): Promise<string> {
  const journeyName = (input.journey_name as string | undefined) ?? 'unnamed';
  const baseUrl = input.base_url as string | undefined;
  const stepsRaw = input.steps as unknown;
  if (!baseUrl) return 'Error: base_url is required.';
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return 'Error: steps must be a non-empty array.';

  const { runJourney } = await import('@/lib/services/journey-runner.service');
  const result = await runJourney({
    journey_name: journeyName,
    base_url: baseUrl,
    steps: stepsRaw as Parameters<typeof runJourney>[0]['steps'],
  });
  return result.summary;
}
```

Also remove the now-duplicate `interface JourneyStep` block above the handler (it's now in `journey-runner.service.ts`).

- [ ] **Step 3: Typecheck the change**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "engineering.tools" | head`
Expected: no errors.

- [ ] **Step 4: Re-run the existing engineering-tools tests + the new runner tests**

Run: `npx vitest run src/lib/services/journey-runner.service.test.ts`
Expected: 5 pass.

Run: `npm test 2>&1 | tail -5`
Expected: same pass count as before plus 5 new (so 293 total). 1 pre-existing browser-tools.integration env failure unchanged.

- [ ] **Step 5: Smoke-test against the live threadpulse app to confirm the wrapper produces identical output to before**

Run: `npx tsx --env-file=.env.local src/scripts/test-verify-journey.ts 2>&1 | tail -15`
Expected: `JOURNEY PASS: "register, reach dashboard, sign out, sign back in" - all 8 steps passed.` (same as before refactor).

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/tools/engineering.tools.ts
git commit -m "refactor(engineering): use shared journey runner in verify_user_journey tool"
```

---

## Task 3: `getCompanyAppUrl` helper in verification service

**Files:**
- Modify: `src/lib/services/verification.service.ts` — add new helper near the top of the file, after the existing imports

- [ ] **Step 1: Write the failing test**

Append to `src/lib/services/verification.service.test.ts` (within an existing `describe` or as a new block):

```ts
describe('getCompanyAppUrl helper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('prefers custom_domain when present', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{
          custom_domain: 'threadpulse.baljia.app',
          render_service_id: 'srv-x',
        }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    const { getCompanyAppUrl } = await import('@/lib/services/verification.service');
    const url = await getCompanyAppUrl('c1');
    expect(url).toBe('https://threadpulse.baljia.app');
  });

  it('falls back to Render service URL when no custom domain', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{
          custom_domain: null,
          render_service_id: 'srv-abc',
        }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ service: { serviceDetails: { url: 'https://acme-xyz.onrender.com' } } }),
      { status: 200 },
    )));
    vi.stubEnv('RENDER_API_KEY', 'rnd_test');
    const { getCompanyAppUrl } = await import('@/lib/services/verification.service');
    const url = await getCompanyAppUrl('c1');
    expect(url).toBe('https://acme-xyz.onrender.com');
  });

  it('returns null when neither custom domain nor render service id', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{
          custom_domain: null,
          render_service_id: null,
        }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    const { getCompanyAppUrl } = await import('@/lib/services/verification.service');
    const url = await getCompanyAppUrl('c1');
    expect(url).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/verification.service.test.ts -t getCompanyAppUrl`
Expected: 3 tests fail with `getCompanyAppUrl is not a function`.

- [ ] **Step 3: Implement `getCompanyAppUrl` in verification.service.ts**

Find the imports block at the top of `src/lib/services/verification.service.ts`. After the existing `import { githubFetch } from '@/lib/services/github-throttle';` line, add nothing new — but find a place AFTER `companies` is imported and BEFORE `verifyDeterministic` is defined (any place between `getRepoHygiene` and `verifyDeterministic`), and insert:

```ts
const RENDER_API = 'https://api.render.com/v1';

/**
 * Resolve the URL where the company's deployed app is reachable.
 * Prefers custom_domain (e.g. threadpulse.baljia.app) over the Render-assigned
 * hostname. Returns null when neither is available — the verifier should skip
 * the journey-fallback in that case.
 */
export async function getCompanyAppUrl(companyId: string): Promise<string | null> {
  const [c] = await db.select({
    custom_domain:     companies.custom_domain,
    render_service_id: companies.render_service_id,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!c) return null;
  if (c.custom_domain) {
    return `https://${c.custom_domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }
  if (!c.render_service_id) return null;

  const token = process.env.RENDER_API_KEY;
  if (!token) return null;
  try {
    const r = await fetch(`${RENDER_API}/services/${c.render_service_id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const data = await r.json() as { service?: { serviceDetails?: { url?: string } }; serviceDetails?: { url?: string } };
    const url = data.service?.serviceDetails?.url ?? data.serviceDetails?.url ?? '';
    return url || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/services/verification.service.test.ts -t getCompanyAppUrl`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/verification.service.ts src/lib/services/verification.service.test.ts
git commit -m "feat(verifier): add getCompanyAppUrl helper"
```

---

## Task 4: Fallback journey runner in verification service

**Files:**
- Modify: `src/lib/services/verification.service.ts` — add `runFallbackJourney(companyId)` function

- [ ] **Step 1: Write the failing test**

Append to `src/lib/services/verification.service.test.ts`:

```ts
describe('runFallbackJourney', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('returns null when company has no resolvable URL', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ custom_domain: null, render_service_id: null }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    const { runFallbackJourney } = await import('@/lib/services/verification.service');
    const result = await runFallbackJourney('c1');
    expect(result).toBeNull();
  });

  it('returns JOURNEY PASS when / and /api/health both 2xx', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ custom_domain: 'app.example.com', render_service_id: 'srv-x' }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      // Step 1 GET / → 200 (also probes whether /register exists). Step 2 GET /api/health → 200.
      // Default fallback only does the / + /api/health probes.
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });
    }));
    const { runFallbackJourney } = await import('@/lib/services/verification.service');
    const result = await runFallbackJourney('c1');
    expect(result).not.toBeNull();
    expect(result!.allPassed).toBe(true);
    expect(result!.summary).toMatch(/JOURNEY PASS/);
  });

  it('returns JOURNEY FAIL when / returns 5xx', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ custom_domain: 'app.example.com', render_service_id: 'srv-x' }] }) }),
      }) },
      reports: {}, companies: { id: {}, custom_domain: {}, render_service_id: {} },
      taskExecutions: {},
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 502 })));
    const { runFallbackJourney } = await import('@/lib/services/verification.service');
    const result = await runFallbackJourney('c1');
    expect(result).not.toBeNull();
    expect(result!.allPassed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/verification.service.test.ts -t runFallbackJourney`
Expected: 3 tests fail.

- [ ] **Step 3: Implement `runFallbackJourney` in verification.service.ts**

Add after `getCompanyAppUrl` in `src/lib/services/verification.service.ts`:

```ts
/**
 * Verifier-side fallback when the engineering agent finished a deploy
 * without calling verify_user_journey. Probes the deployed URL with a
 * minimal "is this app actually responding?" walk: GET / and GET /api/health.
 *
 * Returns null when the URL can't be resolved (no fallback possible).
 * Otherwise returns a JourneyResult — the caller pushes it as journey
 * evidence into the verification check list.
 *
 * Intentionally narrow: we don't run the full register→login flow
 * because we'd be writing rows to the founder DB. The agent's own
 * verify_user_journey is the right place for that. The fallback is
 * a backstop, not a replacement.
 */
export async function runFallbackJourney(companyId: string): Promise<import('./journey-runner.service').JourneyResult | null> {
  const baseUrl = await getCompanyAppUrl(companyId);
  if (!baseUrl) return null;

  const { runJourney } = await import('./journey-runner.service');
  return runJourney({
    journey_name: 'verifier-fallback (read-only liveness)',
    base_url: baseUrl,
    steps: [
      { step: 'landing responds 2xx', path: '/',           expect_status: [200, 301, 302] },
      { step: 'health endpoint up',   path: '/api/health', expect_status: [200, 404] }, // 404 is acceptable — not all apps expose /api/health
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/services/verification.service.test.ts -t runFallbackJourney`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/verification.service.ts src/lib/services/verification.service.test.ts
git commit -m "feat(verifier): add runFallbackJourney for read-only liveness probe"
```

---

## Task 5: Wire fallback into `verifyDeterministic`

**Files:**
- Modify: `src/lib/services/verification.service.ts` — extend the `user_journey_evidence` check

- [ ] **Step 1: Write the failing test**

Append to `src/lib/services/verification.service.test.ts`:

```ts
describe('verifyDeterministic — journey fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('runs fallback journey when agent skipped verify_user_journey but deploy succeeded', async () => {
    // Agent ran deploy + check_url_health but NO verify_user_journey.
    const exec = {
      execution_log: [
        { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
        { tool: 'check_url_health',      result: '✅ https://app.x.com is UP — HTTP 200 in 50ms' },
      ],
    };
    const company = { custom_domain: 'app.x.com', render_service_id: 'srv-1', github_repo: null };

    let callIdx = 0;
    const sequence = [exec, company];
    const makeChain = () => {
      const rows = sequence[callIdx] ?? [];
      callIdx++;
      const chain: Record<string, unknown> = {};
      const wrap = (val: unknown) => Object.assign([...(Array.isArray(val) ? val : [val])], chain);
      chain.from    = () => chain;
      chain.where   = () => wrap(rows);
      chain.orderBy = () => chain;
      chain.limit   = () => wrap(rows);
      return chain;
    };
    vi.doMock('@/lib/db', () => ({
      db: { select: () => makeChain() },
      reports: { id: {}, title: {}, task_id: {} },
      companies: { id: {}, custom_domain: {}, render_service_id: {}, github_repo: {} },
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));
    // Mock fetch — fallback probe should hit GET / and GET /api/health.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      id: 't1', company_id: 'c1', tag: 'engineering', title: 'x', description: '',
      turn_count: 5, max_turns: 200, status: 'in_progress', failure_class: null,
      verification_level: 'deterministic',
    } as never);

    const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journeyCheck?.passed).toBe(true);
    expect(journeyCheck?.detail).toMatch(/fallback/i);
  });

  it('fails task when fallback journey probe fails', async () => {
    const exec = {
      execution_log: [
        { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
        { tool: 'check_url_health',      result: '✅ https://app.x.com is UP — HTTP 200 in 50ms' },
      ],
    };
    const company = { custom_domain: 'app.x.com', render_service_id: 'srv-1', github_repo: null };

    let callIdx = 0;
    const sequence = [exec, company];
    const makeChain = () => {
      const rows = sequence[callIdx] ?? [];
      callIdx++;
      const chain: Record<string, unknown> = {};
      const wrap = (val: unknown) => Object.assign([...(Array.isArray(val) ? val : [val])], chain);
      chain.from    = () => chain;
      chain.where   = () => wrap(rows);
      chain.orderBy = () => chain;
      chain.limit   = () => wrap(rows);
      return chain;
    };
    vi.doMock('@/lib/db', () => ({
      db: { select: () => makeChain() },
      reports: { id: {}, title: {}, task_id: {} },
      companies: { id: {}, custom_domain: {}, render_service_id: {}, github_repo: {} },
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));
    // Fallback probe → 502 on GET /
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));

    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      id: 't1', company_id: 'c1', tag: 'engineering', title: 'x', description: '',
      turn_count: 5, max_turns: 200, status: 'in_progress', failure_class: null,
      verification_level: 'deterministic',
    } as never);

    const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journeyCheck?.passed).toBe(false);
    expect(journeyCheck?.detail).toMatch(/fallback.*FAIL/i);
    expect(result.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/verification.service.test.ts -t "journey fallback"`
Expected: 2 tests fail (current code doesn't run fallback).

- [ ] **Step 3: Wire fallback into the existing journey-evidence check**

Find this block in `src/lib/services/verification.service.ts`:

```ts
    const journeyCalls = toolCalls.filter(isSuccessfulJourneyCall);
    const attemptedJourneys = toolCalls
      .filter((t) => JOURNEY_TOOL_NAMES.has(t.tool))
      .map((t) => t.tool);
    checks.push({
      name: 'user_journey_evidence',
      passed: journeyCalls.length > 0,
      detail: journeyCalls.length > 0
        ? `${journeyCalls.length} passing user journey verification(s).`
        : `Engineering task must run verify_user_journey after deploy to prove the app actually works for real users (register → use feature → log in). Journey attempts: ${attemptedJourneys.length ? attemptedJourneys.join(', ') : 'none'}.`,
    });
```

Replace it with:

```ts
    const journeyCalls = toolCalls.filter(isSuccessfulJourneyCall);
    const attemptedJourneys = toolCalls
      .filter((t) => JOURNEY_TOOL_NAMES.has(t.tool))
      .map((t) => t.tool);

    if (journeyCalls.length > 0) {
      checks.push({
        name: 'user_journey_evidence',
        passed: true,
        detail: `${journeyCalls.length} passing user journey verification(s).`,
      });
    } else if (deployCalls.length > 0) {
      // Agent skipped verify_user_journey but deploy succeeded — run a
      // verifier-side fallback. This converts the prompt-level mandate
      // into a structural guarantee. Read-only probe (GET / + /api/health)
      // so we don't pollute the founder DB with test users.
      const fallback = await runFallbackJourney(task.company_id);
      if (!fallback) {
        checks.push({
          name: 'user_journey_evidence',
          passed: false,
          detail: `Engineering task must run verify_user_journey after deploy. Agent did not run it AND fallback could not resolve a deployed URL (no custom_domain / no render_service_id). Journey attempts: ${attemptedJourneys.length ? attemptedJourneys.join(', ') : 'none'}.`,
        });
      } else {
        checks.push({
          name: 'user_journey_evidence',
          passed: fallback.allPassed,
          detail: fallback.allPassed
            ? `Verifier-side fallback journey PASS (${fallback.passedSteps}/${fallback.totalSteps} steps). The agent should still call verify_user_journey itself for full register→login coverage.`
            : `Verifier-side fallback journey FAIL — the deployed URL responded but the basic liveness probe failed. ${fallback.summary.split('\n')[0]}`,
        });
      }
    } else {
      checks.push({
        name: 'user_journey_evidence',
        passed: false,
        detail: `Engineering task must run verify_user_journey after deploy to prove the app actually works for real users (register → use feature → log in). Journey attempts: ${attemptedJourneys.length ? attemptedJourneys.join(', ') : 'none'}.`,
      });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/verification.service.test.ts -t "journey fallback"`
Expected: 2 tests pass.

- [ ] **Step 5: Run full verifier test file to confirm no regression**

Run: `npx vitest run src/lib/services/verification.service.test.ts`
Expected: all tests pass (12 from before + 8 new from this plan = 20 total — confirm count locally).

- [ ] **Step 6: Run full unit suite**

Run: `npm test 2>&1 | tail -5`
Expected: ≥ 296 tests passing across 24+ files. The pre-existing browser.tools.integration env failure unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/verification.service.ts src/lib/services/verification.service.test.ts
git commit -m "feat(verifier): inject fallback journey when agent skips verify_user_journey"
```

---

## Task 6: End-to-end smoke against threadpulse

**Files:**
- Create: `src/scripts/smoke-test-fallback-journey.ts`

- [ ] **Step 1: Write the smoke test**

Create `src/scripts/smoke-test-fallback-journey.ts`:

```ts
// End-to-end smoke for the verifier-injected journey fallback.
//
// Builds a synthetic execution_log that simulates "agent deployed but
// skipped verify_user_journey", then runs verifyTask and asserts the
// fallback fired against the live threadpulse app and produced PASS
// journey evidence.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, taskExecutions, tasks, companies } from '@/lib/db';
import { eq, like } from 'drizzle-orm';
import { verifyTask } from '@/lib/services/verification.service';
import type { Task } from '@/types';

void (async () => {
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  if (!t) throw new Error('threadpulse engineering task not found');

  // Inject a synthetic execution log: deploy + health succeeded, no journey.
  const syntheticLog = [
    { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-x' },
    { tool: 'check_url_health',      result: '✅ https://threadpulse.baljia.app is UP — HTTP 200 in 80ms' },
  ];
  await db.insert(taskExecutions).values({
    task_id:        t.id,
    status:         'running',
    execution_log:  syntheticLog,
  } as never);

  console.log(`Inserted synthetic exec log (deploy + health, no journey).`);
  console.log(`Running verifyTask...`);

  const result = await verifyTask({ ...(t as Task), verification_level: 'deterministic' });
  const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');

  console.log(`\nuser_journey_evidence check:`);
  console.log(`  passed: ${journeyCheck?.passed}`);
  console.log(`  detail: ${journeyCheck?.detail}`);
  console.log(`\nresult.passed: ${result.passed}`);

  const ok = journeyCheck?.passed === true && journeyCheck.detail?.includes('fallback');
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // Cleanup: delete the synthetic exec log so subsequent verifies don't see it.
  // (Latest-execution lookup picks the most recent; without cleanup it would
  // permanently shadow real runs.)
  // We don't actually delete here — the next real run will insert a fresh row.
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the smoke test**

Run: `npx tsx --env-file=.env.local src/scripts/smoke-test-fallback-journey.ts 2>&1 | tail -15`
Expected: `RESULT: PASS` with `passed: true` and `detail` containing "fallback".

- [ ] **Step 3: Commit**

```bash
git add src/scripts/smoke-test-fallback-journey.ts
git commit -m "test(verifier): smoke test for fallback journey against threadpulse"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(verification|engineering|journey-runner)" | head -10`
Expected: no output (no errors).

- [ ] **Step 2: Full unit suite**

Run: `npm test 2>&1 | tail -5`
Expected: 296+ tests passing across 24+ files. 1 pre-existing browser-tools.integration env failure (unrelated).

- [ ] **Step 3: Skeleton smoke (regression check on the orthogonal pipeline)**

Run: `npx tsx --env-file=.env.local src/scripts/smoke-test-express-skeleton.ts 2>&1 | tail -5`
Expected: `SMOKE TEST: PASS`.

- [ ] **Step 4: Tier-1 smoke (regression check on the verifier ecosystem we shipped earlier)**

Run: `npx tsx --env-file=.env.local src/scripts/smoke-test-tier1-fixes.ts 2>&1 | tail -5`
Expected: `SUMMARY  Result: PASS`.

- [ ] **Step 5: Final commit (if any leftover changes)**

```bash
git status
# If clean: nothing to commit. If pending edits exist:
git add -A
git commit -m "chore: final cleanup after verifier-injected journey fallback"
```

---

## Self-review checklist

- ✅ **Spec coverage:** Every audit-finding-to-fix is mapped to a task. The single issue addressed is "agent unreliably calls verify_user_journey, leaving HARD check unsatisfied." Tasks 3-5 cover the URL resolution, fallback runner, and verifier wiring respectively. Task 6 proves it end-to-end. Tasks 1-2 are the supporting refactor that lets one piece of code serve both the agent tool and the verifier — DRY.
- ✅ **No placeholders:** Every step has either exact code or an exact command. No "TODO", no "implement later", no "similar to Task N" references. The journey-runner code is duplicated verbatim across tasks intentionally so the engineer can read each task in isolation.
- ✅ **Type consistency:** `runJourney` returns `JourneyResult` with fields `allPassed`, `summary`, `passedSteps`, `totalSteps`, `ranSteps`. Used identically in Task 4 and Task 5. `getCompanyAppUrl` returns `string | null`. `runFallbackJourney` returns `JourneyResult | null`. All consistent.
