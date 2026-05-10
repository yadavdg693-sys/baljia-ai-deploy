import { describe, expect, it, vi, beforeEach } from 'vitest';

// Default mock: no execution log for the task — used by unit-only tests like
// extractRequestedBrowserPaths. Per-test overrides below replace this for the
// deterministic-verifier scenarios.
const mockSelectChain = (rows: unknown[] = []) => {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows,
  };
  return chain;
};

vi.mock('@/lib/db', () => ({
  db: { select: () => mockSelectChain([]) },
  reports: {},
  companies: {},
  taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
}));

vi.mock('@/lib/services/task.service', () => ({}));
vi.mock('@/lib/services/event.service', () => ({}));

describe('verification requested path extraction', () => {
  it('extracts explicit app paths from task text', async () => {
    const { extractRequestedBrowserPaths } = await import('@/lib/services/verification.service');

    expect(extractRequestedBrowserPaths({
      title: 'Fix: ROI Calculator not visible on live site',
      description: 'The calculator route at /calculator returns 404 after deploy.',
    })).toEqual(['/calculator']);
  });

  it('keeps same-domain URLs and ignores external URLs', async () => {
    const { extractRequestedBrowserPaths } = await import('@/lib/services/verification.service');

    expect(extractRequestedBrowserPaths({
      title: 'Fix pricing route',
      description: 'Check https://acme.baljia.app/pricing and ignore https://docs.example.com/pricing.',
    }, 'acme.baljia.app')).toEqual(['/pricing']);
  });
});

