// Unit tests for the 13 CEO task-management tool handlers.
// Routes through `handleToolCall` (the public switch dispatch in ceo.tools.ts)
// so the switch + handler pair are exercised end-to-end with mocked services.
//
// Mocking pattern mirrors src/lib/services/credit.service.test.ts:
//   - vi.mock for @/lib/db, @/lib/logger, and every service the handler imports
//   - vi.mock for drizzle-orm so eq/and/desc/sql become inert tag objects
//   - dynamic `await import('@/lib/agents/ceo/ceo.tools')` inside each test so
//     vi.mock registrations are honored before the handler module loads.
//
// Each of the 13 task tools has at least one passing-path and one failure-path
// test. We never call handler functions directly — always via handleToolCall().

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock chains ─────────────────────────────────────────────────────────
// Drizzle's fluent API: db.select().from().where().orderBy().limit()
//                       db.update().set().where()
// Each chain method returns `this` until the terminal step resolves. Default
// terminals resolve to `[]` / undefined so handlers don't crash; tests override
// with mockResolvedValueOnce when they need specific rows.

const insertChain = {
  values: vi.fn(),
  returning: vi.fn(),
  onConflictDoUpdate: vi.fn(),
};
const updateChain = {
  set: vi.fn(),
  where: vi.fn(),
};
const deleteChain = {
  where: vi.fn(),
};
// Each db.select() returns a fresh select chain so tests can sequence multiple
// reads. We expose `current` so tests can reach in and tweak the next chain.
const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
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
  // Tables imported by ceo.tool-handlers.ts — mirror them as opaque tokens so
  // the handler's `eq(tasks.id, ...)` lookups don't blow up. The mock drizzle
  // helpers below ignore the column reference anyway.
  tasks: {
    id: 'tasks.id',
    company_id: 'tasks.company_id',
    status: 'tasks.status',
    title: 'tasks.title',
    tag: 'tasks.tag',
    assigned_to_agent_id: 'tasks.assigned_to_agent_id',
    started_at: 'tasks.started_at',
    queue_order: 'tasks.queue_order',
  },
  taskExecutions: {
    task_id: 'taskExecutions.task_id',
    started_at: 'taskExecutions.started_at',
    execution_log: 'taskExecutions.execution_log',
    turn_count: 'taskExecutions.turn_count',
    agent_id: 'taskExecutions.agent_id',
  },
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

// drizzle-orm helpers become identifiable tag objects we can inspect.
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

vi.mock('@/lib/services/task.service', () => ({
  getTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@/lib/services/task-draft.service', () => ({
  getPendingTaskDrafts: vi.fn().mockResolvedValue([]),
  getTaskDraft: vi.fn().mockResolvedValue(null),
  markTaskDraftFinalized: vi.fn(),
  discardTaskDraft: vi.fn(),
}));

vi.mock('@/lib/services/governance.service', () => ({
  evaluateTask: vi.fn(),
}));

vi.mock('@/lib/services/credit.service', () => ({
  getBalance: vi.fn(),
  getLedger: vi.fn(),
}));

vi.mock('@/lib/services/event.service', () => ({
  emit: vi.fn(),
}));

