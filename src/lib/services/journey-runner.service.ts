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
  summary: string;
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
