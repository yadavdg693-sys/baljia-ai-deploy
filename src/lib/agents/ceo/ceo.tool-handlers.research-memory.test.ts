// Vitest unit tests for the research/memory/platform/credit-balance CEO tool handlers
// + a routing meta-test that confirms every tool name in CEO_TOOLS has a real
// handler case (no fall-through to the default "is not available yet" branch).
//
// Mocking pattern follows src/lib/services/credit.service.test.ts:
// - All Drizzle tables mocked as empty objects
// - db.select/insert/update return chainable thenables that resolve []
// - Services that the handler module imports at top-level are mocked so
//   side-effects (DB hits, Redis, network) never escape the test process.
// - Dynamic imports (`@/lib/tavily`, `@/lib/agents/worker-launcher`) are also
//   pre-mocked so the lazy `await import(...)` inside handlers resolves to
//   our stubs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── DB mock ────────────────────────────────────────────────────────────────
// Chainable query builder that resolves to []. Each call to db.select()
// returns a fresh chain so per-handler `where(...).limit(1)` chains work.
function makeChain(resolveValue: unknown = []) {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  const terminal = () => Promise.resolve(resolveValue);
  chain.from = passthrough;
  chain.where = passthrough;
  chain.orderBy = passthrough;
  chain.set = passthrough;
  chain.values = vi.fn(() => Promise.resolve(undefined));
  chain.returning = vi.fn(() => Promise.resolve([{ id: 'fake-id', title: 'fake' }]));
  chain.onConflictDoUpdate = vi.fn(() => Promise.resolve(undefined));
  // limit() is the most common terminal — make it resolve.
  chain.limit = vi.fn(terminal);
  // Make the chain itself thenable so `await db.select().from(x).where(y)` works.
  (chain as { then?: unknown }).then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise.resolve(resolveValue).then(onFulfilled, onRejected);
  return chain;
}