vi.mock('@/lib/services/failure.service', () => ({
  getKnownIssuesForTag: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/services/router.service', () => ({
  routeTask: vi.fn().mockReturnValue(29),
  routeTaskStrict: vi.fn().mockReturnValue(29),
  getKnownTaskTags: vi.fn().mockReturnValue(['feature', 'mvp', 'landing-page', 'research']),
  getAgentName: vi.fn().mockReturnValue('Research'),
  getCreditCostForTask: vi.fn().mockReturnValue(1),
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

// approve_task imports worker-launcher dynamically — mock it so we can spy on
// launchTask without dragging in the real launcher (and its deep deps).
vi.mock('@/lib/agents/worker-launcher', () => ({
  launchTask: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_COMPANY_ID = '00000000-0000-0000-0000-000000000999';

/**
 * Restore default chain terminal behaviors after vi.clearAllMocks() wipes them.
 * Without this every chain method returns `undefined` and handlers crash with
 * "Cannot read properties of undefined (reading 'where')".
 */
function resetChains() {
  insertChain.values.mockReturnValue(insertChain);
  insertChain.returning.mockResolvedValue([]);
  insertChain.onConflictDoUpdate.mockResolvedValue(undefined);

  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);

  deleteChain.where.mockResolvedValue(undefined);

  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([]);
  // For chains that terminate at .where() (no orderBy/limit), the test must
  // override .where to mockResolvedValueOnce. The default is "still chainable"
  // so we can't blanket-resolve here.
}

/** Minimal Task fixture — caller overrides the bits it cares about. */
function makeTask(over: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    company_id: COMPANY_ID,
    title: 'Build the landing page',
    description: 'A nice landing',
    tag: 'landing-page',
    task_type: null,
    status: 'todo',
    priority: 50,
    complexity: null,
    queue_order: 1,
    source: 'ceo_suggested',
    suggestion_reasoning: null,
    executability_type: 'can_run_now',
    execution_mode: 'template_plus_params',
    assigned_to_agent_id: 30,
    estimated_hours: null,
    estimated_credits: 1,
    actual_credits_charged: 0,
    verification_level: 'browser_flow',
    refund_policy: null,
    failure_class: null,
    related_task_ids: null,
    run_link: null,
    markdown_link: null,
    authorized_by: 'founder',
    authorization_reason: null,
    max_turns: 200,
    turn_count: 0,
    repair_attempt_count: 0,
    started_at: null,
    completed_at: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

const completeEngineeringExecutionContract = {
  version: 1,
  intent: 'feature',
  assigned_agent_id: 30,
  confirmation_source: 'founder_confirmed',
  founder_visible_summary: 'Build the project dashboard slice.',
  product_scope: 'Authenticated users can create projects and see the saved project dashboard.',
  assumptions: ['Founder confirmed this as the next Engineering slice.'],
  open_questions: [],
  user_flow: ['Sign in', 'Open dashboard', 'Create project', 'See saved project on dashboard'],
  screens: ['Login', 'Dashboard', 'Create project form'],
  data_fields: ['project.name', 'project.status', 'project.created_at'],
  api_actions: ['GET /api/projects', 'POST /api/projects'],
  integrations: [],
  acceptance_criteria: ['Created project persists and is visible after refresh.'],
  out_of_scope: ['Payments', 'Admin roles'],
  ui_freedom: true,
};

// ── 1. get_tasks ───────────────────────────────────────────────────────────

describe('CEO tool handlers — get_tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('groups tasks by status with bullet lists', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTasks).mockResolvedValueOnce([
      makeTask({ id: 't-todo', title: 'Todo one', status: 'todo', tag: 'research' }) as never,
      makeTask({ id: 't-run', title: 'Running one', status: 'in_progress', tag: 'api' }) as never,
      makeTask({ id: 't-done', title: 'Done one', status: 'completed', tag: 'tweet' }) as never,
    ]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_tasks', {}, COMPANY_ID);

    // Status labels render with underscores swapped for spaces ("in_progress" → "in progress")
    expect(result.content).toContain('todo');
    expect(result.content).toContain('in progress');
    expect(result.content).toContain('completed');
    // Each task surfaced with id, title, tag
    expect(result.content).toContain('Todo one');
    expect(result.content).toContain('[t-todo]');
    expect(result.content).toContain('research');
    expect(result.content).toContain('Running one');
    expect(result.content).toContain('Done one');
  });

  it('returns empty-state message when there are no tasks', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTasks).mockResolvedValueOnce([]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_tasks', {}, COMPANY_ID);

    expect(result.content).toBe('No tasks in the queue yet.');
  });
});

// ── 2. create_task ─────────────────────────────────────────────────────────

describe('CEO tool handlers — create_task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('happy path: calls governance, creates task, emits event, returns task_proposal action', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');
    const failure = await import('@/lib/services/failure.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'template_plus_params',
      verification_level: 'browser_flow',
    });
    vi.mocked(failure.getKnownIssuesForTag).mockResolvedValueOnce([]);
    vi.mocked(taskService.createTask).mockResolvedValueOnce(
      makeTask({ id: 't-new', title: 'Build a landing page', tag: 'landing-page' }) as never,
    );
    vi.mocked(events.emit).mockResolvedValueOnce({} as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      {
        title: 'Build a landing page',
        description: 'Marketing site',
        tag: 'landing-page',
        estimated_hours: 3,
      },
      COMPANY_ID,
    );

    // governance gets the founder-supplied scope
    expect(governance.evaluateTask).toHaveBeenCalledTimes(1);
    expect(governance.evaluateTask).toHaveBeenCalledWith({
      title: 'Build a landing page',
      description: 'Marketing site',
      tag: 'landing-page',
      companyId: COMPANY_ID,
    });

    // taskService.createTask receives the merged input + governance decision
    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    const createArg = vi.mocked(taskService.createTask).mock.calls[0]![0];
    expect(createArg).toMatchObject({
      company_id: COMPANY_ID,
      title: 'Build a landing page',
      description: 'Marketing site',
      tag: 'landing-page',
      source: 'ceo_suggested',
      execution_mode: 'template_plus_params',
      verification_level: 'browser_flow',
      estimated_credits: 1,
      estimated_hours: 3,
      priority: 50, // default medium
      complexity: 5, // default
      authorized_by: 'founder',
    });

    // event emission with task_created
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      COMPANY_ID,
      'task_created',
      expect.objectContaining({
        task_id: 't-new',
        title: 'Build a landing page',
        tag: 'landing-page',
        source: 'ceo_suggested',
      }),
    );

    // Return shape: text confirmation + task_proposal action.
    // Note: estimated_hours is intentionally NOT echoed in the confirmation
    // text nor included in the action data — it's internal scoping metadata,
    // not founder-facing. Asserted as absent so a regression that re-leaks
    // it to the UI surface fails the test.
    expect(result.content).toContain('Task created');
    expect(result.content).toContain('Build a landing page');
    expect(result.content).toContain('[t-new]');
    expect(result.content).not.toMatch(/~?\d+\.?\d*h\b/); // no "3h", "~3h", "3.5h" etc.
    expect(result.content).toContain('Run link:');
    expect(result.action).toBeDefined();
    expect(result.action?.type).toBe('task_proposal');
    if (result.action?.type === 'task_proposal') {
      expect(result.action.data).toMatchObject({
        task_id: 't-new',
        title: 'Build a landing page',
        tag: 'landing-page',
        estimated_credits: 1,
        priority: 50,
      });
      expect((result.action.data as unknown as Record<string, unknown>).estimated_hours).toBeUndefined();
    }
  });

  it('rejects unknown tags instead of silently assigning Engineering', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const router = await import('@/lib/services/router.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'template_plus_params',
      verification_level: 'browser_flow',
    });
    vi.mocked(router.routeTaskStrict).mockReturnValueOnce(null);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      {
        title: 'Build weird thing',
        description: 'A vague task with a non-canonical tag',
        tag: 'scrape-dashboard',
        estimated_hours: 1,
      },
      COMPANY_ID,
    );

    expect(result.content).toContain('Unknown task tag');
    expect(result.content).toContain('scrape-dashboard');
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('blocks Engineering product work when CEO did not provide an execution contract', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const router = await import('@/lib/services/router.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'full_agent',
      verification_level: 'browser_flow',
    });
    vi.mocked(router.routeTaskStrict).mockReturnValueOnce(30);
    vi.mocked(router.getAgentName).mockReturnValueOnce('Engineering');

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      {
        title: 'Build project dashboard',
        description: 'Create project CRUD and dashboard UI.',
        tag: 'engineering',
        complexity: 5,
        estimated_hours: 3,
      },
      COMPANY_ID,
    );

    expect(result.content).toContain('Engineering handoff blocked');
    expect(result.content).toContain('execution_contract');
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('allows Engineering product work when CEO provides a complete execution contract', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');
    const router = await import('@/lib/services/router.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'full_agent',
      verification_level: 'browser_flow',
    });
    vi.mocked(router.routeTaskStrict).mockReturnValueOnce(30);
    vi.mocked(router.getAgentName).mockReturnValueOnce('Engineering');
    vi.mocked(taskService.createTask).mockResolvedValueOnce(
      makeTask({ id: 't-eng', title: 'Build project dashboard', tag: 'engineering' }) as never,
    );
    vi.mocked(events.emit).mockResolvedValueOnce({} as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    await handleToolCall(
      'create_task',
      {
        title: 'Build project dashboard',
        description: 'Create project CRUD and dashboard UI.',
        tag: 'engineering',
        complexity: 5,
        estimated_hours: 3,
        execution_contract: completeEngineeringExecutionContract,
      },
      COMPANY_ID,
    );

    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(taskService.createTask).mock.calls[0]![0]).toMatchObject({
      assigned_to_agent_id: 30,
      execution_contract: completeEngineeringExecutionContract,
    });
  });

  it('passes complexity through to getCreditCostForTask, charges 2 credits for heavy Browser task', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');
    const failure = await import('@/lib/services/failure.service');
    const router = await import('@/lib/services/router.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'full_agent',
      verification_level: 'browser_flow',
    });
    vi.mocked(failure.getKnownIssuesForTag).mockResolvedValueOnce([]);
    vi.mocked(taskService.createTask).mockResolvedValueOnce(
      makeTask({ id: 't-heavy', title: 'Sign up for OpenAI and get API key', tag: 'account-setup' }) as never,
    );
    vi.mocked(events.emit).mockResolvedValueOnce({} as never);
    vi.mocked(router.routeTaskStrict).mockReturnValueOnce(42);
    vi.mocked(router.getAgentName).mockReturnValueOnce('Browser');
    vi.mocked(router.getCreditCostForTask).mockReturnValueOnce(2);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      {
        title: 'Sign up for OpenAI and get API key',
        description: 'Use the openai provider pack',
        tag: 'account-setup',
        complexity: 8,
        estimated_hours: 2.5,
      },
      COMPANY_ID,
    );

    expect(router.getCreditCostForTask).toHaveBeenCalledWith('account-setup', 8);
    const createArg = vi.mocked(taskService.createTask).mock.calls.at(-1)![0];
    expect(createArg).toMatchObject({ estimated_credits: 2 });
    expect(result.content).toContain('2 credits');
    if (result.action?.type === 'task_proposal') {
      expect(result.action.data).toMatchObject({ estimated_credits: 2 });
    }
  });

  it('clamps out-of-range complexity (defaults missing → 5; clamps negative; clamps >10)', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');
    const failure = await import('@/lib/services/failure.service');
    const router = await import('@/lib/services/router.service');

    vi.mocked(governance.evaluateTask).mockResolvedValue({
      can_execute: true,
      execution_mode: 'full_agent',
      verification_level: 'none',
    });
    vi.mocked(failure.getKnownIssuesForTag).mockResolvedValue([]);
    vi.mocked(taskService.createTask).mockResolvedValue(makeTask({ id: 't-c' }) as never);
    vi.mocked(events.emit).mockResolvedValue({} as never);
    vi.mocked(router.routeTaskStrict).mockReturnValue(42);
    vi.mocked(router.getAgentName).mockReturnValue('Browser');
    vi.mocked(router.getCreditCostForTask).mockReturnValue(1);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');

    // Missing complexity → defaults to 5
    await handleToolCall('create_task', { title: 't', description: 'd', tag: 'scrape', estimated_hours: 1 }, COMPANY_ID);
    expect(router.getCreditCostForTask).toHaveBeenLastCalledWith('scrape', 5);

    // Negative → clamp to 1
    await handleToolCall('create_task', { title: 't', description: 'd', tag: 'scrape', complexity: -3, estimated_hours: 1 }, COMPANY_ID);
    expect(router.getCreditCostForTask).toHaveBeenLastCalledWith('scrape', 1);

    // >10 → clamp to 10
    await handleToolCall('create_task', { title: 't', description: 'd', tag: 'scrape', complexity: 99, estimated_hours: 1 }, COMPANY_ID);
    expect(router.getCreditCostForTask).toHaveBeenLastCalledWith('scrape', 10);

    // Float → rounded
    await handleToolCall('create_task', { title: 't', description: 'd', tag: 'scrape', complexity: 6.7, estimated_hours: 1 }, COMPANY_ID);
    expect(router.getCreditCostForTask).toHaveBeenLastCalledWith('scrape', 7);
  });

  it('blocks on non-credit governance blocker (e.g. OAuth missing) — does NOT create task', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: false,
      execution_mode: 'full_agent',
      verification_level: 'none',
      blocker: 'This task requires an OAuth connection for "twitter".',
    });

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      { title: 'Tweet something', description: 'Post a tweet', tag: 'twitter', estimated_hours: 0.5 },
      COMPANY_ID,
    );

    expect(result.content).toContain("Can't run this yet");
    expect(result.content).toContain('OAuth connection');
    expect(result.action).toBeUndefined();
    // No task created, no event emitted
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('queues task even at zero credits (credit_warning is non-blocking)', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: false,
      execution_mode: 'template_plus_params',
      verification_level: 'browser_flow',
      blocker: 'no_credits',
      credit_warning: 'no_credits',
    });
    vi.mocked(taskService.createTask).mockResolvedValueOnce(
      makeTask({ id: 't-queued', title: 'Queue me' }) as never,
    );
    vi.mocked(events.emit).mockResolvedValueOnce({} as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      { title: 'Queue me', description: 'desc', tag: 'landing-page', estimated_hours: 2 },
      COMPANY_ID,
    );

    // blocker is 'no_credits' so handler proceeds and creates the task
    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('Task created');
    expect(result.content).toContain('0 credits');
    expect(result.action?.type).toBe('task_proposal');
  });

  it('surfaces a known-issue heads-up note when failure.service finds open issues', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const failure = await import('@/lib/services/failure.service');
    const events = await import('@/lib/services/event.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'full_agent',
      verification_level: 'none',
    });
    vi.mocked(failure.getKnownIssuesForTag).mockResolvedValueOnce([
      { id: 'fp-1' } as never,
      { id: 'fp-2' } as never,
    ]);
    vi.mocked(taskService.createTask).mockResolvedValueOnce(
      makeTask({ id: 't-warn', title: 'Risky' }) as never,
    );
    vi.mocked(events.emit).mockResolvedValueOnce({} as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      { title: 'Risky', description: 'd', tag: 'bug-fix', estimated_hours: 2 },
      COMPANY_ID,
    );

    expect(result.content).toContain('Heads up');
    expect(result.content).toContain('2 open');
  });

  // ── 4-hour cap + new params: estimated_hours and priority ────────────────

  it('rejects task with estimated_hours > 4 — does NOT create, returns split guidance', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      {
        title: 'Build the whole blog system',
        description: 'Posts + comments + admin in one shot',
        tag: 'landing-page',
        complexity: 8,
        estimated_hours: 12,
      },
      COMPANY_ID,
    );

    // No governance call, no task created, no event emitted — we reject early.
    expect(governance.evaluateTask).not.toHaveBeenCalled();
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();

    // Founder-safe message guides the CEO model to split, references 4h cap +
    // related_task_ids + the worked example.
    expect(result.content).toContain('Task too large');
    expect(result.content).toContain('12h');
    expect(result.content).toContain('4h');
    expect(result.content).toContain('related_task_ids');
    expect(result.action).toBeUndefined();
  });

  it('rejects task when estimated_hours is missing — does NOT create', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3 },
      COMPANY_ID,
    );

    expect(governance.evaluateTask).not.toHaveBeenCalled();
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(result.content).toContain('estimated_hours');
    expect(result.content).toContain('0.5');
    expect(result.content).toContain('4');
  });

  it('rejects task when estimated_hours is non-numeric or zero — does NOT create', async () => {
    const taskService = await import('@/lib/services/task.service');
    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');

    // Non-numeric
    const r1 = await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 'two' as unknown as number },
      COMPANY_ID,
    );
    expect(r1.content).toContain('estimated_hours');
    expect(taskService.createTask).not.toHaveBeenCalled();

    // Zero
    const r2 = await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 0 },
      COMPANY_ID,
    );
    expect(r2.content).toContain('estimated_hours');
    expect(taskService.createTask).not.toHaveBeenCalled();
  });

  it('accepts exactly 4 hours (boundary)', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'template_plus_params',
      verification_level: 'none',
    });
    vi.mocked(taskService.createTask).mockResolvedValueOnce(
      makeTask({ id: 't-4h', title: 'Right at the cap' }) as never,
    );
    vi.mocked(events.emit).mockResolvedValueOnce({} as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'create_task',
      { title: 'Right at the cap', description: 'd', tag: 'scrape', complexity: 5, estimated_hours: 4 },
      COMPANY_ID,
    );

    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    const createArg = vi.mocked(taskService.createTask).mock.calls.at(-1)![0];
    expect(createArg).toMatchObject({ estimated_hours: 4 });
    // estimated_hours must NOT leak into the confirmation text — internal
    // scoping only. Founders see credits, not hours.
    // Reject "~4h", " 4h.", "(4h)", "4 hours" etc. but not "t-4h" task IDs.
    expect(result.content).not.toMatch(/(?:[\s~(])\d+\.?\d*\s?h(?:ours?)?\b/);
  });

  it('maps priority labels to integer (low=25, medium=50, high=75, critical=100)', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');

    vi.mocked(governance.evaluateTask).mockResolvedValue({
      can_execute: true,
      execution_mode: 'template_plus_params',
      verification_level: 'none',
    });
    vi.mocked(taskService.createTask).mockResolvedValue(makeTask() as never);
    vi.mocked(events.emit).mockResolvedValue({} as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');

    await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 1, priority: 'low' },
      COMPANY_ID,
    );
    expect(vi.mocked(taskService.createTask).mock.calls.at(-1)![0]).toMatchObject({ priority: 25 });

    await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 1, priority: 'medium' },
      COMPANY_ID,
    );
    expect(vi.mocked(taskService.createTask).mock.calls.at(-1)![0]).toMatchObject({ priority: 50 });

    await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 1, priority: 'high' },
      COMPANY_ID,
    );
    expect(vi.mocked(taskService.createTask).mock.calls.at(-1)![0]).toMatchObject({ priority: 75 });

    await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 1, priority: 'critical' },
      COMPANY_ID,
    );
    expect(vi.mocked(taskService.createTask).mock.calls.at(-1)![0]).toMatchObject({ priority: 100 });

    // Unknown / missing → default medium (50)
    await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 1 },
      COMPANY_ID,
    );
    expect(vi.mocked(taskService.createTask).mock.calls.at(-1)![0]).toMatchObject({ priority: 50 });

    await handleToolCall(
      'create_task',
      { title: 't', description: 'd', tag: 'scrape', complexity: 3, estimated_hours: 1, priority: 'urgent' },
      COMPANY_ID,
    );
    expect(vi.mocked(taskService.createTask).mock.calls.at(-1)![0]).toMatchObject({ priority: 50 });
  });

  it('passes related_task_ids through (sequential splits link to upstream piece)', async () => {
    const governance = await import('@/lib/services/governance.service');
    const taskService = await import('@/lib/services/task.service');
    const events = await import('@/lib/services/event.service');

    vi.mocked(governance.evaluateTask).mockResolvedValueOnce({
      can_execute: true,
      execution_mode: 'template_plus_params',
      verification_level: 'none',
    });
    vi.mocked(taskService.createTask).mockResolvedValueOnce(
      makeTask({ id: 't-piece-2' }) as never,
    );
    vi.mocked(events.emit).mockResolvedValueOnce({} as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    await handleToolCall(
      'create_task',
      {
        title: 'Comments on posts',
        description: 'second piece of split',
        tag: 'engineering',
        complexity: 4,
        estimated_hours: 3,
        related_task_ids: ['t-piece-1'],
      },
      COMPANY_ID,
    );

    const arg = vi.mocked(taskService.createTask).mock.calls.at(-1)![0];
    expect(arg).toMatchObject({
      related_task_ids: ['t-piece-1'],
      estimated_hours: 3,
    });
  });
});

