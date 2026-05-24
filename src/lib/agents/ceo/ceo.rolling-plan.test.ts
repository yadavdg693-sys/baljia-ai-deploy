import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getTasks, getPendingTaskDraftsForSources, finalizeTaskDraftIds } = vi.hoisted(() => ({
  getTasks: vi.fn(),
  getPendingTaskDraftsForSources: vi.fn(),
  finalizeTaskDraftIds: vi.fn(),
}));

vi.mock('@/lib/services/task.service', () => ({
  getTasks,
}));

vi.mock('@/lib/services/task-draft.service', () => ({
  getPendingTaskDraftsForSources,
  finalizeTaskDraftIds,
}));

describe('CEO rolling plan queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CEO_ROLLING_TASK_LIMIT', '5');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('releases only enough parked drafts to refill the active queue window', async () => {
    getTasks.mockResolvedValue([
      { id: 'active-1', status: 'todo' },
      { id: 'active-2', status: 'todo' },
      { id: 'active-3', status: 'todo' },
      { id: 'active-4', status: 'in_progress' },
      { id: 'done-1', status: 'completed' },
    ]);
    getPendingTaskDraftsForSources.mockResolvedValue([
      { id: 'draft-7', created_at: '2026-05-23T10:07:00.000Z', proposed_task: { rolling_plan: { plan_index: 7 } } },
      { id: 'draft-6', created_at: '2026-05-23T10:06:00.000Z', proposed_task: { rolling_plan: { plan_index: 6 } } },
      { id: 'draft-8', created_at: '2026-05-23T10:08:00.000Z', proposed_task: { rolling_plan: { plan_index: 8 } } },
    ]);
    finalizeTaskDraftIds.mockResolvedValue({ finalized: 1, skipped: [], task_ids: ['released-6'] });

    const { releaseNextRollingPlanBatch, CEO_ROLLING_PLAN_SOURCE } = await import('./ceo.rolling-plan');
    const result = await releaseNextRollingPlanBatch('company-1');

    expect(getPendingTaskDraftsForSources).toHaveBeenCalledWith('company-1', [CEO_ROLLING_PLAN_SOURCE]);
    expect(finalizeTaskDraftIds).toHaveBeenCalledWith(
      'company-1',
      ['draft-6'],
      expect.objectContaining({
        authorizedBy: 'founder',
        authorizationReason: expect.stringContaining('rolling plan'),
      }),
    );
    expect(result).toMatchObject({
      released: 1,
      remaining: 2,
      activeCount: 4,
      limit: 5,
    });
  });

  it('does not release parked drafts when the active queue is already at the cap', async () => {
    getTasks.mockResolvedValue([
      { id: 'active-1', status: 'todo' },
      { id: 'active-2', status: 'todo' },
      { id: 'active-3', status: 'todo' },
      { id: 'active-4', status: 'todo' },
      { id: 'active-5', status: 'in_progress' },
    ]);

    const { releaseNextRollingPlanBatch } = await import('./ceo.rolling-plan');
    const result = await releaseNextRollingPlanBatch('company-1');

    expect(getPendingTaskDraftsForSources).not.toHaveBeenCalled();
    expect(finalizeTaskDraftIds).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      released: 0,
      remaining: 0,
      activeCount: 5,
      limit: 5,
    });
  });

  it('keeps skipped selected drafts in the remaining count', async () => {
    getTasks.mockResolvedValue([
      { id: 'active-1', status: 'todo' },
      { id: 'active-2', status: 'todo' },
      { id: 'active-3', status: 'todo' },
    ]);
    getPendingTaskDraftsForSources.mockResolvedValue([
      { id: 'draft-4', created_at: '2026-05-23T10:04:00.000Z', proposed_task: { rolling_plan: { plan_index: 4 } } },
      { id: 'draft-5', created_at: '2026-05-23T10:05:00.000Z', proposed_task: { rolling_plan: { plan_index: 5 } } },
      { id: 'draft-6', created_at: '2026-05-23T10:06:00.000Z', proposed_task: { rolling_plan: { plan_index: 6 } } },
    ]);
    finalizeTaskDraftIds.mockResolvedValue({
      finalized: 1,
      skipped: [{ draft_id: 'draft-5', reason: 'blocked' }],
      task_ids: ['released-4'],
    });

    const { releaseNextRollingPlanBatch } = await import('./ceo.rolling-plan');
    const result = await releaseNextRollingPlanBatch('company-1');

    expect(result).toMatchObject({
      released: 1,
      skipped: 1,
      remaining: 2,
    });
  });
});
