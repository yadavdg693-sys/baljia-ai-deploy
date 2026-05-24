import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPendingPlanConfirmationAction,
  findPendingPlanMessage,
  queueConfirmedBuildPlan,
  tryQueueConfirmedBuildPlan,
  __confirmedPlanQueueTest,
} from './ceo.confirmed-plan-queue';

const { handleToolCall, getTasks, createTaskDraft, getPendingTaskDraftsForSources } = vi.hoisted(() => ({
  handleToolCall: vi.fn(),
  getTasks: vi.fn(),
  createTaskDraft: vi.fn(),
  getPendingTaskDraftsForSources: vi.fn(),
}));

vi.mock('./ceo.tools', () => ({
  handleToolCall,
}));

vi.mock('@/lib/services/task.service', () => ({
  getTasks,
}));

vi.mock('@/lib/services/task-draft.service', () => ({
  createTaskDraft,
  getPendingTaskDraftsForSources,
}));

const PLAN = `## CareerOps - Auto-Apply Job Platform

**One-liner:** Upload one resume, find relevant jobs, tailor resume + cover letter, auto-apply where possible.

### Build Order (8 tasks, 8 credits)

| # | Task | Hours | Depends on |
|---|------|-------|-----------|
| 1 | **User auth** - signup/login with email, sessions, secure credential storage | 3h | - |
| 2 | **Resume upload + parsing** - PDF/DOCX upload, extract structured profile | 4h | 1 |
| 3 | **Job preferences + profile** - target roles, locations, salary, remote preference | 3h | 1 |
| 4 | **Resume tailoring engine** - AI rewrites resume sections per job | 4h | 2 |
| 5 | **Job discovery engine** - source jobs from LinkedIn Easy Apply, Greenhouse, Lever, Workable | 4h | 3 |
| 6 | **Auto-apply pipeline** - submit where allowed, prepare package where blocked | 4h | 4 & 5 |
| 7 | **Application dashboard** - track applications, statuses, generated resumes | 4h | 6 |
| 8 | **Payments + free tier** - 5 free applies/day, paid unlimited | 3h | 7 |

Say **"go"** and I queue all 8.`;

function mockSequentialCreateTaskActions() {
  let index = 0;
  handleToolCall.mockImplementation(async (_toolName: string, input: Record<string, unknown>) => {
    index += 1;
    const title = String(input.title ?? `Task ${index}`);
    const tag = typeof input.tag === 'string' ? input.tag : 'engineering';
    return {
      content: `Task created: "${title}" [task-${index}]`,
      action: {
        type: 'task_proposal' as const,
        data: { task_id: `task-${index}`, title, tag },
      },
    };
  });
}