vi.mock('@/lib/db', () => {
  const insertChain = {
    values: vi.fn(() => Promise.resolve(undefined)),
    returning: vi.fn(() => Promise.resolve([{ id: 'fake-id', title: 'fake' }])),
    onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
  };
  // Make insertChain.values return the chain itself so .returning()/.onConflictDoUpdate() chain
  insertChain.values = vi.fn(() => insertChain) as unknown as typeof insertChain.values;

  return {
    db: {
      select: vi.fn(() => makeChain([])),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => makeChain([])),
      delete: vi.fn(() => makeChain([])),
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
    },
    tasks: {},
    taskExecutions: {},
    recurringTasks: {},
    companies: {},
    reports: {},
    emailThreads: {},
    tweets: {},
    dashboardLinks: {},
    adCampaigns: {},
    platformFeedback: {},
    platformEvents: {},
    users: {},
    subscriptions: {},
    creditLedger: {},
    memoryLayers: {},
    learnings: {},
    failureFingerprints: {},
  };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ── Tavily mock (covers both eager and dynamic imports) ────────────────────
vi.mock('@/lib/tavily', () => ({
  isTavilyAvailable: vi.fn().mockReturnValue(true),
  tavilySearch: vi.fn(),
  getNextTavilyKey: vi.fn().mockReturnValue('test-key'),
}));

// ── Service mocks ─────────────────────────────────────────────────────────
vi.mock('@/lib/services/memory.service', () => ({
  searchLearnings: vi.fn(),
  getMemoryLayer: vi.fn(),
}));

vi.mock('@/lib/services/credit.service', () => ({
  getBalance: vi.fn(),
  getLedger: vi.fn(),
}));

vi.mock('@/lib/services/router.service', () => ({
  routeTask: vi.fn().mockReturnValue(29),
  getAgentName: vi.fn().mockReturnValue('Research'),
  getCreditCostForTask: vi.fn().mockReturnValue(1),
}));

vi.mock('@/lib/services/task.service', () => ({
  getTasks: vi.fn().mockResolvedValue([]),
  getTask: vi.fn().mockResolvedValue(null),
  createTask: vi.fn().mockResolvedValue({
    id: 'task-1', title: 'Test', description: 'desc', tag: 'research',
  }),
  updateTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/document.service', () => ({
  getDocuments: vi.fn().mockResolvedValue([]),
  getDocumentByType: vi.fn().mockResolvedValue(null),
  updateDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/governance.service', () => ({
  evaluateTask: vi.fn().mockResolvedValue({
    can_execute: true,
    execution_mode: 'full_agent',
    verification_level: 'none',
  }),
}));

vi.mock('@/lib/services/failure.service', () => ({
  getKnownIssuesForTag: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/services/event.service', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/agents/worker-launcher', () => ({
  launchTask: vi.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe('CEO tool handlers — research / memory / platform / credit-balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── web_search ──────────────────────────────────────────────────────────
  describe('web_search', () => {
    it('returns "Web search unavailable" when no Tavily keys are configured', async () => {
      const tavily = await import('@/lib/tavily');
      vi.mocked(tavily.isTavilyAvailable).mockReturnValue(false);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('web_search', { query: 'anything' }, 'company-1');

      expect(result.content).toContain('Web search unavailable');
      expect(tavily.tavilySearch).not.toHaveBeenCalled();
    });

    it('formats answer + sources from a successful Tavily response', async () => {
      const tavily = await import('@/lib/tavily');
      vi.mocked(tavily.isTavilyAvailable).mockReturnValue(true);
      vi.mocked(tavily.tavilySearch).mockResolvedValue({
        answer: 'Foo summary',
        results: [
          { title: 'A', url: 'https://a.com', content: 'a content here' },
          { title: 'B', url: 'https://b.com', content: 'b content here' },
        ],
      });

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('web_search', { query: 'test' }, 'company-1');

      expect(result.content).toContain('Foo summary');
      expect(result.content).toContain('https://a.com');
      expect(result.content).toContain('a content here');
    });

    it('falls back gracefully when tavilySearch throws', async () => {
      const tavily = await import('@/lib/tavily');
      vi.mocked(tavily.isTavilyAvailable).mockReturnValue(true);
      vi.mocked(tavily.tavilySearch).mockRejectedValue(new Error('boom'));

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('web_search', { query: 'test' }, 'company-1');

      expect(result.content).toContain('Web search failed');
      expect(result.content).toContain('boom');
    });
  });

  // ── web_extract ─────────────────────────────────────────────────────────
  describe('web_extract', () => {
    it('returns "Content extraction unavailable" when Tavily is not configured', async () => {
      const tavily = await import('@/lib/tavily');
      vi.mocked(tavily.isTavilyAvailable).mockReturnValue(false);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('web_extract', { url: 'https://x.com' }, 'company-1');

      expect(result.content).toContain('Content extraction unavailable');
    });

    it('returns extracted raw_content from a successful fetch', async () => {
      const tavily = await import('@/lib/tavily');
      vi.mocked(tavily.isTavilyAvailable).mockReturnValue(true);
      vi.mocked(tavily.getNextTavilyKey).mockReturnValue('test-key');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ raw_content: 'extracted text here from page' }],
        }),
      }));

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('web_extract', { url: 'https://x.com' }, 'company-1');

      expect(result.content).toContain('extracted text');
    });

    it('returns failure message when fetch returns non-OK status', async () => {
      const tavily = await import('@/lib/tavily');
      vi.mocked(tavily.isTavilyAvailable).mockReturnValue(true);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }));

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('web_extract', { url: 'https://broken.com' }, 'company-1');

      expect(result.content).toContain('Failed to extract');
    });
  });

  // ── search_memory ───────────────────────────────────────────────────────
  describe('search_memory', () => {
    it('returns "No memory found" when searchLearnings returns []', async () => {
      const memory = await import('@/lib/services/memory.service');
      vi.mocked(memory.searchLearnings).mockResolvedValue([]);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('search_memory', { query: 'pricing' }, 'company-1');

      expect(result.content).toContain('No memory found');
      expect(result.content).toContain('pricing');
    });

    it('formats matches when searchLearnings returns hits', async () => {
      const memory = await import('@/lib/services/memory.service');
      // Cast — we only care about category + content fields the handler reads.
      vi.mocked(memory.searchLearnings).mockResolvedValue([
        { category: 'pricing', content: 'Founders prefer flat fees' },
        { category: 'tone', content: 'Wry and direct' },
      ] as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('search_memory', { query: 'pricing' }, 'company-1');

      expect(result.content).toContain('Found 2 related memories');
      expect(result.content).toContain('[pricing]');
      expect(result.content).toContain('Founders prefer flat fees');
      expect(result.content).toContain('[tone]');
      expect(result.content).toContain('Wry and direct');
    });
  });

  // ── read_memory ─────────────────────────────────────────────────────────
  describe('read_memory', () => {
    it('refuses layer 3 with platform-internal message and never calls getMemoryLayer', async () => {
      const memory = await import('@/lib/services/memory.service');

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('read_memory', { layer: '3' }, 'company-1');

      expect(result.content).toContain('platform-internal');
      expect(memory.getMemoryLayer).not.toHaveBeenCalled();
    });

    it('returns layer 1 content with the layer name', async () => {
      const memory = await import('@/lib/services/memory.service');
      vi.mocked(memory.getMemoryLayer).mockResolvedValue({
        content: 'domain knowledge content here',
      } as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('read_memory', { layer: '1' }, 'company-1');

      expect(memory.getMemoryLayer).toHaveBeenCalledWith('company-1', 1);
      expect(result.content).toContain('domain_knowledge');
      expect(result.content).toContain('domain knowledge content here');
    });

    it('truncates layer 2 content over 3000 chars and appends [...truncated]', async () => {
      const memory = await import('@/lib/services/memory.service');
      vi.mocked(memory.getMemoryLayer).mockResolvedValue({
        content: 'a'.repeat(5000),
      } as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('read_memory', { layer: '2' }, 'company-1');

      expect(result.content).toContain('user_preferences');
      expect(result.content).toContain('[...truncated]');
    });

    it('reports empty layer when memory has no content', async () => {
      const memory = await import('@/lib/services/memory.service');
      vi.mocked(memory.getMemoryLayer).mockResolvedValue(null);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('read_memory', { layer: '1' }, 'company-1');

      expect(result.content).toContain('empty');
    });
  });

  // ── report_platform_bug ─────────────────────────────────────────────────
  describe('report_platform_bug', () => {
    it('inserts a bug-type platformFeedback row with the supplied severity', async () => {
      const dbModule = await import('@/lib/db');
      const insertSpy = vi.mocked(dbModule.db.insert);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'report_platform_bug',
        { title: 'Login crashes', description: 'Click button → 500', severity: 'high' },
        'company-1',
      );

      expect(insertSpy).toHaveBeenCalled();
      const insertChain = insertSpy.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> };
      expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
        type: 'bug',
        title: 'Login crashes',
        description: 'Click button → 500',
        severity: 'high',
        company_id: 'company-1',
      }));
      expect(result.content).toContain('Login crashes');
      expect(result.content).toContain('high');
    });

    it('defaults severity to "medium" when omitted', async () => {
      const dbModule = await import('@/lib/db');
      const insertSpy = vi.mocked(dbModule.db.insert);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'report_platform_bug',
        { title: 'Minor glitch', description: 'sometimes flickers' },
        'company-1',
      );

      const insertChain = insertSpy.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> };
      expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
        type: 'bug',
        severity: 'medium',
      }));
      expect(result.content).toContain('medium');
    });
  });

  // ── get_credit_balance ──────────────────────────────────────────────────
  describe('get_credit_balance', () => {
    it('returns balance, recent activity, and a credit_quote action', async () => {
      const credit = await import('@/lib/services/credit.service');
      vi.mocked(credit.getBalance).mockResolvedValue(17);
      vi.mocked(credit.getLedger).mockResolvedValue([
        {
          id: 'l1', amount: -1, entry_type: 'task_deduction', description: 'Task: research',
          created_at: new Date('2026-04-20T10:00:00Z'),
        },
        {
          id: 'l2', amount: 10, entry_type: 'addon_purchase', description: 'Top-up',
          created_at: new Date('2026-04-19T08:00:00Z'),
        },
      ] as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_credit_balance', {}, 'company-1');

      expect(result.content).toContain('17 credits');
      expect(result.content).toContain('Recent activity');
      expect(result.content).toContain('Task: research');
      expect(result.content).toContain('+10');
      expect(result.action).toBeDefined();
      expect(result.action?.type).toBe('credit_quote');
      expect((result.action as { data: { balance: number } }).data.balance).toBe(17);
    });

    it('omits Recent activity section when ledger is empty', async () => {
      const credit = await import('@/lib/services/credit.service');
      vi.mocked(credit.getBalance).mockResolvedValue(0);
      vi.mocked(credit.getLedger).mockResolvedValue([]);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_credit_balance', {}, 'company-1');

      expect(result.content).toContain('0 credits');
      expect(result.content).not.toContain('Recent activity');
      expect(result.action?.type).toBe('credit_quote');
    });
  });

  // ── Routing meta-test ───────────────────────────────────────────────────
  // Ensures every tool exported in CEO_TOOLS has a real handler case.
  // If a tool name is added to ceo.tool-defs.ts but not wired into the
  // switch in ceo.tool-handlers.ts, this test fails — catching dispatch drift.
  describe('routing meta-test', () => {
    // Minimal valid inputs per tool, so handlers don't crash on missing fields
    // before they ever check the switch. Anything that's still missing falls
    // back to {} — most handlers swallow exceptions and return a string anyway.
    const inputFor: Record<string, Record<string, unknown>> = {
      get_module_capabilities: { module_name: 'engineering' },
      get_agent_capabilities: { agent_id: 'engineering' },
      find_agent_for_task: { task_description: 'build a thing', tag: 'engineering' },
      create_task: { title: 'T', description: 'D', tag: 'research' },
      reject_task: { task_id: '00000000-0000-0000-0000-000000000001' },
      get_task_details: { task_id: '00000000-0000-0000-0000-000000000001' },
      edit_task: { task_id: '00000000-0000-0000-0000-000000000001', title: 'New' },
      get_task_run_link: { task_id: '00000000-0000-0000-0000-000000000001' },
      get_task_execution_status: { task_id: '00000000-0000-0000-0000-000000000001' },
      approve_task: { task_id: '00000000-0000-0000-0000-000000000001' },
      get_task_execution_logs: { task_id: '00000000-0000-0000-0000-000000000001' },
      find_best_agent: { query: 'build a landing page' },
      reorder_task: { task_id: '00000000-0000-0000-0000-000000000001', position: 1 },
      move_task_to_top: { task_id: '00000000-0000-0000-0000-000000000001' },
      create_recurring_task: { title: 'T', description: 'D', tag: 'r', cadence: 'weekly' },
      update_recurring_task: { recurring_id: '00000000-0000-0000-0000-000000000001', paused: true },
      delete_recurring_task: { recurring_id: '00000000-0000-0000-0000-000000000001' },
      query_reports: {},
      get_document: { doc_type: 'mission' },
      update_document: { doc_type: 'mission', content: '# Hello' },
      get_emails: {},
      get_tweets: {},
      update_link: { label: 'Site', url: 'https://example.com' },
      suggest_feature: { title: 'Cool', description: 'Pls' },
      read_context_graph: { nodes: ['revenue'] },
      web_search: { query: 'q' },
      web_extract: { url: 'https://example.com' },
      report_platform_bug: { title: 'Bug', description: 'Repro' },
      search_memory: { query: 'q' },
      read_memory: { layer: '1' }, // 1, not 3 — we want a normal happy path here
    };

    it('every tool in CEO_TOOLS has a handler (no default-branch fall-through)', async () => {
      // Re-import after mocks are hot. Reset critical mocks to "safe defaults"
      // so tools that DO call services don't crash.
      const tavily = await import('@/lib/tavily');
      vi.mocked(tavily.isTavilyAvailable).mockReturnValue(false); // skip network
      const memory = await import('@/lib/services/memory.service');
      vi.mocked(memory.searchLearnings).mockResolvedValue([]);
      vi.mocked(memory.getMemoryLayer).mockResolvedValue(null);
      const credit = await import('@/lib/services/credit.service');
      vi.mocked(credit.getBalance).mockResolvedValue(0);
      vi.mocked(credit.getLedger).mockResolvedValue([]);

      const { CEO_TOOLS, handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');

      // Sanity: we expect 38 entries (37 base + 1 extra). Don't hard-code in
      // case future tools are added — just verify it's > 30 so we know we're
      // exercising the full surface, not an empty array.
      expect(CEO_TOOLS.length).toBeGreaterThan(30);

      for (const tool of CEO_TOOLS) {
        const input = inputFor[tool.name] ?? {};
        const result = await handleToolCall(tool.name, input, 'company-1');

        // Core invariant: every tool must produce a string `content` field.
        expect(typeof result.content, `Tool ${tool.name} did not return string content`).toBe('string');
        // The default branch returns "Tool ... is not available yet."
        // If we see that text, a tool name is exported but unwired.
        expect(
          result.content,
          `Tool ${tool.name} fell through to default branch (missing case in switch)`,
        ).not.toContain('is not available yet');
      }
    });
  });
});