// ── 3. reject_task ─────────────────────────────────────────────────────────

describe('CEO tool handlers — reject_task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('rejects a todo task and includes the founder-provided reason', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-rej', title: 'Old idea', status: 'todo' }) as never,
    );
    vi.mocked(taskService.updateTask).mockResolvedValueOnce(makeTask() as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'reject_task',
      { task_id: 't-rej', reason: 'Pivoted away from this' },
      COMPANY_ID,
    );

    expect(taskService.updateTask).toHaveBeenCalledWith('t-rej', { status: 'rejected' });
    expect(result.content).toContain('Old idea');
    expect(result.content).toContain('rejected');
    expect(result.content).toContain('Pivoted away');
  });

  it('refuses to reject a task that is already in_progress', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-running', status: 'in_progress' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('reject_task', { task_id: 't-running' }, COMPANY_ID);

    expect(result.content).toContain('Cannot reject');
    expect(result.content).toContain('currently running');
    expect(taskService.updateTask).not.toHaveBeenCalled();
  });

  it('returns "Task not found" when company_id does not match (cross-company isolation)', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-other', company_id: OTHER_COMPANY_ID }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('reject_task', { task_id: 't-other' }, COMPANY_ID);

    expect(result.content).toBe('Task not found.');
    expect(taskService.updateTask).not.toHaveBeenCalled();
  });
});