describe('confirmed plan queue fast path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTasks.mockResolvedValue([]);
    getPendingTaskDraftsForSources.mockResolvedValue([]);
    createTaskDraft.mockImplementation(async (input) => ({
      id: `draft-${createTaskDraft.mock.calls.length}`,
      ...input,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses build-order table rows and dependencies', () => {
    const tasks = __confirmedPlanQueueTest.parseBuildPlanTasks(PLAN);

    expect(tasks).toHaveLength(8);
    expect(tasks[0]).toMatchObject({
      index: 1,
      title: 'User auth',
      estimatedHours: 3,
      dependsOnIndexes: [],
    });
    expect(tasks[5]).toMatchObject({
      index: 6,
      title: 'Auto-apply pipeline',
      dependsOnIndexes: [4, 5],
    });
  });

  it('creates a pending plan action without creating tasks from the assistant plan text', () => {
    const action = createPendingPlanConfirmationAction(PLAN);

    expect(action).toMatchObject({
      type: 'pending_plan_confirmation',
      data: {
        plan_id: expect.stringMatching(/^plan_/),
        product_name: 'CareerOps',
        task_count: 8,
        queue_limit: 3,
        button_label: 'Queue first 3 tasks',
      },
    });
    expect(handleToolCall).not.toHaveBeenCalled();
    expect(createTaskDraft).not.toHaveBeenCalled();
  });

  it('finds the saved assistant plan by plan_id instead of trusting client task text', () => {
    const action = createPendingPlanConfirmationAction(PLAN);
    expect(action).not.toBeNull();

    const found = findPendingPlanMessage([
      { id: 'u1', session_id: 's1', role: 'user', content: 'yes', created_at: new Date().toISOString() },
      {
        id: 'a1',
        session_id: 's1',
        role: 'assistant',
        content: PLAN,
        actions: action ? [action] : undefined,
        created_at: new Date().toISOString(),
      },
    ], action?.data.plan_id ?? 'missing');

    expect(found?.message.content).toBe(PLAN);
    expect(found?.action.data.plan_id).toBe(action?.data.plan_id);
  });

  it('queues only the first rolling window one task at a time in plan order and parks the rest', async () => {
    mockSequentialCreateTaskActions();

    const result = await queueConfirmedBuildPlan({
      companyId: 'company-1',
      planContent: PLAN,
    });

    expect(result?.text).toContain('Queued first 3 CareerOps tasks');
    expect(result?.text).toContain('parked 5 for the next batch');
    expect(result?.actions).toHaveLength(3);
    expect(handleToolCall).toHaveBeenCalledTimes(3);
    expect(handleToolCall.mock.calls.map(([toolName]) => toolName)).toEqual([
      'create_task',
      'create_task',
      'create_task',
    ]);
    expect(handleToolCall).toHaveBeenNthCalledWith(
      1,
      'create_task',
      expect.objectContaining({
        title: 'User auth',
        tag: 'engineering',
        estimated_hours: 3,
        source: 'ceo_rolling_plan',
        related_task_ids: undefined,
        execution_contract: expect.objectContaining({
          version: 1,
          assigned_agent_id: 30,
          confirmation_source: 'founder_confirmed',
          open_questions: [],
          rolling_plan: expect.objectContaining({
            plan_index: 1,
            total_tasks: 8,
          }),
        }),
      }),
      'company-1',
    );
    expect(handleToolCall).toHaveBeenNthCalledWith(
      2,
      'create_task',
      expect.objectContaining({
        title: 'Resume upload + parsing',
        related_task_ids: ['task-1'],
      }),
      'company-1',
    );
    expect(handleToolCall).toHaveBeenNthCalledWith(
      3,
      'create_task',
      expect.objectContaining({
        title: 'Job preferences + profile',
        related_task_ids: ['task-1'],
      }),
      'company-1',
    );
    expect(createTaskDraft).toHaveBeenCalledTimes(5);
    expect(createTaskDraft.mock.calls.map(([input]) => input.title)).toEqual([
      'Resume tailoring engine',
      'Job discovery engine',
      'Auto-apply pipeline',
      'Application dashboard',
      'Payments + free tier',
    ]);
    expect(createTaskDraft.mock.calls[0]?.[0]).toMatchObject({
      company_id: 'company-1',
      source: 'ceo_rolling_plan',
      status: 'pending_ceo_review',
      proposed_task: expect.objectContaining({
        tag: 'engineering',
        estimated_hours: 4,
        depends_on_plan_indexes: [2],
        rolling_plan: expect.objectContaining({
          plan_index: 4,
          total_tasks: 8,
        }),
      }),
      proposed_execution_contract: expect.objectContaining({
        rolling_plan: expect.objectContaining({
          plan_index: 4,
        }),
      }),
    });
  });

  it('uses existing active tasks when deciding how many saved-plan tasks fit now', async () => {
    getTasks.mockResolvedValueOnce([
      { id: 'existing-1', status: 'todo' },
      { id: 'existing-2', status: 'in_progress' },
    ]);
    mockSequentialCreateTaskActions();

    const result = await queueConfirmedBuildPlan({
      companyId: 'company-1',
      planContent: PLAN,
    });

    expect(handleToolCall).toHaveBeenCalledTimes(1);
    expect(handleToolCall).toHaveBeenCalledWith(
      'create_task',
      expect.objectContaining({ title: 'User auth' }),
      'company-1',
    );
    expect(createTaskDraft).toHaveBeenCalledTimes(7);
    expect(result?.text).toContain('2 tasks already active');
  });

  it('queues the first rolling window from clear chat confirmation text and parks the rest', async () => {
    mockSequentialCreateTaskActions();

    const result = await tryQueueConfirmedBuildPlan({
      companyId: 'company-1',
      message: 'yes all 8 tasks in que',
      sessionHistory: [
        { id: 'a1', session_id: 's1', role: 'assistant', content: PLAN, created_at: new Date().toISOString() },
      ],
    });

    expect(result?.text).toContain('Queued first 3 CareerOps tasks');
    expect(result?.text).toContain('parked 5 for the next batch');
    expect(result?.actions).toHaveLength(3);
    expect(handleToolCall).toHaveBeenCalledTimes(3);
    expect(createTaskDraft).toHaveBeenCalledTimes(5);
  });

  it('recovers from a timed-out queue attempt by queueing the first rolling window for a short nudge', async () => {
    mockSequentialCreateTaskActions();

    const result = await tryQueueConfirmedBuildPlan({
      companyId: 'company-1',
      message: 'hey',
      sessionHistory: [
        { id: 'a1', session_id: 's1', role: 'assistant', content: PLAN, created_at: new Date().toISOString() },
        { id: 'u1', session_id: 's1', role: 'user', content: 'yes', created_at: new Date().toISOString() },
        {
          id: 'a2',
          session_id: 's1',
          role: 'assistant',
          content: 'Queuing all 8 tasks now.\n\n(Response timed out - please try again.)',
          created_at: new Date().toISOString(),
        },
      ],
    });

    expect(result?.text).toContain('Queued first 3 CareerOps tasks');
    expect(result?.text).toContain('parked 5 for the next batch');
    expect(handleToolCall).toHaveBeenCalledTimes(3);
    expect(createTaskDraft).toHaveBeenCalledTimes(5);
  });

  it('does not treat a clarifying queue question as approval to create tasks', async () => {
    const result = await tryQueueConfirmedBuildPlan({
      companyId: 'company-1',
      message: 'so all task run in que right?',
      sessionHistory: [
        { id: 'a1', session_id: 's1', role: 'assistant', content: PLAN, created_at: new Date().toISOString() },
      ],
    });

    expect(result).toBeNull();
    expect(handleToolCall).not.toHaveBeenCalled();
  });

  it('does not queue a saved plan from unrelated run or do requests', async () => {
    const runResult = await tryQueueConfirmedBuildPlan({
      companyId: 'company-1',
      message: 'run one e2e onboarding test',
      sessionHistory: [
        { id: 'a1', session_id: 's1', role: 'assistant', content: PLAN, created_at: new Date().toISOString() },
      ],
    });
    const doResult = await tryQueueConfirmedBuildPlan({
      companyId: 'company-1',
      message: 'can you do the test whats missing for meta agent',
      sessionHistory: [
        { id: 'a1', session_id: 's1', role: 'assistant', content: PLAN, created_at: new Date().toISOString() },
      ],
    });

    expect(runResult).toBeNull();
    expect(doResult).toBeNull();
    expect(handleToolCall).not.toHaveBeenCalled();
  });

  it('parks queued-window rows that were not created and maps dependency ids from created action titles', async () => {
    vi.stubEnv('CEO_ROLLING_TASK_LIMIT', '2');
    handleToolCall
      .mockResolvedValueOnce({ content: 'Blocked User auth' })
      .mockResolvedValueOnce({
        content: 'Task created: "Resume upload + parsing" [task-2]',
        action: {
          type: 'task_proposal',
          data: { task_id: 'task-2', title: 'Resume upload + parsing', tag: 'engineering' },
        },
      });

    const result = await queueConfirmedBuildPlan({
      companyId: 'company-1',
      planContent: PLAN,
    });

    expect(result?.text).toContain('Queued first 1 CareerOps tasks');
    expect(result?.text).toContain('parked 7 for the next batch');
    expect(handleToolCall).toHaveBeenNthCalledWith(
      1,
      'create_task',
      expect.objectContaining({ title: 'User auth' }),
      'company-1',
    );
    expect(handleToolCall).toHaveBeenNthCalledWith(
      2,
      'create_task',
      expect.objectContaining({
        title: 'Resume upload + parsing',
      }),
      'company-1',
    );
    expect(createTaskDraft).toHaveBeenCalledTimes(7);
    expect(createTaskDraft.mock.calls[0]?.[0]).toMatchObject({
      title: 'User auth',
    });
    const tailoringDraft = createTaskDraft.mock.calls.find(([input]) => input.title === 'Resume tailoring engine')?.[0];
    expect(tailoringDraft).toMatchObject({
      proposed_task: expect.objectContaining({
        related_task_ids: ['task-2'],
        depends_on_plan_indexes: [2],
      }),
    });
  });

  it('does not duplicate a saved plan that already has rolling-plan tasks or drafts', async () => {
    const action = createPendingPlanConfirmationAction(PLAN);
    const planId = action?.data.plan_id ?? 'missing';
    getTasks.mockResolvedValueOnce([
      {
        id: 'existing-task-1',
        status: 'todo',
        title: 'User auth',
        description: null,
        tag: 'engineering',
        estimated_credits: 1,
        priority: 50,
        execution_contract: { rolling_plan: { key: planId, plan_index: 1, total_tasks: 8 } },
      },
    ]);
    getPendingTaskDraftsForSources.mockResolvedValueOnce([
      {
        id: 'existing-draft-6',
        proposed_task: { rolling_plan: { key: planId, plan_index: 6, total_tasks: 8 } },
      },
    ]);

    const result = await queueConfirmedBuildPlan({
      companyId: 'company-1',
      planContent: PLAN,
    });

    expect(result?.text).toContain('already in the rolling queue');
    expect(handleToolCall).not.toHaveBeenCalled();
    expect(createTaskDraft).not.toHaveBeenCalled();
  });

  it('does not intercept unrelated questions', async () => {
    const result = await tryQueueConfirmedBuildPlan({
      companyId: 'company-1',
      message: 'how many credits I need?',
      sessionHistory: [
        { id: 'a1', session_id: 's1', role: 'assistant', content: PLAN, created_at: new Date().toISOString() },
      ],
    });

    expect(result).toBeNull();
  });
});
