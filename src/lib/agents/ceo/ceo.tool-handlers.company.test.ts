// Unit tests for the 11 CEO company-context tool handlers.
// Routes through `handleToolCall` (the public switch dispatch in ceo.tools.ts)
// so the switch + handler pair is exercised end-to-end with mocked services.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be registered before any dynamic import of the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  // Mirror every named import from ceo.tool-handlers.ts so type/runtime imports resolve.
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
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/services/credit.service', () => ({
  getBalance: vi.fn(),
  getLedger: vi.fn(),
}));

vi.mock('@/lib/services/document.service', () => ({
  getDocuments: vi.fn(),
  getDocumentByType: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('@/lib/services/memory.service', () => ({
  getMemoryLayer: vi.fn(),
  searchLearnings: vi.fn(),
}));

vi.mock('@/lib/services/router.service', () => ({
  routeTask: vi.fn().mockReturnValue(29),
  routeTaskStrict: vi.fn().mockReturnValue(29),
  getKnownTaskTags: vi.fn().mockReturnValue(['feature', 'mvp', 'research']),
  getAgentName: vi.fn().mockReturnValue('Research'),
}));

// Tool-handlers `import * as` these — provide empty modules so resolution succeeds.
vi.mock('@/lib/services/task.service', () => ({}));
vi.mock('@/lib/services/task-draft.service', () => ({
  getPendingTaskDrafts: vi.fn().mockResolvedValue([]),
  getTaskDraft: vi.fn().mockResolvedValue(null),
  markTaskDraftFinalized: vi.fn(),
  discardTaskDraft: vi.fn(),
}));
vi.mock('@/lib/services/governance.service', () => ({}));
vi.mock('@/lib/services/failure.service', () => ({}));
vi.mock('@/lib/services/event.service', () => ({}));

// ---------------------------------------------------------------------------
// Helpers — build the chainable Drizzle select/insert/update mocks
// ---------------------------------------------------------------------------

interface SelectChain {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

/**
 * Build a chain that mimics Drizzle's fluent select API.
 * The terminal call (`limit` if used, otherwise `where`) resolves with the
 * provided rows. Whichever method we don't terminate on returns `this` so
 * other chain styles (where-only, orderBy-only) keep working.
 */
function mockSelectReturning<T>(rows: T[], terminal: 'limit' | 'where' = 'limit'): SelectChain {
  const chain: SelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  if (terminal === 'limit') {
    chain.limit.mockResolvedValue(rows as never);
  } else {
    // Some queries (e.g. get_links) end at `.where()` with no `.limit()`.
    chain.where.mockResolvedValue(rows as never);
  }
  return chain;
}

interface InsertChain {
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
}

function mockInsertChain(): InsertChain {
  const chain: InsertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined as never),
    returning: vi.fn().mockResolvedValue([] as never),
  };
  // values() is chainable: .values().onConflictDoUpdate() OR .values() awaited directly.
  // The handlers in scope only read the awaited-promise shape, so make values()
  // also resolve when awaited by exposing a then.
  (chain.values as unknown as { then: (cb: (v: unknown) => unknown) => unknown }).then = (cb) => cb(undefined);
  return chain;
}

interface UpdateChain {
  set: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
}

function mockUpdateChain(): UpdateChain {
  const chain: UpdateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined as never),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CEO tool handlers — company context (11 tools)', () => {
  let originalMetaToken: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalMetaToken = process.env.META_ADS_ACCESS_TOKEN;
  });

  afterEach(() => {
    if (originalMetaToken === undefined) {
      delete process.env.META_ADS_ACCESS_TOKEN;
    } else {
      process.env.META_ADS_ACCESS_TOKEN = originalMetaToken;
    }
    vi.unstubAllGlobals();
  });

  // ----- get_context ------------------------------------------------------
  describe('get_context', () => {
    it('renders company name, credits, and document fill state', async () => {
      const { db } = await import('@/lib/db');
      const creditService = await import('@/lib/services/credit.service');
      const documentService = await import('@/lib/services/document.service');

      // 1) companies query
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          {
            name: 'Acme Inc',
            slug: 'acme',
            one_liner: 'We do things',
            lifecycle: 'trial_active',
            plan_tier: 'trial',
            custom_domain: null,
            owner_id: 'user-1',
          },
        ]) as never,
      );
      // 2) subscriptions query
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          {
            status: 'trialing',
            plan_type: 'trial',
            night_shifts_remaining: 3,
            trial_ends_at: null,
          },
        ]) as never,
      );
      // 3) users (referral) query
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([{ referral_code: 'REF123' }]) as never,
      );

      vi.mocked(creditService.getBalance).mockResolvedValue(25);
      vi.mocked(documentService.getDocuments).mockResolvedValue([
        { doc_type: 'mission', is_empty: false } as never,
        { doc_type: 'product_overview', is_empty: false } as never,
        { doc_type: 'brand_voice', is_empty: true } as never,
      ]);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_context', {}, 'company-1');

      expect(result.content).toContain('Acme Inc');
      expect(result.content).toContain('25');
      expect(result.content).toContain('Documents filled');
      expect(result.content).toContain('Documents empty');
      expect(result.content).toContain('mission');
      expect(result.content).toContain('brand_voice');
      expect(result.content).toContain('trial');
    });

    it('returns "Company not found." when company query is empty', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(mockSelectReturning([]) as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_context', {}, 'nope');
      expect(result.content).toBe('Company not found.');
    });
  });

  // ----- query_reports ----------------------------------------------------
  describe('query_reports', () => {
    it('lists matching reports filtered by report_type', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          { id: 'r1', title: 'Market Landscape', report_type: 'research', created_at: new Date('2026-01-01') },
          { id: 'r2', title: 'Competitor Watch', report_type: 'research', created_at: new Date('2026-02-01') },
        ]) as never,
      );

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('query_reports', { report_type: 'research' }, 'company-1');

      expect(result.content).toContain('Market Landscape');
      expect(result.content).toContain('Competitor Watch');
      expect(result.content).toContain('research');
    });

    it('applies client-side substring search filter', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          { id: 'r1', title: 'Foo Report', report_type: 'research', created_at: new Date('2026-01-01') },
          { id: 'r2', title: 'Bar Report', report_type: 'research', created_at: new Date('2026-02-01') },
        ]) as never,
      );

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('query_reports', { search: 'foo' }, 'company-1');

      expect(result.content).toContain('Foo Report');
      expect(result.content).not.toContain('Bar Report');
    });

    it('returns "No reports found." when nothing matches', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(mockSelectReturning([]) as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('query_reports', {}, 'company-1');
      expect(result.content).toBe('No reports found.');
    });
  });

  // ----- get_document -----------------------------------------------------
  describe('get_document', () => {
    it('returns "is empty" message when document is empty', async () => {
      const documentService = await import('@/lib/services/document.service');
      vi.mocked(documentService.getDocumentByType).mockResolvedValue({
        id: 'doc-1',
        doc_type: 'mission',
        title: 'Mission',
        content: '',
        is_empty: true,
      } as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_document', { doc_type: 'mission' }, 'company-1');

      expect(result.content).toContain('is empty');
      expect(result.content).toContain('mission');
    });

    it('returns the document content when populated', async () => {
      const documentService = await import('@/lib/services/document.service');
      vi.mocked(documentService.getDocumentByType).mockResolvedValue({
        id: 'doc-1',
        doc_type: 'mission',
        title: 'Mission',
        content: 'We help founders ship.',
        is_empty: false,
      } as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_document', { doc_type: 'mission' }, 'company-1');

      expect(result.content).toContain('We help founders ship.');
      expect(result.content).toContain('Mission');
    });
  });

  // ----- update_document --------------------------------------------------
  describe('update_document', () => {
    it('updates an existing document and emits a document_updated action', async () => {
      const documentService = await import('@/lib/services/document.service');
      vi.mocked(documentService.getDocumentByType).mockResolvedValue({
        id: 'doc-1',
        doc_type: 'mission',
        title: 'Mission',
        content: 'old',
        is_empty: false,
      } as never);
      vi.mocked(documentService.updateDocument).mockResolvedValue({
        id: 'doc-1',
        doc_type: 'mission',
        content: 'new content',
      } as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'update_document',
        { doc_type: 'mission', content: 'new content' },
        'company-1',
      );

      expect(result.action?.type).toBe('document_updated');
      expect(result.action?.data).toMatchObject({ doc_type: 'mission' });
      expect(vi.mocked(documentService.updateDocument)).toHaveBeenCalledWith('doc-1', 'new content');
    });

    it('returns "not found" when the document does not exist', async () => {
      const documentService = await import('@/lib/services/document.service');
      vi.mocked(documentService.getDocumentByType).mockResolvedValue(null);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'update_document',
        { doc_type: 'unknown_doc', content: 'x' },
        'company-1',
      );

      expect(result.content).toContain('not found');
    });
  });

  // ----- get_emails -------------------------------------------------------
  describe('get_emails', () => {
    it('passes inbound direction filter into where clause and renders results', async () => {
      const { db } = await import('@/lib/db');
      const chain = mockSelectReturning([
        {
          id: 'e1',
          from_address: 'lead@example.com',
          to_address: 'hello@acme.com',
          subject: 'Question',
          direction: 'inbound',
          created_at: new Date('2026-04-01'),
        },
      ]);
      vi.mocked(db.select).mockReturnValueOnce(chain as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'get_emails',
        { direction: 'inbound', limit: 5 },
        'company-1',
      );

      expect(result.content).toContain('Recent Emails');
      expect(result.content).toContain('Question');
      // The handler must invoke .where with the inbound condition built in.
      expect(chain.where).toHaveBeenCalled();
    });

    it('returns "No emails found." when query yields none', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(mockSelectReturning([]) as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_emails', {}, 'company-1');
      expect(result.content).toBe('No emails found.');
    });
  });

  // ----- get_tweets -------------------------------------------------------
  describe('get_tweets', () => {
    it('renders recent tweets', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          {
            id: 't1',
            text: 'Launching today!',
            posted_at: new Date('2026-04-01'),
            tweet_id: '12345',
          },
        ]) as never,
      );

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_tweets', {}, 'company-1');
      expect(result.content).toContain('Recent Tweets');
      expect(result.content).toContain('Launching today!');
    });

    it('returns "No tweets posted yet." when none exist', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(mockSelectReturning([]) as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_tweets', {}, 'company-1');
      expect(result.content).toBe('No tweets posted yet.');
    });
  });

  // ----- get_links --------------------------------------------------------
  describe('get_links', () => {
    it('returns no-links message when empty', async () => {
      const { db } = await import('@/lib/db');
      // get_links has no .limit() — terminal is .where()
      vi.mocked(db.select).mockReturnValueOnce(mockSelectReturning([], 'where') as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_links', {}, 'company-1');
      expect(result.content).toContain('No dashboard links');
    });

    it('renders configured links as markdown bullets', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning(
          [
            { label: 'Landing Page', url: 'https://acme.baljia.app' },
            { label: 'Twitter', url: 'https://twitter.com/acme' },
          ],
          'where',
        ) as never,
      );

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('get_links', {}, 'company-1');

      expect(result.content).toContain('Landing Page');
      expect(result.content).toContain('https://acme.baljia.app');
      expect(result.content).toContain('Twitter');
    });
  });

  // ----- update_link ------------------------------------------------------
  describe('update_link', () => {
    it('upserts dashboard link and confirms with label + url', async () => {
      const { db } = await import('@/lib/db');
      const insertChain = mockInsertChain();
      vi.mocked(db.insert).mockReturnValueOnce(insertChain as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'update_link',
        { label: 'Landing Page', url: 'https://acme.baljia.app' },
        'company-1',
      );

      expect(result.content).toContain('Landing Page');
      expect(result.content).toContain('https://acme.baljia.app');
      expect(insertChain.values).toHaveBeenCalled();
      expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
    });
  });

  // ----- pause_ads --------------------------------------------------------
  describe('pause_ads', () => {
    it('returns no-token message when META_ADS_ACCESS_TOKEN is unset', async () => {
      delete process.env.META_ADS_ACCESS_TOKEN;

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('pause_ads', {}, 'company-1');

      expect(result.content).toContain('Meta Ads is not connected');
    });

    it('returns no-active-campaigns message when none active', async () => {
      process.env.META_ADS_ACCESS_TOKEN = 'fake-token';
      const { db } = await import('@/lib/db');
      // pause_ads ends at .where()
      vi.mocked(db.select).mockReturnValueOnce(mockSelectReturning([], 'where') as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('pause_ads', {}, 'company-1');

      expect(result.content).toContain('No active ad campaigns to pause');
    });

    it('pauses each active campaign and reports paused/total ratio', async () => {
      process.env.META_ADS_ACCESS_TOKEN = 'fake-token';
      const { db } = await import('@/lib/db');

      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning(
          [
            { id: 'c1', meta_campaign_id: 'mc1', external_id: null, name: 'meta' },
            { id: 'c2', meta_campaign_id: null, external_id: 'ext2', name: 'meta' },
          ],
          'where',
        ) as never,
      );
      // db.update() called once per pause loop iteration
      vi.mocked(db.update).mockReturnValue(mockUpdateChain() as never);

      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('pause_ads', {}, 'company-1');

      expect(result.content).toContain('2/2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // First call should hit the Meta Graph URL with mc1
      expect(fetchMock.mock.calls[0]?.[0]).toContain('graph.facebook.com');
      expect(fetchMock.mock.calls[0]?.[0]).toContain('mc1');
      expect(fetchMock.mock.calls[1]?.[0]).toContain('ext2');
    });
  });

  // ----- suggest_feature --------------------------------------------------
  describe('suggest_feature', () => {
    it('inserts feature feedback and confirms with the title', async () => {
      const { db } = await import('@/lib/db');
      const insertChain = mockInsertChain();
      vi.mocked(db.insert).mockReturnValueOnce(insertChain as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'suggest_feature',
        { title: 'Bulk task import', description: 'Upload a CSV of tasks at once.' },
        'company-1',
      );

      expect(result.content).toContain('Bulk task import');
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'feature', title: 'Bulk task import' }),
      );
    });
  });

  // ----- read_context_graph ----------------------------------------------
  describe('read_context_graph', () => {
    it('renders all four sections by default', async () => {
      const { db } = await import('@/lib/db');
      const creditService = await import('@/lib/services/credit.service');
      const memoryService = await import('@/lib/services/memory.service');

      vi.mocked(creditService.getBalance).mockResolvedValue(42);
      vi.mocked(creditService.getLedger).mockResolvedValue([
        { amount: -1, entry_type: 'task_charge', description: 'task' } as never,
        { amount: -1, entry_type: 'task_charge', description: 'task' } as never,
      ]);

      // Revenue: subscriptions select
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([{ status: 'trialing', plan_type: 'trial' }]) as never,
      );
      // Active work: active tasks
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          { id: 't1', title: 'Build landing', status: 'todo', tag: 'landing-page' },
        ]) as never,
      );
      // Active work: completed tasks
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          { id: 't2', title: 'Research market', completed_at: new Date('2026-04-01') },
        ]) as never,
      );
      // Support: emails
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([
          { id: 'e1', subject: 'Welcome', direction: 'outbound' },
        ]) as never,
      );

      vi.mocked(memoryService.getMemoryLayer).mockResolvedValue({
        content: 'Founder prefers concise updates.',
      } as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('read_context_graph', {}, 'company-1');

      expect(result.content).toContain('## Revenue');
      expect(result.content).toContain('## Active Work');
      expect(result.content).toContain('## Support');
      expect(result.content).toContain('## User Context');
      expect(result.content).toContain('42'); // credits
      expect(result.content).toContain('Build landing');
      expect(result.content).toContain('Welcome');
      expect(result.content).toContain('concise updates');
    });

    it('renders only requested subset when nodes filter is passed', async () => {
      const { db } = await import('@/lib/db');
      const creditService = await import('@/lib/services/credit.service');

      vi.mocked(creditService.getBalance).mockResolvedValue(7);
      vi.mocked(creditService.getLedger).mockResolvedValue([]);
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([{ status: 'active', plan_type: 'starter' }]) as never,
      );

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall(
        'read_context_graph',
        { nodes: ['revenue'] },
        'company-1',
      );

      expect(result.content).toContain('## Revenue');
      expect(result.content).not.toContain('## Active Work');
      expect(result.content).not.toContain('## Support');
      expect(result.content).not.toContain('## User Context');
    });

    it('isolates section failures — other sections still render with Unavailable', async () => {
      const { db } = await import('@/lib/db');
      const creditService = await import('@/lib/services/credit.service');
      const memoryService = await import('@/lib/services/memory.service');

      // Revenue is fine
      vi.mocked(creditService.getBalance).mockResolvedValue(10);
      vi.mocked(creditService.getLedger).mockResolvedValue([]);
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([{ status: 'active', plan_type: 'starter' }]) as never,
      );

      // Active work: force a rejection by making the first select throw on .from
      const failingChain = {
        from: vi.fn().mockImplementation(() => {
          throw new Error('boom');
        }),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      };
      vi.mocked(db.select).mockReturnValueOnce(failingChain as never);

      // Support: emails select succeeds (we still need a chain because the
      // active_work failure happens before recentDone; revenue + the failed
      // active select consumed two select() calls already)
      vi.mocked(db.select).mockReturnValueOnce(
        mockSelectReturning([{ id: 'e1', subject: 'Hi', direction: 'outbound' }]) as never,
      );

      vi.mocked(memoryService.getMemoryLayer).mockResolvedValue({
        content: 'prefs here',
      } as never);

      const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
      const result = await handleToolCall('read_context_graph', {}, 'company-1');

      expect(result.content).toContain('## Revenue');
      expect(result.content).toContain('## Active Work\nUnavailable');
      expect(result.content).toContain('## Support');
      expect(result.content).toContain('## User Context');
    });
  });
});