// ── 4. get_task_details ────────────────────────────────────────────────────

describe('CEO tool handlers — get_task_details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('renders task details with status, tag, agent, credits', async () => {
    const taskService = await import('@/lib/services/task.service');
    const router = await import('@/lib/services/router.service');
    vi.mocked(router.getAgentName).mockReturnValueOnce('Engineering');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({
        id: 't-detail',
        title: 'Build login',
        status: 'todo',
        tag: 'auth',
        priority: 75,
        actual_credits_charged: 0,
        estimated_credits: 1,
        source: 'founder_requested',
        assigned_to_agent_id: 30,
      }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_task_details', { task_id: 't-detail' }, COMPANY_ID);

    expect(result.content).toContain('Build login');
    expect(result.content).toContain('todo');
    expect(result.content).toContain('auth');
    expect(result.content).toContain('Engineering');
    expect(result.content).toContain('75');
    expect(result.content).toContain('0/1');
    expect(result.content).toContain('founder requested');
  });

  it('returns "Task not found" when task does not exist', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(null);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_task_details', { task_id: 'missing' }, COMPANY_ID);

    expect(result.content).toBe('Task not found.');
  });
});

// ── 5. edit_task ───────────────────────────────────────────────────────────

describe('CEO tool handlers — edit_task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('updates the title and tag when both are provided', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-edit', title: 'Old title', status: 'todo' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'edit_task',
      { task_id: 't-edit', title: 'New title', tag: 'api' },
      COMPANY_ID,
    );

    // db.update(...).set({ title, tag }).where(...)
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    const setArg = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toMatchObject({ title: 'New title', tag: 'api' });
    expect(result.content).toContain('updated');
    expect(result.content).toContain('title');
    expect(result.content).toContain('tag');
  });

  it('refuses to edit a completed task', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-done', status: 'completed' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'edit_task',
      { task_id: 't-done', title: 'too late' },
      COMPANY_ID,
    );

    expect(result.content).toContain('Cannot edit');
    expect(result.content).toContain('completed');
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it('returns "No changes specified" when caller passes no editable fields', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-noop', status: 'todo' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('edit_task', { task_id: 't-noop' }, COMPANY_ID);

    expect(result.content).toBe('No changes specified.');
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});

