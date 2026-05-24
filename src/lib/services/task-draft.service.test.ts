import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectRows,
  updateRows,
  createTask,
  emit,
} = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updateRows: [] as unknown[][],
  createTask: vi.fn(),
  emit: vi.fn(),
}));

function nextRows(queue: unknown[][]): unknown[] {
  return queue.shift() ?? [];
}

function selectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(async () => rows),
    limit: vi.fn(async () => rows),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

function updateChain(rows: unknown[]) {
  const chain = {
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(async () => rows),
  };
  return chain;
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => selectChain(nextRows(selectRows))),
    update: vi.fn(() => updateChain(nextRows(updateRows))),
  },
  taskDrafts: {
    id: 'taskDrafts.id',
    company_id: 'taskDrafts.company_id',
    status: 'taskDrafts.status',
    source: 'taskDrafts.source',
    reviewed_task_id: 'taskDrafts.reviewed_task_id',
    proposed_task: 'taskDrafts.proposed_task',
    created_at: 'taskDrafts.created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ __op: 'and', conds })),
  desc: vi.fn((col: unknown) => ({ __op: 'desc', col })),
  inArray: vi.fn((col: unknown, values: unknown[]) => ({ __op: 'inArray', col, values })),
  isNotNull: vi.fn((col: unknown) => ({ __op: 'isNotNull', col })),
}));

vi.mock('@/lib/services/task.service', () => ({
  createTask,
}));

vi.mock('@/lib/services/event.service', () => ({
  emit,
}));

vi.mock('@/lib/services/router.service', () => ({
  routeTaskStrict: vi.fn(() => 30),
}));

vi.mock('@/lib/agents/execution-contract', () => ({
  requiresExecutionContractForEngineering: vi.fn(() => false),
  validateExecutionContract: vi.fn(() => ({ ok: true, contract: {} })),
}));

vi.mock('@/lib/founder-safety/sanitize', () => ({
  sanitizeForFounder: (value: string) => ({ clean: value }),
}));

vi.mock('@/lib/text/llm-artifacts', () => ({
  stripLlmArtifacts: (value: string) => value,
}));

describe('task draft finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    updateRows.length = 0;
  });

  it('resolves parked rolling-plan dependencies to already finalized task ids', async () => {
    const draft = {
      id: 'draft-7',
      company_id: 'company-1',
      title: 'Application dashboard',
      description: 'Track applications.',
      tag: 'engineering',
      priority: 50,
      source: 'ceo_rolling_plan',
      status: 'pending_ceo_review',
      proposed_task: {
        estimated_hours: 4,
        depends_on_plan_indexes: [6],
        rolling_plan: { key: 'careerops-plan', plan_index: 7, total_tasks: 8 },
      },
      proposed_execution_contract: { version: 1 },
    };
    selectRows.push(
      [draft],
      [
        {
          reviewed_task_id: 'task-6',
          proposed_task: {
            rolling_plan: { key: 'careerops-plan', plan_index: 6, total_tasks: 8 },
          },
        },
        {
          reviewed_task_id: 'other-plan-task',
          proposed_task: {
            rolling_plan: { key: 'other-plan', plan_index: 6, total_tasks: 8 },
          },
        },
      ],
    );
    updateRows.push([{ ...draft, status: 'finalized', reviewed_task_id: 'task-7' }]);
    createTask.mockResolvedValueOnce({
      id: 'task-7',
      company_id: 'company-1',
      title: 'Application dashboard',
      tag: 'engineering',
    });
    emit.mockResolvedValueOnce({});

    const { finalizeTaskDraftIds } = await import('./task-draft.service');
    const result = await finalizeTaskDraftIds('company-1', ['draft-7'], {
      authorizedBy: 'founder',
      authorizationReason: 'rolling plan',
    });

    expect(result).toEqual({ finalized: 1, skipped: [], task_ids: ['task-7'] });
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({
      related_task_ids: ['task-6'],
    }));
  });
});
