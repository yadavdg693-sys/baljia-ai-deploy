// Vitest unit tests for the CEO agent's capability + recurring-task tool
// handlers. Routes through the public `handleToolCall` switch so we exercise
// dispatch, not just internal helpers. All DB and service interactions are
// mocked — no real Drizzle, no real Neon, no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock chains ─────────────────────────────────────────────────────────
// Each chain is reset in beforeEach (vi.clearAllMocks). The default `where`
// terminal resolves to `[]` / `undefined` so handlers don't crash; individual
// tests override with mockResolvedValueOnce when they need specific data.

const insertChain = {
  values: vi.fn(),
  returning: vi.fn(),
};
const updateChain = {
  set: vi.fn(),
  where: vi.fn(),
};
const deleteChain = {
  where: vi.fn(),
};
const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
};

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => selectChain),
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
    delete: vi.fn(() => deleteChain),
    execute: vi.fn(),
  },
  // Tables imported by ceo.tool-handlers.ts — mirror them here so the import
  // shape matches. Concrete shape is irrelevant; we never read these.
  recurringTasks: { id: 'recurringTasks.id', company_id: 'recurringTasks.company_id' },
  tasks: {},
  taskExecutions: {},
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

// Mock drizzle-orm helpers so the tests can inspect what was passed to where()
// without dragging in real query-builder internals. eq/and become identifiable
// tag objects we can inspect downstream.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ __op: 'and', conds })),
  desc: vi.fn((col: unknown) => ({ __op: 'desc', col })),
  ilike: vi.fn((col: unknown, val: unknown) => ({ __op: 'ilike', col, val })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    __op: 'sql',
    strings,
    values,
  })),
}));

vi.mock('@/lib/services/router.service', () => ({
  routeTask: vi.fn().mockReturnValue(30),
  getAgentName: vi.fn().mockReturnValue('Engineering'),
}));