// ── 6. get_task_run_link ───────────────────────────────────────────────────

describe('CEO tool handlers — get_task_run_link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('returns a magic link including the task id', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-link' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_run_link',
      { task_id: 't-link' },
      COMPANY_ID,
    );

    expect(result.content).toContain('/api/tasks/t-link/run');
    expect(result.content).toContain('1 credit');
  });

  it('returns "Task not found" for a task owned by a different company', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-other', company_id: OTHER_COMPANY_ID }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_run_link',
      { task_id: 't-other' },
      COMPANY_ID,
    );

    expect(result.content).toBe('Task not found.');
  });
});

// ── 7. get_task_execution_status ───────────────────────────────────────────

describe('CEO tool handlers — get_task_execution_status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('reports running time + agent + turn count for in_progress task', async () => {
    const taskService = await import('@/lib/services/task.service');
    const router = await import('@/lib/services/router.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-run', status: 'in_progress' }) as never,
    );
    vi.mocked(router.getAgentName).mockReturnValueOnce('Engineering');

    // db.select().from(taskExecutions).where().orderBy().limit(1) returning a row
    selectChain.limit.mockResolvedValueOnce([
      {
        agent_id: 30,
        started_at: new Date(Date.now() - 90_000).toISOString(), // ~90s ago
        turn_count: 4,
      },
    ] as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_execution_status',
      { task_id: 't-run' },
      COMPANY_ID,
    );

    expect(result.content).toContain('running');
    expect(result.content).toContain('Engineering');
    // ~1m 30s (allow either)
    expect(result.content).toMatch(/[01]m [0-9]+s/);
    expect(result.content).toContain('4');
  });

  it('returns current status when task is not in_progress', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-done', status: 'completed' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_execution_status',
      { task_id: 't-done' },
      COMPANY_ID,
    );

    expect(result.content).toContain('not running');
    expect(result.content).toContain('completed');
    // No execution lookup since we early-returned
    expect(selectChain.limit).not.toHaveBeenCalled();
  });

  it('returns "Task not found" when task_id is unknown', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(null);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_execution_status',
      { task_id: 'missing' },
      COMPANY_ID,
    );

    expect(result.content).toBe('Task not found.');
  });
});

