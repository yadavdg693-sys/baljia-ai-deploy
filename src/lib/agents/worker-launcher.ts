// Worker Launcher — takes approved tasks and runs the right agent
// Architecture: Domain 5.4 "1 task = 1 credit, deducted at start_task"
// Sequential execution per company (no parallel)
//
// FIXES APPLIED:
// - G-BILL-001: Lifecycle check before execution
// - C-TASK-001: Persist TaskExecution to DB
// - C-TASK-005: Double-execution prevention (status recheck)
// - H-AGENT-011: failure_class copy-paste bug (was always 'worker_failure')
// - G-EXEC-001: Execution timeout via AbortController
// - H-AGENT-017: Retry circuit breaker (max 2 retries tracked)

import * as taskService from '@/lib/services/task.service';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import { routeTask, getAgentName } from '@/lib/services/router.service';
import { verifyAndUpdate } from '@/lib/services/verification.service';
import { processTaskLearnings } from '@/lib/services/memory.service';
import { remediateFailed } from '@/lib/services/remediation.service';
import { checkAndUpgrade } from '@/lib/services/stage.service';
import { executeAgent } from './agent-factory';
import { Watchdog } from './watchdog';
import { db, companies, tasks as tasksTable, taskExecutions } from '@/lib/db';
import { eq, and, gte, inArray, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { TaskExecution, Lifecycle } from '@/types';

const log = createLogger('Worker');

// Max execution time per task (prevents indefinite hangs: G-EXEC-001)
const MAX_EXECUTION_MS = 10 * 60 * 1000; // 10 minutes

// Max retries for auto-remediation (H-AGENT-017 circuit breaker)
const MAX_AUTO_RETRIES = 2;

// Lifecycle states that allow task execution (G-BILL-001)
const ACTIVE_LIFECYCLES: Lifecycle[] = ['trial_active', 'full_active', 'keep_live_active'];

// ══════════════════════════════════════════════
// LAUNCH — picks up a todo task and runs it
// ══════════════════════════════════════════════

export async function launchTask(taskId: string): Promise<TaskExecution> {
  const task = await taskService.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // C-TASK-005: Re-check status to prevent double execution
  if (task.status !== 'todo') {
    throw new Error(`Task ${taskId} is not in todo status (currently: ${task.status})`);
  }

  // G-BILL-001: Check company lifecycle before execution
  const [company] = await db.select({ lifecycle: companies.lifecycle, execution_state: companies.execution_state })
    .from(companies).where(eq(companies.id, task.company_id)).limit(1);

  if (!company) throw new Error(`Company not found for task ${taskId}`);

  if (!ACTIVE_LIFECYCLES.includes(company.lifecycle as Lifecycle)) {
    throw new Error(
      `Company lifecycle '${company.lifecycle}' does not allow task execution. ` +
      `Allowed states: ${ACTIVE_LIFECYCLES.join(', ')}`
    );
  }

  if (company.execution_state === 'suspended') {
    throw new Error('Company execution is suspended');
  }

  // H-AGENT-017: Circuit breaker — check retry count for auto-remediation tasks
  if (task.source === 'auto_remediation') {
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.company_id, task.company_id),
        eq(tasksTable.source, 'auto_remediation'),
        inArray(tasksTable.status, ['failed', 'in_progress', 'todo']),
        gte(tasksTable.created_at, new Date(Date.now() - 24 * 60 * 60 * 1000))
      ));

    const count = countResult?.count ?? 0;

    if ((count ?? 0) >= MAX_AUTO_RETRIES) {
      await taskService.updateTask(taskId, { status: 'blocked' });
      throw new Error(
        `Auto-remediation circuit breaker: ${count} retries in last 24h (max ${MAX_AUTO_RETRIES}). ` +
        `Task blocked to prevent credit drain.`
      );
    }
  }

  // 1. Route to correct agent
  const agentId = routeTask(task.tag);
  const agentName = getAgentName(agentId);

  log.info('Launching task', { taskId, title: task.title, agent: agentName, agentId });

  // 2. Deduct credit (Domain 5.4: charge at start_task)
  const hasCredit = await creditService.deductCredit(
    task.company_id,
    task.estimated_credits,
    task.id,
    `Task: ${task.title}`
  );

  if (!hasCredit) {
    await taskService.updateTask(taskId, { status: 'blocked' });
    await eventService.emit(task.company_id, 'task_failed', {
      task_id: taskId,
      title: task.title,
      reason: 'Insufficient credits',
    });
    throw new Error(`Insufficient credits for task "${task.title}"`);
  }

  // 3. Start task
  const startedTask = await taskService.startTask(taskId);
  await taskService.updateTask(taskId, { assigned_to_agent_id: agentId });

  await eventService.emit(task.company_id, 'task_started', {
    task_id: taskId,
    title: task.title,
    agent: agentName,
    agent_id: agentId,
  });

  // 4. Create watchdog
  const watchdog = new Watchdog(taskId, task.max_turns, task.company_id);

  const executionStartTime = Date.now();

  // 5. Create execution record aligned with DB schema
  const execution: TaskExecution = {
    id: crypto.randomUUID(),
    task_id: taskId,
    agent_id: agentId,
    execution_mode: task.execution_mode ?? 'full_agent',
    status: 'running',
    turn_count: 0,
    max_turns: task.max_turns,
    started_at: new Date().toISOString(),   // B5 FIX: consistent ISOString
    completed_at: null,
    wall_clock_seconds: null,
    token_usage: null,
    error_summary: null,
    watchdog_events: null,
    verification_evidence: null,
    execution_log: null,
    created_at: new Date().toISOString(),   // B5 FIX: consistent ISOString
  };

  // C-TASK-001: Persist execution start to DB immediately
  await db.insert(taskExecutions).values({
    id: execution.id,
    task_id: execution.task_id,
    agent_id: execution.agent_id,
    execution_mode: execution.execution_mode,
    status: 'running',
    turn_count: 0,
    max_turns: execution.max_turns,
    started_at: new Date(execution.started_at!),
  });

  try {
    // G-EXEC-001: Execute with timeout
    const result = await Promise.race([
      executeAgent({
        task: startedTask,
        agentId,
        agentName,
        watchdog,
        execution,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Task execution timed out after ${MAX_EXECUTION_MS / 1000}s`)),
          MAX_EXECUTION_MS
        )
      ),
    ]);

    // 6. Complete task
    const wallClockSeconds = Math.round((Date.now() - executionStartTime) / 1000);
    execution.status = 'completed';
    execution.completed_at = new Date().toISOString();
    execution.turn_count = result.turnCount;
    execution.execution_log = result.log;
    execution.wall_clock_seconds = wallClockSeconds;

    await taskService.completeTask(taskId, false);
    await taskService.updateTask(taskId, {
      turn_count: result.turnCount,
      actual_credits_charged: task.estimated_credits,
    });

    await eventService.emit(task.company_id, 'task_completed', {
      task_id: taskId,
      title: task.title,
      agent: agentName,
      turns: result.turnCount,
    });

    // 7. Run verification
    try {
      const verification = await verifyAndUpdate(taskId);
      execution.verification_evidence = verification as unknown as Record<string, unknown>;
      log.info('Task verification', { taskId, passed: verification.passed, level: verification.level });
    } catch (verifyError) {
      log.error('Verification failed', { taskId, title: task.title }, verifyError);
    }

    // 8. Extract learnings
    try {
      const learned = await processTaskLearnings(taskId);
      if (learned > 0) log.info('Extracted learnings', { taskId, title: task.title, learned });
    } catch { /* non-blocking */ }

    // 9. Check stage progression
    try {
      const newStage = await checkAndUpgrade(task.company_id);
      log.info('Company stage updated', { companyId: task.company_id, stage: newStage });
    } catch { /* non-blocking */ }

    log.info('Task completed', { taskId, title: task.title, turns: result.turnCount, wallClockSeconds });

  } catch (error) {
    // Task failed
    const wallClockSeconds = Math.round((Date.now() - executionStartTime) / 1000);
    execution.status = 'failed';
    execution.completed_at = new Date().toISOString();
    execution.wall_clock_seconds = wallClockSeconds;
    execution.error_summary = error instanceof Error ? error.message : 'Unknown error';
    execution.watchdog_events = watchdog.getEvents() as unknown as Record<string, unknown>[];

    // H-AGENT-011: FIX — classify failure based on watchdog state
    // Was: always 'worker_failure' regardless of watchdog state (copy-paste bug)
    const failureClass = watchdog.wasKilled()
      ? 'worker_failure' as const      // Agent was killed by watchdog
      : determineFailureClass(execution.error_summary);

    // Check if timed out
    if (execution.error_summary.includes('timed out')) {
      execution.status = 'timed_out';
    }

    await taskService.failTask(taskId, failureClass);

    await eventService.emit(task.company_id, 'task_failed', {
      task_id: taskId,
      title: task.title,
      agent: agentName,
      error: execution.error_summary,
      failure_class: failureClass,
    });

    // Auto-remediation (only if circuit breaker allows)
    if (task.source !== 'auto_remediation') {
      try {
        const remediation = await remediateFailed(taskId);
        log.info('Remediation triggered', { taskId, strategy: remediation.strategy, reason: remediation.reason });
      } catch { /* non-blocking */ }
    }

    log.error('Task failed', { taskId, title: task.title, failureClass, error: execution.error_summary });
  }

  // C-TASK-001: Persist final execution state to DB
  try {
    await db.update(taskExecutions)
      .set({
        status: execution.status,
        turn_count: execution.turn_count,
        completed_at: execution.completed_at ? new Date(execution.completed_at) : null,
        wall_clock_seconds: execution.wall_clock_seconds,
        token_usage: execution.token_usage,
        error_summary: execution.error_summary,
        watchdog_events: execution.watchdog_events,
        verification_evidence: execution.verification_evidence,
        execution_log: execution.execution_log,
      })
      .where(eq(taskExecutions.id, execution.id));
  } catch (persistError) {
    log.error('Failed to persist execution', { taskId }, persistError);
  }

  return execution;
}

// ══════════════════════════════════════════════
// FAILURE CLASSIFICATION (H-AGENT-011)
// ══════════════════════════════════════════════

function determineFailureClass(errorMessage: string): 'founder_ambiguity' | 'missing_prerequisite' | 'platform_scoping' | 'worker_failure' | 'external_dependency' {
  const msg = errorMessage.toLowerCase();

  if (msg.includes('timed out') || msg.includes('timeout')) return 'worker_failure';
  if (msg.includes('credential') || msg.includes('api key') || msg.includes('auth')) return 'missing_prerequisite';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) return 'external_dependency';
  if (msg.includes('too large') || msg.includes('scope') || msg.includes('split')) return 'platform_scoping';
  if (msg.includes('unclear') || msg.includes('ambiguous') || msg.includes('specify')) return 'founder_ambiguity';

  return 'worker_failure';
}

// ══════════════════════════════════════════════
// QUEUE PROCESSOR — processes todo tasks for a company
// Sequential: one at a time per Domain 5.4
// ══════════════════════════════════════════════

export async function processQueue(companyId: string): Promise<number> {
  const tasks = await taskService.getTasks(companyId);
  const todoTasks = tasks
    .filter((t) => t.status === 'todo')
    .sort((a, b) => (a.queue_order ?? 999) - (b.queue_order ?? 999));

  // C-TASK-005: Check if anything is already running
  const running = tasks.find((t) => t.status === 'in_progress');
  if (running) {
    log.info('Company has running task, skipping queue', { companyId, runningTask: running.title });
    return 0;
  }

  if (todoTasks.length === 0) {
    return 0;
  }

  const nextTask = todoTasks[0];
  log.info('Processing next task in queue', { companyId, title: nextTask.title });

  try {
    await launchTask(nextTask.id);
    return 1;
  } catch (error) {
    log.error('Queue processing failed', { companyId, title: nextTask.title }, error);
    return 0;
  }
}

export { launchTask as launch, processQueue as process };