// Other services used by ceo.tool-handlers.ts but NOT exercised in this file.
// We still mock them so the module loads without trying to open real DB
// connections, hit Tavily, etc.
vi.mock('@/lib/services/task.service', () => ({
  getTasks: vi.fn(),
  createTask: vi.fn(),
  getTask: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock('@/lib/services/credit.service', () => ({
  getBalance: vi.fn(),
  getLedger: vi.fn(),
}));
vi.mock('@/lib/services/memory.service', () => ({
  getMemoryLayer: vi.fn(),
  searchLearnings: vi.fn(),
}));
vi.mock('@/lib/services/document.service', () => ({
  getDocuments: vi.fn(),
  getDocumentByType: vi.fn(),
  updateDocument: vi.fn(),
}));
vi.mock('@/lib/services/governance.service', () => ({
  evaluateTask: vi.fn(),
}));
vi.mock('@/lib/services/failure.service', () => ({
  getKnownIssuesForTag: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/services/event.service', () => ({
  emit: vi.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function resetChains() {
  // Reset terminal default behaviors after vi.clearAllMocks wipes them.
  insertChain.values.mockReturnValue(insertChain);
  insertChain.returning.mockResolvedValue([]);
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);
  deleteChain.where.mockResolvedValue(undefined);
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockResolvedValue([]);
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

// ── Capability handler tests ───────────────────────────────────────────────

describe('CEO tool handlers — capabilities (6 tools)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('list_available_modules returns the 8-agent registry with names and IDs', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('list_available_modules', {}, COMPANY_ID);

    expect(result.content).toContain('Available Modules');
    // A sampling of the 8 agents
    expect(result.content).toContain('Engineering');
    expect(result.content).toContain('Browser');
    expect(result.content).toContain('Research');
    expect(result.content).toContain('Cold Outreach');
    // Agent IDs surfaced as "Agent #<id>"
    expect(result.content).toContain('Agent #30');
    expect(result.content).toContain('Agent #42');
    // Closing line mentions CEO + onboarding
    expect(result.content).toContain('CEO/Chat');
  });

  it('get_module_capabilities returns detail block for a known module (engineering)', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_module_capabilities',
      { module_name: 'engineering' },
      COMPANY_ID,
    );

    expect(result.content).toContain('Engineering Agent (#30)');
    expect(result.content).toContain('Can do');
    expect(result.content).toContain('Cannot do');
    // Sampling tools listed for Engineering
    expect(result.content).toContain('github_create_repo');
    expect(result.content).toContain('stripe_create_product');
  });

  it('get_module_capabilities accepts numeric ID as module_name', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    // "29" should resolve to Research
    const result = await handleToolCall(
      'get_module_capabilities',
      { module_name: '29' },
      COMPANY_ID,
    );
    expect(result.content).toContain('Research Agent (#29)');
    expect(result.content).toContain('Web search (Tavily)');
  });

  it('get_module_capabilities returns "not found" for unknown module', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_module_capabilities',
      { module_name: 'nonexistent_agent' },
      COMPANY_ID,
    );
    expect(result.content).toContain('not found');
    expect(result.content).toContain('list_available_modules');
  });

  it('list_mcp_servers returns the integration registry with key vendors', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('list_mcp_servers', {}, COMPANY_ID);

    expect(result.content).toContain('Connected Integrations');
    expect(result.content).toContain('Browserbase');
    expect(result.content).toContain('Tavily');
    expect(result.content).toContain('Hunter.io');
    expect(result.content).toContain('Cloudflare R2');
    expect(result.content).toContain('Postmark');
  });

  it('list_available_agents returns a markdown table with all 8 agents', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('list_available_agents', {}, COMPANY_ID);

    expect(result.content).toContain('Worker Agents');
    expect(result.content).toContain('| ID | Name | Role | Max Turns |');
    expect(result.content).toContain('| 30 | Engineering');
    expect(result.content).toContain('| 41 | Meta Ads');
    expect(result.content).toContain('| 54 | Cold Outreach');
  });

  it('get_agent_capabilities is an alias for get_module_capabilities (takes agent_id)', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_agent_capabilities',
      { agent_id: 'browser' },
      COMPANY_ID,
    );
    expect(result.content).toContain('Browser Agent (#42)');
    expect(result.content).toContain('Navigate websites');
    expect(result.content).toContain('browser_navigate');
  });

  it('find_agent_for_task uses routeTask + getAgentName and surfaces the recommendation', async () => {
    const router = await import('@/lib/services/router.service');
    vi.mocked(router.routeTask).mockReturnValueOnce(30);
    vi.mocked(router.getAgentName).mockReturnValueOnce('Engineering');

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'find_agent_for_task',
      { task_description: 'build a landing page', tag: 'landing-page' },
      COMPANY_ID,
    );

    expect(router.routeTask).toHaveBeenCalledWith('landing-page');
    expect(result.content).toContain('Recommended: Engineering');
    expect(result.content).toContain('Agent #30');
    expect(result.content).toContain('landing-page');
  });

  it('find_agent_for_task falls back to task_description when tag is empty', async () => {
    const router = await import('@/lib/services/router.service');
    vi.mocked(router.routeTask).mockReturnValueOnce(29);
    vi.mocked(router.getAgentName).mockReturnValueOnce('Research');

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'find_agent_for_task',
      { task_description: 'competitor research' },
      COMPANY_ID,
    );

    // No tag passed → handler should route off the description
    expect(router.routeTask).toHaveBeenCalledWith('competitor research');
    expect(result.content).toContain('Recommended: Research');
    expect(result.content).toContain('Agent #29');
    expect(result.content).toContain('auto-detected');
  });
});

// ── Recurring task handler tests ───────────────────────────────────────────