// ── 8. approve_task ────────────────────────────────────────────────────────

describe('CEO tool handlers — approve_task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('happy path: balance ok → records authorization, fires launchTask, returns task_approved action', async () => {
    const taskService = await import('@/lib/services/task.service');
    const credit = await import('@/lib/services/credit.service');
    const launcher = await import('@/lib/agents/worker-launcher');

    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-approve', title: 'Run me', status: 'todo' }) as never,
    );
    vi.mocked(credit.getBalance).mockResolvedValueOnce(5);
    vi.mocked(taskService.updateTask).mockResolvedValueOnce(makeTask() as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'approve_task',
      { task_id: 't-approve' },
      COMPANY_ID,
    );

    // Authorization recorded with founder + reason
    expect(taskService.updateTask).toHaveBeenCalledWith('t-approve', {
      authorized_by: 'founder',
      authorization_reason: 'Founder approved via CEO chat',
    });
    // launchTask invoked (fire-and-forget)
    expect(launcher.launchTask).toHaveBeenCalledWith('t-approve');
    // Response shape
    expect(result.content).toContain('Run me');
    expect(result.content).toContain('approved');
    expect(result.action?.type).toBe('task_approved');
    if (result.action?.type === 'task_approved') {
      expect(result.action.data).toEqual({ task_id: 't-approve', title: 'Run me' });
    }
  });

  it('blocks approval when credit balance < 1', async () => {
    const taskService = await import('@/lib/services/task.service');
    const credit = await import('@/lib/services/credit.service');
    const launcher = await import('@/lib/agents/worker-launcher');

    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-broke', title: 'Need credits', status: 'todo' }) as never,
    );
    vi.mocked(credit.getBalance).mockResolvedValueOnce(0);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('approve_task', { task_id: 't-broke' }, COMPANY_ID);

    expect(result.content).toContain('Not enough credits');
    expect(result.content).toContain('Need credits');
    expect(taskService.updateTask).not.toHaveBeenCalled();
    expect(launcher.launchTask).not.toHaveBeenCalled();
    expect(result.action).toBeUndefined();
  });

  it('refuses to approve a task that is not in todo status', async () => {
    const taskService = await import('@/lib/services/task.service');
    const launcher = await import('@/lib/agents/worker-launcher');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-running', status: 'in_progress' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'approve_task',
      { task_id: 't-running' },
      COMPANY_ID,
    );

    expect(result.content).toContain('already in progress');
    expect(launcher.launchTask).not.toHaveBeenCalled();
  });
});

