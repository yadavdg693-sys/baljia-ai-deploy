// Task Service — migrated to Drizzle + Neon
import { db, tasks } from '@/lib/db';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import { stripLlmArtifacts } from '@/lib/text/llm-artifacts';
import { applyTaskLaneCreateDefaults } from '@/lib/agents/task-lane';
import type { Task, TaskSource, ExecutionMode, VerificationLevel } from '@/types';

interface CreateTaskInput {
  company_id: string;
  title: string;
  description?: string;
  tag: string;
  priority?: number;
  source?: TaskSource;
  status?: 'todo';
  queue_order?: number;
  assigned_to_agent_id?: number;
  estimated_credits?: number;
  max_turns?: number;
  suggestion_reasoning?: string;
  execution_mode?: ExecutionMode;
  verification_level?: VerificationLevel;
  executability_type?: 'can_run_now' | 'needs_new_connection' | 'manual_task';
  execution_contract?: Record<string, unknown> | null;
  related_task_ids?: string[];
  authorized_by?: string;
  authorization_reason?: string;
  complexity?: number;          // 1-10 planning metadata (Phase 3b populates for starter tasks)
  estimated_hours?: string | number;  // decimal hours, <= 4 hard cap
}

export type UpdateTaskFields = Partial<Pick<Task,
  'title' | 'description' | 'priority' | 'status' | 'queue_order' |
  'complexity' | 'execution_mode' | 'verification_level' | 'failure_class' |
  'started_at' | 'completed_at' | 'turn_count' | 'actual_credits_charged' |
  'assigned_to_agent_id' | 'authorized_by' | 'authorization_reason' |
  'repair_attempt_count' | 'execution_contract'
>>;

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const taskInput = applyTaskLaneCreateDefaults(input);
  // Atomic queue_order: compute next order inside the INSERT to prevent
  // race conditions where two concurrent inserts read the same MAX.
  const queueOrder = taskInput.queue_order ?? null;

  const estimatedHoursValue = taskInput.estimated_hours !== undefined
    ? String(taskInput.estimated_hours)
    : null;

  // Founder-safety: task fields render on the dashboard as-is. With the
  // narrow phrase-only banlist, soft redaction rarely hits legitimate content
  // — any match is almost certainly a real implementation leak (e.g. "build
  // the product using our Neon DB" instead of "build the product"). Log +
  // redact keeps the leak off the founder's screen while we fix the source.
  //
  // Defense in depth: strip LLM artifacts (**bold**, em-dashes, etc.) AFTER
  // sanitizeForFounder. Most task writes are LLM-sourced (onboarding starter
  // tasks, CEO-proposed tasks, night-shift tasks, recurring tasks). Even
  // founder-typed tasks rarely contain genuine markdown — copy-paste from
  // ChatGPT does. The strip is safe to apply unconditionally here.
  const safeTitle = stripLlmArtifacts(sanitizeForFounder(taskInput.title, {
    mode: 'soft',
    context: { callsite: 'createTask.title', companyId: taskInput.company_id, source: taskInput.source ?? null },
  }).clean);
  const safeDescription = taskInput.description
    ? stripLlmArtifacts(sanitizeForFounder(taskInput.description, {
        mode: 'soft',
        context: { callsite: 'createTask.description', companyId: taskInput.company_id, source: taskInput.source ?? null },
      }).clean, { keepLineStructure: true })
    : null;
  const safeReasoning = taskInput.suggestion_reasoning
    ? stripLlmArtifacts(sanitizeForFounder(taskInput.suggestion_reasoning, {
        mode: 'soft',
        context: { callsite: 'createTask.suggestion_reasoning', companyId: taskInput.company_id, source: taskInput.source ?? null },
      }).clean)
    : null;

  const result = await db.execute(sql`
    INSERT INTO tasks (
      id, company_id, title, description, tag, priority, source, status,
      queue_order, assigned_to_agent_id, estimated_credits, actual_credits_charged,
      max_turns, turn_count, executability_type, suggestion_reasoning,
      execution_mode, verification_level, execution_contract, related_task_ids,
      complexity, estimated_hours, authorized_by, authorization_reason,
      created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      ${taskInput.company_id},
      ${safeTitle},
      ${safeDescription},
      ${taskInput.tag},
      ${taskInput.priority ?? 50},
      ${taskInput.source ?? 'founder_requested'},
      ${taskInput.status ?? 'todo'},
      COALESCE(${queueOrder}::int, COALESCE(
        (SELECT MAX(queue_order) FROM tasks WHERE company_id = ${taskInput.company_id}), 0
      ) + 1),
      ${taskInput.assigned_to_agent_id ?? null}::int,
      ${taskInput.estimated_credits ?? 1},
      0,
      ${taskInput.max_turns ?? 200},
      0,
      ${taskInput.executability_type ?? 'can_run_now'},
      ${safeReasoning},
      ${taskInput.execution_mode ?? null},
      ${taskInput.verification_level ?? null},
      ${JSON.stringify(taskInput.execution_contract ?? null)}::jsonb,
      ${JSON.stringify(taskInput.related_task_ids ?? [])}::jsonb,
      ${taskInput.complexity ?? null}::int,
      ${estimatedHoursValue}::numeric,
      ${taskInput.authorized_by ?? null},
      ${taskInput.authorization_reason ?? null},
      NOW(),
      NOW()
    RETURNING *
  `);

  const rows = result.rows ?? [];
  if (rows.length === 0) throw new Error('Failed to create task');
  return rows[0] as unknown as Task;
}