describe('CEO tool handlers — recurring tasks (4 tools)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('get_recurring_tasks returns the empty-state message when none exist', async () => {
    selectChain.where.mockResolvedValueOnce([]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_recurring_tasks', {}, COMPANY_ID);

    expect(result.content).toBe('No recurring tasks set up yet.');
  });

  it('get_recurring_tasks lists tasks with cadence and active/paused state', async () => {
    selectChain.where.mockResolvedValueOnce([
      {
        id: 'r1', title: 'Daily standup digest', cadence: 'daily',
        is_active: true, monthly_credits_estimate: 30,
      },
      {
        id: 'r2', title: 'Weekly metrics roll-up', cadence: 'weekly',
        is_active: false, monthly_credits_estimate: 4,
      },
    ]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_recurring_tasks', {}, COMPANY_ID);

    expect(result.content).toContain('Recurring Tasks');
    expect(result.content).toContain('Daily standup digest');
    expect(result.content).toContain('daily');
    expect(result.content).toContain('Weekly metrics roll-up');
    expect(result.content).toContain('weekly');
    // Cadence-derived monthly estimates surfaced
    expect(result.content).toContain('30');
    expect(result.content).toContain('4');
  });

  it('create_recurring_task computes monthly_credits_estimate=30 for daily cadence', async () => {
    insertChain.returning.mockResolvedValueOnce([
      { id: 'r-new', title: 'Daily report', cadence: 'daily' },
    ]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_recurring_task',
      {
        title: 'Daily report',
        description: 'Send daily KPI digest',
        tag: 'reporting',
        cadence: 'daily',
      },
      COMPANY_ID,
    );

    // values() should have received the daily=30 monthly estimate
    const valuesArg = insertChain.values.mock.calls[0]?.[0];
    expect(valuesArg).toMatchObject({
      company_id: COMPANY_ID,
      title: 'Daily report',
      cadence: 'daily',
      monthly_credits_estimate: 30,
    });
    expect(result.content).toContain('Daily report');
    expect(result.content).toContain('30 credits/month');
  });

  it('create_recurring_task computes monthly_credits_estimate=4 for weekly', async () => {
    insertChain.returning.mockResolvedValueOnce([
      { id: 'r-w', title: 'Weekly metrics', cadence: 'weekly' },
    ]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    await handleToolCall(
      'create_recurring_task',
      { title: 'Weekly metrics', description: 'd', tag: 'data', cadence: 'weekly' },
      COMPANY_ID,
    );

    const valuesArg = insertChain.values.mock.calls[0]?.[0];
    expect(valuesArg?.monthly_credits_estimate).toBe(4);
  });

  it('create_recurring_task computes monthly_credits_estimate=2 for biweekly', async () => {
    insertChain.returning.mockResolvedValueOnce([
      { id: 'r-bw', title: 'Biweekly digest', cadence: 'biweekly' },
    ]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    await handleToolCall(
      'create_recurring_task',
      { title: 'Biweekly digest', description: 'd', tag: 'data', cadence: 'biweekly' },
      COMPANY_ID,
    );

    const valuesArg = insertChain.values.mock.calls[0]?.[0];
    expect(valuesArg?.monthly_credits_estimate).toBe(2);
  });

  it('create_recurring_task computes monthly_credits_estimate=1 for monthly', async () => {
    insertChain.returning.mockResolvedValueOnce([
      { id: 'r-m', title: 'Monthly review', cadence: 'monthly' },
    ]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    await handleToolCall(
      'create_recurring_task',
      { title: 'Monthly review', description: 'd', tag: 'data', cadence: 'monthly' },
      COMPANY_ID,
    );

    const valuesArg = insertChain.values.mock.calls[0]?.[0];
    expect(valuesArg?.monthly_credits_estimate).toBe(1);
  });

  it('create_recurring_task falls back to monthly_credits_estimate=1 for unknown cadence', async () => {
    insertChain.returning.mockResolvedValueOnce([
      { id: 'r-x', title: 'Mystery cadence', cadence: 'lunar' },
    ]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_recurring_task',
      { title: 'Mystery cadence', description: 'd', tag: 'data', cadence: 'lunar' },
      COMPANY_ID,
    );

    const valuesArg = insertChain.values.mock.calls[0]?.[0];
    expect(valuesArg?.monthly_credits_estimate).toBe(1);
    expect(result.content).toContain('1 credits/month');
  });

  it('create_recurring_task surfaces error message when insert throws', async () => {
    insertChain.returning.mockRejectedValueOnce(new Error('db boom'));

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_recurring_task',
      { title: 't', description: 'd', tag: 'data', cadence: 'daily' },
      COMPANY_ID,
    );

    expect(result.content).toContain('Could not create recurring task');
    expect(result.content).toContain('db boom');
  });

  it('inverts paused → is_active in update_recurring_task (paused: true → is_active: false)', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'update_recurring_task',
      { recurring_id: 'r-1', paused: true },
      COMPANY_ID,
    );

    // The set() call must have received is_active=false (and NOT a "paused" key).
    const setArg = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toBeDefined();
    expect(setArg.is_active).toBe(false);
    expect(setArg).not.toHaveProperty('paused');
    expect(result.content).toContain('is_active');
    expect(result.content).toContain('updated');
  });

  it('inverts paused → is_active in update_recurring_task (paused: false → is_active: true)', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    await handleToolCall(
      'update_recurring_task',
      { recurring_id: 'r-1', paused: false },
      COMPANY_ID,
    );

    const setArg = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.is_active).toBe(true);
    expect(setArg).not.toHaveProperty('paused');
  });

  it('update_recurring_task passes through cadence/title/description without inversion', async () => {
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    await handleToolCall(
      'update_recurring_task',
      {
        recurring_id: 'r-1',
        cadence: 'weekly',
        title: 'Renamed',
        description: 'New desc',
      },
      COMPANY_ID,
    );

    const setArg = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toMatchObject({
      cadence: 'weekly',
      title: 'Renamed',
      description: 'New desc',
    });
    // No `paused` provided → no is_active key
    expect(setArg).not.toHaveProperty('is_active');
  });

  it('update_recurring_task surfaces error message when update throws', async () => {
    updateChain.where.mockRejectedValueOnce(new Error('update failed'));

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'update_recurring_task',
      { recurring_id: 'r-1', paused: true },
      COMPANY_ID,
    );
    expect(result.content).toContain('Could not update');
    expect(result.content).toContain('update failed');
  });

  it('delete_recurring_task scopes the where clause to BOTH recurring_id AND company_id', async () => {
    const drizzleOrm = await import('drizzle-orm');
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');

    const result = await handleToolCall(
      'delete_recurring_task',
      { recurring_id: 'r-target' },
      COMPANY_ID,
    );

    // The where() got the result of and(eq(id, ...), eq(company_id, ...))
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
    expect(drizzleOrm.and).toHaveBeenCalledTimes(1);

    // Inspect the args passed to and() — there should be two eq() conditions
    const andCall = vi.mocked(drizzleOrm.and).mock.calls[0];
    expect(andCall).toHaveLength(2);

    // Inspect the args passed to eq() — these should be the table column +
    // value pairs we expect (recurring_id matches the input, company_id is
    // the founder's company).
    const eqCalls = vi.mocked(drizzleOrm.eq).mock.calls;
    const eqValues = eqCalls.map(([, val]) => val);
    expect(eqValues).toContain('r-target');
    expect(eqValues).toContain(COMPANY_ID);

    expect(result.content).toContain('permanently removed');
  });

  it('delete_recurring_task surfaces error message when delete throws', async () => {
    deleteChain.where.mockRejectedValueOnce(new Error('foreign key blocked'));

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'delete_recurring_task',
      { recurring_id: 'r-1' },
      COMPANY_ID,
    );
    expect(result.content).toContain('Could not delete');
    expect(result.content).toContain('foreign key blocked');
  });
});