// ── 9. get_task_execution_logs ─────────────────────────────────────────────

describe('CEO tool handlers — get_task_execution_logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('summarizes the last 10 safe events with turn count', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-logs', status: 'completed' }) as never,
    );

    selectChain.limit.mockResolvedValueOnce([
      {
        execution_log: [
          { event: 'task_started', message: 'Booted up' },
          { event: 'progress', message: 'Halfway there' },
          { event: 'task_completed', message: 'Wrapped up' },
        ],
        turn_count: 12,
        agent_id: 30,
      },
    ] as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_execution_logs',
      { task_id: 't-logs' },
      COMPANY_ID,
    );

    expect(result.content).toContain('Task Execution Summary');
    expect(result.content).toContain('12 turns');
    // Each enumerated step shows up
    expect(result.content).toContain('task_started');
    expect(result.content).toContain('progress');
    expect(result.content).toContain('task_completed');
  });

  it('returns the empty-logs message when no execution row exists', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-nolog' }) as never,
    );
    selectChain.limit.mockResolvedValueOnce([]);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_execution_logs',
      { task_id: 't-nolog' },
      COMPANY_ID,
    );

    expect(result.content).toBe('No execution logs available for this task.');
  });

  it('returns "Task not found" when task is owned by another company', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-other', company_id: OTHER_COMPANY_ID }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'get_task_execution_logs',
      { task_id: 't-other' },
      COMPANY_ID,
    );

    expect(result.content).toBe('Task not found.');
  });
});

