// Recurring Task Scheduler — migrated to Drizzle + Neon
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { createTaskDraft } from '@/lib/services/task-draft.service';
import { routeTaskStrict } from '@/lib/services/router.service';
import { engineeringContractBlockReason } from '@/lib/agents/execution-contract';
import { db, recurringTasks } from '@/lib/db';
import { eq, and, lte, asc } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { RecurringTask } from '@/types';

const log = createLogger('Recurring');

function getNextRunDate(cadence: RecurringTask['cadence'], from: Date = new Date()): Date {
  const next = new Date(from);
  switch (cadence) {
    case 'daily':    next.setDate(next.getDate() + 1); break;
    case 'weekly':   next.setDate(next.getDate() + 7); break;
    case 'biweekly': next.setDate(next.getDate() + 14); break;
    case 'monthly':  next.setMonth(next.getMonth() + 1); break;
  }
  return next;
}

function getMonthlyEstimate(cadence: RecurringTask['cadence']): number {
  switch (cadence) {
    case 'daily':    return 30;
    case 'weekly':   return 4;
    case 'biweekly': return 2;
    case 'monthly':  return 1;
  }
}

export async function createRecurring(input: {
  company_id: string;
  title: string;
  description?: string;
  tag: string;
  cadence: RecurringTask['cadence'];
}): Promise<RecurringTask> {
  const [data] = await db.insert(recurringTasks).values({
    company_id: input.company_id,
    title: input.title,
    description: input.description ?? null,
    tag: input.tag,
    cadence: input.cadence,
    monthly_credits_estimate: getMonthlyEstimate(input.cadence),
    next_run_at: getNextRunDate(input.cadence),
    is_active: true,
  }).returning();

  return data as unknown as RecurringTask;
}

export async function getRecurringTasks(companyId: string): Promise<RecurringTask[]> {
  return db.select().from(recurringTasks)
    .where(eq(recurringTasks.company_id, companyId))
    .orderBy(asc(recurringTasks.next_run_at)) as unknown as Promise<RecurringTask[]>;
}

export async function toggleRecurring(recurringId: string, active: boolean): Promise<void> {
  await db.update(recurringTasks)
    .set({ is_active: active })
    .where(eq(recurringTasks.id, recurringId));
}

export async function deleteRecurring(recurringId: string, companyId?: string): Promise<void> {
  const conditions = [eq(recurringTasks.id, recurringId)];
  if (companyId) conditions.push(eq(recurringTasks.company_id, companyId));

  await db.delete(recurringTasks).where(and(...conditions));
}

export async function processDueRecurring(companyId: string): Promise<number> {
  const now = new Date();

  const dueTasks = await db.select().from(recurringTasks)
    .where(and(
      eq(recurringTasks.company_id, companyId),
      eq(recurringTasks.is_active, true),
      lte(recurringTasks.next_run_at, now)
    ));

  if (!dueTasks.length) return 0;

  let created = 0;

  for (const recurring of dueTasks as unknown as unknown as RecurringTask[]) {
    try {
      let visibleTaskCreated = false;
      const description = recurring.description ?? `Recurring ${recurring.cadence} task`;
      const agentId = routeTaskStrict(recurring.tag);
      const contractBlockReason = agentId === null
        ? `Unknown recurring task tag "${recurring.tag}".`
        : engineeringContractBlockReason({
            title: recurring.title,
            description,
            tag: recurring.tag,
            source: 'recurring',
            assigned_to_agent_id: agentId,
          }, agentId);

      if (agentId === null || contractBlockReason) {
        await createTaskDraft({
          company_id: companyId,
          title: recurring.title,
          description,
          tag: recurring.tag,
          priority: 30,
          source: 'recurring',
          status: 'pending_ceo_review',
          suggestion_reasoning: contractBlockReason,
          proposed_task: {
            cadence: recurring.cadence,
            queue_order: 500,
            estimated_credits: 1,
            max_turns: 200,
            executability_type: 'can_run_now',
          },
        });
      } else {
        await taskService.createTask({
          company_id: companyId,
          title: recurring.title,
          description,
          tag: recurring.tag,
          priority: 30,
          source: 'recurring',
          status: 'todo',
          queue_order: 500,
          estimated_credits: 1,
          max_turns: 200,
          executability_type: 'can_run_now',
        });
        visibleTaskCreated = true;
      }

      await db.update(recurringTasks)
        .set({ next_run_at: getNextRunDate(recurring.cadence), last_run_at: now })
        .where(eq(recurringTasks.id, recurring.id));

      created++;

      if (visibleTaskCreated) {
        await eventService.emit(companyId, 'task_created', {
          title: recurring.title,
          source: 'recurring',
          cadence: recurring.cadence,
        });
      }
    } catch (error) {
      log.error('Failed to create recurring instance', { title: recurring.title }, error);
    }
  }

  log.info('Recurring tasks created', { companyId, created });
  return created;
}

export async function getMonthlyBudgetEstimate(companyId: string): Promise<{
  recurring_credits: number;
  tasks: Array<{ title: string; cadence: string; monthly_credits: number }>;
  warning: string | null;
}> {
  const recurring = await getRecurringTasks(companyId);
  const active = recurring.filter((r) => r.is_active);

  let total = 0;
  const tasks = active.map((r) => {
    const monthly = getMonthlyEstimate(r.cadence);
    total += monthly;
    return { title: r.title, cadence: r.cadence, monthly_credits: monthly };
  });

  let warning: string | null = null;
  if (total > 25) {
    warning = `⚠️ Recurring tasks will consume ~${total} credits/month. Consider reducing daily tasks to weekly.`;
  } else if (total > 15) {
    warning = `Recurring tasks use ~${total} credits/month. Monitor your credit balance.`;
  }

  return { recurring_credits: total, tasks, warning };
}
