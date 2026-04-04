// Task Service — migrated to Drizzle + Neon
import { db, tasks } from '@/lib/db';
import { eq, asc, desc, sql } from 'drizzle-orm';
import type { Task, TaskSource, ExecutionMode, VerificationLevel } from '@/types';

interface CreateTaskInput {
  company_id: string;
  title: string;
  description?: string;
  tag: string;
  priority?: number;
  source?: TaskSource;
  status?: 'created' | 'todo';
  queue_order?: number;
  assigned_to_agent_id?: number;
  estimated_credits?: number;
  max_turns?: number;
  suggestion_reasoning?: string;
  execution_mode?: ExecutionMode;
  verification_level?: VerificationLevel;
  executability_type?: 'can_run_now' | 'needs_new_connection' | 'manual_task';
  related_task_ids?: string[];
}

export type UpdateTaskFields = Partial<Pick<Task,
  'title' | 'description' | 'priority' | 'status' | 'queue_order' |
  'complexity' | 'execution_mode' | 'verification_level' | 'failure_class' |
  'started_at' | 'completed_at' | 'turn_count' | 'actual_credits_charged' |
  'assigned_to_agent_id'
>>;

export async function createTask(input: CreateTaskInput): Promise<Task> {
  // Get next queue order
  const maxRow = await db.select({ queue_order: tasks.queue_order })
    .from(tasks)
    .where(eq(tasks.company_id, input.company_id))
    .orderBy(desc(tasks.queue_order))
    .limit(1);

  const nextOrder = ((maxRow[0]?.queue_order) ?? 0) + 1;

  const [task] = await db.insert(tasks).values({
    company_id: input.company_id,
    title: input.title,
    description: input.description ?? null,
    tag: input.tag,
    priority: input.priority ?? 50,
    source: input.source ?? 'founder_requested',
    status: input.status ?? 'created',
    queue_order: input.queue_order ?? nextOrder,
    assigned_to_agent_id: input.assigned_to_agent_id ?? null,
    estimated_credits: input.estimated_credits ?? 1,
    actual_credits_charged: 0,
    max_turns: input.max_turns ?? 200,
    turn_count: 0,
    executability_type: input.executability_type ?? 'can_run_now',
    suggestion_reasoning: input.suggestion_reasoning ?? null,
    execution_mode: input.execution_mode ?? null,
    verification_level: input.verification_level ?? null,
    related_task_ids: JSON.stringify(input.related_task_ids ?? []),
  }).returning();

  return task as unknown as Task;
}

export async function getTasks(companyId: string): Promise<Task[]> {
  const result = await db.select().from(tasks)
    .where(eq(tasks.company_id, companyId))
    .orderBy(asc(tasks.queue_order));

  return result as unknown as unknown as Task[];
}

export async function getTask(taskId: string): Promise<Task | null> {
  const [task] = await db.select().from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  return (task as unknown as Task) ?? null;
}

export async function updateTask(taskId: string, updates: UpdateTaskFields): Promise<Task> {
  // Convert string dates to Date objects for Drizzle
  const drizzleUpdates: Record<string, unknown> = { ...updates, updated_at: new Date() };
  if (typeof drizzleUpdates.started_at === 'string') drizzleUpdates.started_at = new Date(drizzleUpdates.started_at);
  if (typeof drizzleUpdates.completed_at === 'string') drizzleUpdates.completed_at = new Date(drizzleUpdates.completed_at);

  const [task] = await db.update(tasks)
    .set(drizzleUpdates as typeof tasks.$inferInsert)
    .where(eq(tasks.id, taskId))
    .returning();

  if (!task) throw new Error('Failed to update task: not found');
  return task as unknown as Task;
}

export async function approveTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: 'todo' });
}

export async function rejectTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: 'rejected' });
}

export async function startTask(taskId: string): Promise<Task> {
  return updateTask(taskId, {
    status: 'in_progress',
    started_at: new Date().toISOString(),
  });
}

export async function completeTask(taskId: string, verified: boolean): Promise<Task> {
  return updateTask(taskId, {
    status: verified ? 'completed_verified' : 'completed_unverified',
    completed_at: new Date().toISOString(),
  });
}

export async function failTask(taskId: string, failureClass: Task['failure_class']): Promise<Task> {
  return updateTask(taskId, {
    status: 'failed',
    failure_class: failureClass,
    completed_at: new Date().toISOString(),
  });
}