// ── 10. get_active_executions ──────────────────────────────────────────────

describe('CEO tool handlers — get_active_executions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('lists in-progress tasks with elapsed minutes and agent name', async () => {
    const router = await import('@/lib/services/router.service');
    vi.mocked(router.getAgentName).mockReturnValue('Engineering');

    // get_active_executions terminates at .where() — override it to resolve.
    selectChain.where.mockResolvedValueOnce([
      {
        id: 't-a',
        title: 'Build the API',
        tag: 'api',
        assigned_to_agent_id: 30,
        started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ] as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_active_executions', {}, COMPANY_ID);

    expect(result.content).toContain('Active Executions');
    expect(result.content).toContain('Build the API');
    expect(result.content).toContain('api');
    expect(result.content).toContain('Engineering');
    expect(result.content).toMatch(/running \d+m/);
  });

  it('returns the empty-state message when nothing is running', async () => {
    selectChain.where.mockResolvedValueOnce([] as never);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall('get_active_executions', {}, COMPANY_ID);

    expect(result.content).toBe('No tasks are currently running.');
  });
});

// ── 11. find_best_agent ────────────────────────────────────────────────────

describe('CEO tool handlers — find_best_agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('uses strict canonical tag routing and surfaces the recommendation', async () => {
    const router = await import('@/lib/services/router.service');
    vi.mocked(router.routeTaskStrict).mockReturnValueOnce(30);
    vi.mocked(router.getAgentName).mockReturnValueOnce('Engineering');

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'find_best_agent',
      { query: 'webhook' },
      COMPANY_ID,
    );

    expect(router.routeTaskStrict).toHaveBeenCalledWith('webhook');
    expect(result.content).toContain('Best agent for "webhook"');
    expect(result.content).toContain('Engineering');
    expect(result.content).toContain('#30');
  });

  it('refuses free-text or unknown tags instead of defaulting to Engineering', async () => {
    const router = await import('@/lib/services/router.service');
    vi.mocked(router.routeTaskStrict).mockReturnValueOnce(null);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'find_best_agent',
      { query: 'something weird' },
      COMPANY_ID,
    );

    expect(result.content).toContain('Unknown task tag');
    expect(result.content).toContain('free text is not auto-routed');
  });
});

// ── 12. reorder_task ───────────────────────────────────────────────────────

describe('CEO tool handlers — reorder_task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('updates queue_order to the requested position and confirms in the response', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-move', title: 'Move me', status: 'todo' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'reorder_task',
      { task_id: 't-move', position: 7 },
      COMPANY_ID,
    );

    expect(updateChain.set).toHaveBeenCalledWith({ queue_order: 7 });
    expect(result.content).toContain('Move me');
    expect(result.content).toContain('position 7');
  });

  it('returns "Task not found" when the task belongs to a different company', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-other', company_id: OTHER_COMPANY_ID }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'reorder_task',
      { task_id: 't-other', position: 1 },
      COMPANY_ID,
    );

    expect(result.content).toBe('Task not found.');
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});

// ── 13. move_task_to_top ───────────────────────────────────────────────────

describe('CEO tool handlers — move_task_to_top', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChains();
  });

  it('sets queue_order to 0 and returns the "runs next" confirmation', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(
      makeTask({ id: 't-top', title: 'Urgent', status: 'todo' }) as never,
    );

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'move_task_to_top',
      { task_id: 't-top' },
      COMPANY_ID,
    );

    expect(updateChain.set).toHaveBeenCalledWith({ queue_order: 0 });
    expect(result.content).toContain('Urgent');
    expect(result.content).toContain('top');
    expect(result.content).toContain('run next');
  });

  it('returns "Task not found" when the task does not exist', async () => {
    const taskService = await import('@/lib/services/task.service');
    vi.mocked(taskService.getTask).mockResolvedValueOnce(null);

    const { handleToolCall } = await import('@/lib/agents/ceo/ceo.tools');
    const result = await handleToolCall(
      'move_task_to_top',
      { task_id: 'missing' },
      COMPANY_ID,
    );

    expect(result.content).toBe('Task not found.');
    expect(updateChain.set).not.toHaveBeenCalled();
  });
});