export async function getTasks(companyId: string): Promise<Task[]> {
  const result = await db.select().from(tasks)
    .where(eq(tasks.company_id, companyId))
    .orderBy(asc(tasks.queue_order));

  // (was `as unknown as unknown as Task[]` — triple cast, code smell, no functional impact)
  return result as unknown as Task[];
}

export async function getTask(taskId: string): Promise<Task | null> {
  const [task] = await db.select().from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  return (task as unknown as Task) ?? null;
}

export function stripTaskInternalFields<T extends { execution_contract?: unknown }>(task: T): Omit<T, 'execution_contract'> {
  const { execution_contract: _executionContract, ...safeTask } = task;
  return safeTask;
}

export async function updateTask(taskId: string, updates: UpdateTaskFields): Promise<Task> {
  // Convert string dates to Date objects for Drizzle
  const drizzleUpdates: Record<string, unknown> = { ...updates, updated_at: new Date() };
  if (typeof drizzleUpdates.started_at === 'string') drizzleUpdates.started_at = new Date(drizzleUpdates.started_at);
  if (typeof drizzleUpdates.completed_at === 'string') drizzleUpdates.completed_at = new Date(drizzleUpdates.completed_at);

  // Defense in depth: same artifact-strip as createTask. Edits via CEO
  // edit_task tool come in here too.
  if (typeof drizzleUpdates.title === 'string') {
    drizzleUpdates.title = stripLlmArtifacts(drizzleUpdates.title as string);
  }
  if (typeof drizzleUpdates.description === 'string') {
    drizzleUpdates.description = stripLlmArtifacts(drizzleUpdates.description as string, { keepLineStructure: true });
  }

  const [task] = await db.update(tasks)
    .set(drizzleUpdates as typeof tasks.$inferInsert)
    .where(eq(tasks.id, taskId))
    .returning();

  if (!task) throw new Error('Failed to update task: not found');
  return task as unknown as Task;
}

/**
 * Mark a task as approved. The actual state transition (todo → in_progress)
 * and credit deduction happen inside worker-launcher.launchTask().
 * This just records the authorization — callers should call launchTask() after.
 */
export async function approveTask(taskId: string): Promise<Task> {
  return updateTask(taskId, {
    authorized_by: 'founder',
    authorization_reason: 'Founder approved task for execution',
  });
}

export async function rejectTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: 'rejected' });
}

/**
 * Retry a failed/failed_permanent task by resetting it to todo.
 * Only accepts tasks in terminal failure states.
 */
export async function retryTask(taskId: string): Promise<Task> {
  const task = await getTask(taskId);
  if (!task) throw new Error('Task not found');

  const retryableStatuses = ['failed', 'failed_permanent'];
  if (!retryableStatuses.includes(task.status)) {
    throw new Error(`Cannot retry task in "${task.status}" status`);
  }

  return updateTask(taskId, {
    status: 'todo',
    failure_class: null,
    started_at: null,
    completed_at: null,
    turn_count: 0,
    actual_credits_charged: 0,
    repair_attempt_count: (task.repair_attempt_count ?? 0) + 1,
  });
}

/**
 * Atomically claim a task for execution.
 * Uses WHERE status='todo' to prevent double-launch race conditions.
 * Returns null if the task was already claimed by another process.
 */
export async function startTask(taskId: string): Promise<Task> {
  const [task] = await db.update(tasks)
    .set({
      status: 'in_progress',
      started_at: new Date(),
      updated_at: new Date(),
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'todo')))
    .returning();

  if (!task) throw new Error(`Task ${taskId} could not be claimed (not in todo status or already started)`);
  return task as unknown as Task;
}

/**
 * Transition task to 'verifying' after worker execution completes.
 * The verifier (verification.service.ts) is the sole authority for
 * setting the final status to 'completed' or 'failed'.
 */
export async function completeTask(taskId: string): Promise<Task> {
  return updateTask(taskId, { status: 'verifying' });
}

/**
 * Called ONLY by the verification service to set final task status.
 * This is the sole authority for marking a task as completed or failed
 * after verification (SPEC-CTRL-106: worker is NOT the final authority).
 */
export async function finalizeTask(taskId: string, passed: boolean): Promise<Task> {
  return updateTask(taskId, {
    status: passed ? 'completed' : 'failed',
    failure_class: passed ? null : 'verification_reject',
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