describe('deterministic verifier — user_journey_evidence (new hard gate)', () => {
  // Builds a task + an execution_log array. Mocks the db.select chain to
  // return that log so verifyDeterministic sees the agent's tool calls.
  function setupTask(toolCalls: Array<{ tool: string; result: string }>) {
    const exec = { execution_log: toolCalls };
    return vi.doMock('@/lib/db', () => ({
      db: { select: () => mockSelectChain([exec]) },
      reports: {},
      companies: {},
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));
  }

  const baseTask = {
    id: 't-1', company_id: 'c-1', tag: 'engineering',
    title: 'Build it', description: 'desc',
    turn_count: 5, max_turns: 200,
    status: 'in_progress', failure_class: null,
  };

  it('FAILS when agent calls deploy + check_url_health but skips verify_user_journey', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const journey = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journey?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('PASSES when agent runs a successful verify_user_journey', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.\n  ...' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const journey = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journey?.passed).toBe(true);
  });

  it('FAILS when one of multiple check_url_health calls returned a 5xx (no longer accepts "any 2xx")', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com/ is UP — HTTP 200 in 50ms' },
      { tool: 'check_url_health',      result: '⚠️ https://x.com/api/health returned HTTP 500 in 50ms — app may have an error.' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "x" - all 3 steps passed.' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const health = result.checks.find((c) => c.name === 'render_health_evidence');
    expect(health?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('treats db_state_evidence as advisory — absent does NOT fail the task', async () => {
    vi.resetModules();
    setupTask([
      { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
      { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
      { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "register flow" - all 3 steps passed.' },
    ]);
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({ ...baseTask, verification_level: 'deterministic' } as never);
    const dbState = result.checks.find((c) => c.name === 'db_state_evidence');
    expect(dbState?.passed).toBe(false); // no DB-state call → check fails
    expect(result.passed).toBe(true);    // but task still passes (advisory)
  });
});

describe('Backend Quality Bar — repo hygiene checks (advisory)', () => {
  // Mocks db.select chain to return both an execution log AND a company row
  // with the github_repo set, then mocks global fetch to simulate the
  // GitHub Contents API response.
  function setupRepo(opts: {
    toolCalls: Array<{ tool: string; result: string }>;
    githubRepo: string | null;
    treeEntries: Array<{ path: string; type: 'blob' | 'tree'; size?: number }>;
  }) {
    const { toolCalls, githubRepo, treeEntries } = opts;
    const exec = { execution_log: toolCalls };
    const companyRow = { github_repo: githubRepo };

    let callIdx = 0;
    const sequence = [exec, companyRow]; // execs first, company second; reports/etc after → []
    const makeChain = () => {
      const rows = sequence[callIdx] ?? [];
      callIdx++;
      const chain: Record<string, unknown> = {};
      const wrap = (val: unknown) => {
        const arr = Array.isArray(val) ? val : [val];
        const thenable = Object.assign([...arr], chain);
        return thenable;
      };
      chain.from     = () => chain;
      chain.where    = () => wrap(rows);
      chain.orderBy  = () => chain;
      chain.limit    = () => wrap(rows);
      return chain;
    };

    vi.doMock('@/lib/db', () => ({
      db: { select: () => makeChain() },
      reports:        { id: {}, title: {}, task_id: {} },
      companies:      { id: {}, github_repo: {} },
      taskExecutions: { task_id: {}, created_at: {}, execution_log: {} },
    }));

    // Mock global fetch — GitHub Trees API (recursive=1 in one call).
    // Returns the tree on /git/trees/main, 404 elsewhere so the master fallback path is exercised when needed.
    const fetchMock = vi.fn(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes(`/repos/${githubRepo}/git/trees/main`)) {
        return { ok: true, json: async () => ({ tree: treeEntries }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('GITHUB_TOKEN', 'test-token');
  }

  const baseTask = {
    id: 't-1', company_id: 'c-1', tag: 'engineering',
    title: 'Build it', description: 'desc',
    turn_count: 5, max_turns: 200,
    status: 'in_progress', failure_class: null,
    verification_level: 'deterministic',
  };
  const passingCalls = [
    { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
    { tool: 'check_url_health',      result: '✅ https://x.com is UP — HTTP 200 in 50ms' },
    { tool: 'verify_user_journey',   result: 'JOURNEY PASS: "x" - all 3 steps passed.' },
  ];

  it('flags missing tests folder + missing README as failed (but advisory)', async () => {
    vi.resetModules();
    setupRepo({
      toolCalls: passingCalls,
      githubRepo: 'BALAJIapps/threadpulse',
      treeEntries: [
        { path: 'package.json', type: 'blob', size: 400 },
        { path: 'server.js',    type: 'blob', size: 30000 },
      ],
    });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask(baseTask as never);
    const tests  = result.checks.find((c) => c.name === 'tests_folder_present');
    const readme = result.checks.find((c) => c.name === 'readme_present');
    expect(tests?.passed).toBe(false);
    expect(readme?.passed).toBe(false);
    expect(result.passed).toBe(true); // advisory only
  });

  it('passes both checks when tests/ has files and README is >=200 bytes', async () => {
    vi.resetModules();
    setupRepo({
      toolCalls: passingCalls,
      githubRepo: 'BALAJIapps/threadpulse',
      treeEntries: [
        { path: 'package.json',          type: 'blob', size: 400 },
        { path: 'server.js',             type: 'blob', size: 30000 },
        { path: 'README.md',             type: 'blob', size: 800 },
        { path: 'tests',                 type: 'tree' },
        { path: 'tests/auth.test.js',    type: 'blob', size: 1200 },
        { path: 'tests/health.test.js',  type: 'blob', size: 800 },
      ],
    });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask(baseTask as never);
    const tests  = result.checks.find((c) => c.name === 'tests_folder_present');
    const readme = result.checks.find((c) => c.name === 'readme_present');
    expect(tests?.passed).toBe(true);
    expect(readme?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('skips repo hygiene checks silently when repo unreachable (no github_repo)', async () => {
    vi.resetModules();
    setupRepo({
      toolCalls: passingCalls,
      githubRepo: null,
      treeEntries: [],
    });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask(baseTask as never);
    const tests  = result.checks.find((c) => c.name === 'tests_folder_present');
    const readme = result.checks.find((c) => c.name === 'readme_present');
    expect(tests).toBeUndefined();   // not added when repo unreachable
    expect(readme).toBeUndefined();
    expect(result.passed).toBe(true);
  });
});

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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } })));
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

describe('verifyDeterministic — journey fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  function setupForFallback(opts: { fetchStatus: number }) {
    const exec = {
      execution_log: [
        { tool: 'render_create_service', result: 'Render service created!\nService ID: srv-1' },
        { tool: 'check_url_health',      result: '✅ https://app.x.com is UP — HTTP 200 in 50ms' },
      ],
    };
    const company = { custom_domain: 'app.x.com', render_service_id: 'srv-1', github_repo: null };

    let callIdx = 0;
    const sequence: unknown[] = [exec, company, company]; // 1: exec_log, 2: companies for repo hygiene, 3: companies for getCompanyAppUrl
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: opts.fetchStatus })));
  }

  it('FAILS task when agent skipped verify_user_journey, even if fallback liveness probe passes (mandatory call enforcement)', async () => {
    setupForFallback({ fetchStatus: 200 });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      id: 't1', company_id: 'c1', tag: 'engineering', title: 'x', description: '',
      turn_count: 5, max_turns: 200, status: 'in_progress', failure_class: null,
      verification_level: 'deterministic',
    } as never);
    const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');
    // Fallback is diagnostic only — agent skipping is a hard fail regardless
    expect(journeyCheck?.passed).toBe(false);
    expect(journeyCheck?.detail).toMatch(/agent skipped/i);
    expect(journeyCheck?.detail).toMatch(/fallback liveness probe PASSED/);
    expect(result.passed).toBe(false);
  });

  it('FAILS task when fallback journey probe fails (and agent skipped journey)', async () => {
    setupForFallback({ fetchStatus: 502 });
    const { verifyTask } = await import('@/lib/services/verification.service');
    const result = await verifyTask({
      id: 't1', company_id: 'c1', tag: 'engineering', title: 'x', description: '',
      turn_count: 5, max_turns: 200, status: 'in_progress', failure_class: null,
      verification_level: 'deterministic',
    } as never);
    const journeyCheck = result.checks.find((c) => c.name === 'user_journey_evidence');
    expect(journeyCheck?.passed).toBe(false);
    expect(journeyCheck?.detail).toMatch(/agent skipped/i);
    expect(journeyCheck?.detail).toMatch(/fallback liveness probe FAILED/);
    expect(result.passed).toBe(false);
  });
});
