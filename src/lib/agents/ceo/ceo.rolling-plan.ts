import type { Task } from '@/types';
import * as taskService from '@/lib/services/task.service';
import * as taskDraftService from '@/lib/services/task-draft.service';
import { getCeoRollingTaskLimit } from './ceo.loop-config';

export const CEO_ROLLING_PLAN_SOURCE = 'ceo_rolling_plan' as const;

const ACTIVE_QUEUE_STATUSES = new Set([
  'todo',
  'in_progress',
  'verifying',
  'repair',
  'blocked_pre_start',
  'blocked_in_run',
]);

type DraftRow = Awaited<ReturnType<typeof taskDraftService.getPendingTaskDraftsForSources>>[number];

export interface RollingPlanReleaseResult {
  released: number;
  skipped: number;
  remaining: number;
  activeCount: number;
  limit: number;
}

export function activeQueueCount(tasks: Array<Pick<Task, 'status'> | { status?: string | null }>): number {
  return tasks.filter((task) => ACTIVE_QUEUE_STATUSES.has(String(task.status ?? ''))).length;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function rollingPlanIndex(draft: DraftRow): number {
  const proposed = objectValue(draft.proposed_task);
  const rolling = objectValue(proposed.rolling_plan);
  return numberValue(rolling.plan_index);
}

function createdAtMs(draft: DraftRow): number {
  const raw = draft.created_at;
  const value = raw ? new Date(raw).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export async function releaseNextRollingPlanBatch(companyId: string): Promise<RollingPlanReleaseResult> {
  const limit = getCeoRollingTaskLimit();
  const activeCount = activeQueueCount(await taskService.getTasks(companyId));
  const availableSlots = Math.max(0, limit - activeCount);

  if (availableSlots === 0) {
    return { released: 0, skipped: 0, remaining: 0, activeCount, limit };
  }

  const drafts = await taskDraftService.getPendingTaskDraftsForSources(companyId, [CEO_ROLLING_PLAN_SOURCE]);
  if (drafts.length === 0) {
    return { released: 0, skipped: 0, remaining: 0, activeCount, limit };
  }

  const orderedDrafts = [...drafts].sort((a, b) => {
    const byCreated = createdAtMs(a) - createdAtMs(b);
    if (byCreated !== 0) return byCreated;
    return rollingPlanIndex(a) - rollingPlanIndex(b);
  });
  const selected = orderedDrafts.slice(0, availableSlots);

  const result = await taskDraftService.finalizeTaskDraftIds(
    companyId,
    selected.map((draft) => draft.id),
    {
      authorizedBy: 'founder',
      authorizationReason: 'CEO rolling plan released the next batch after active queue capacity opened.',
    },
  );

  return {
    released: result.finalized,
    skipped: result.skipped.length,
    remaining: Math.max(0, drafts.length - result.finalized),
    activeCount,
    limit,
  };
}
