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
import { processTaskLearnings, buildContextPacket } from '@/lib/services/memory.service';
import { buildPermissionSnapshot } from '@/lib/services/governance.service';
import { remediateFailed } from '@/lib/services/remediation.service';
import { checkAutoResolve } from '@/lib/services/failure.service';
import { canExecuteTask } from '@/lib/services/guardrail.service';
import { executeAgent } from './agent-factory';
import { executeDeterministic } from './deterministic-executor';
import { executeTemplate } from './template-executor';
import type { AgentInput, AgentResult } from './agent-factory';
import { Watchdog } from './watchdog';
import { getCostCeilingForAgent } from './cost-ceilings';
import { preflightCheck, formatPreflightFailures } from '@/lib/services/preflight.service';
import { db, companies, tasks as tasksTable, taskExecutions } from '@/lib/db';
import { eq, and, gte, inArray, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { TaskExecution, Lifecycle } from '@/types';

const log = createLogger('Worker');

// Max execution time per task (prevents indefinite hangs: G-EXEC-001)
// Spec SPEC-CTRL-001: absolute time limit is 4 hours
const MAX_EXECUTION_MS = 4 * 60 * 60 * 1000; // 4 hours

// Max retries for auto-remediation (H-AGENT-017 circuit breaker)
const MAX_AUTO_RETRIES = 2;

// Lifecycle states that allow task execution (G-BILL-001, Audit #5)
// keep_live_active is post-cancellation grace — no new execution.
const ACTIVE_LIFECYCLES: Lifecycle[] = ['trial_active', 'full_active'];

// ══════════════════════════════════════════════
// LAUNCH — picks up a todo task and runs it
// ══════════════════════════════════════════════

export interface LaunchOptions {
  /**
   * When true, skip credit_ledger deduction — execution is funded by the
   * subscription's night_shift allowance rather than founder credits.
   * Slot-busy and task-status checks still apply.
   */
  subscriptionFunded?: boolean;
}

export async function launchTask(taskId: string, opts: LaunchOptions = {}): Promise<TaskExecution> {
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

  // Guardrail response ladder check (now async — reads from DB on cold start)
  const guardrailCheck = await canExecuteTask(task.company_id, task.priority);
  if (!guardrailCheck.allowed) {
    await taskService.updateTask(taskId, { status: 'blocked_pre_start' });
    throw new Error(`Guardrail blocked: ${guardrailCheck.reason}`);
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
      await taskService.updateTask(taskId, { status: 'blocked_pre_start' });
      throw new Error(
        `Auto-remediation circuit breaker: ${count} retries in last 24h (max ${MAX_AUTO_RETRIES}). ` +
        `Task blocked to prevent runaway loops.`
      );
    }
  }

  // 1. Route to correct agent
  const agentId = routeTask(task.tag);
  const agentName = getAgentName(agentId);

  log.info('Launching task', { taskId, title: task.title, agent: agentName, agentId });

  // PREFLIGHT: For engineering tasks, verify all required external creds are
  // healthy BEFORE claiming a slot or charging credits. Stale GitHub tokens,
  // missing Render keys, and unreachable Neon connections used to waste
  // entire 200-turn runs before discovery. Fail loud, fail cheap.
  if (agentId === 30) {
    const preflight = await preflightCheck();
    if (!preflight.ok) {
      const reason = formatPreflightFailures(preflight.failures);
      await taskService.updateTask(taskId, { status: 'failed' });
      await eventService.emit(task.company_id, 'task_failed', {
        task_id: taskId,
        title: task.title,
        reason,
      });
      throw new Error(reason);
    }
  }

  // ATOMIC: Claim slot (+ deduct credit for founder-funded runs) in one SQL
  // statement. Night-shift cycles are subscription-funded, so they skip the
  // credit_ledger deduction and use claimSlotOnly instead.
  const claimResult = opts.subscriptionFunded
    ? await creditService.claimSlotOnly({
        companyId: task.company_id,
        taskId: task.id,
      })
    : await creditService.claimSlotAndCharge({
        companyId: task.company_id,
        taskId: task.id,
        amount: task.estimated_credits,
        description: `Task: ${task.title}`,
      });

  if (!claimResult.success) {
    const reasonMap: Record<string, string> = {
      slot_occupied: 'Company already has an active execution. Night shift and manual share one slot.',
      insufficient_credits: `Insufficient credits for task "${task.title}"`,
      daily_cap: 'Daily spend cap reached',
      task_not_todo: `Task ${taskId} is not in todo status or already claimed`,
    };
    const reason = claimResult.reason ?? 'task_not_todo';

    if (reason === 'insufficient_credits' || reason === 'daily_cap') {
      await eventService.emit(task.company_id, 'task_failed', {
        task_id: taskId,
        title: task.title,
        reason: reasonMap[reason],
      });
    }
    throw new Error(reasonMap[reason] ?? `Claim failed: ${reason}`);
  }

  // Ensure execution authorization lineage is recorded (Audit #2).
  // If no authorization was set before launch, infer from task source.
  if (!task.authorized_by) {
    const sourceToAuth: Record<string, string> = {
      night_shift_generated: 'night_shift',
      auto_remediation: 'remediation',
      recurring: 'recurring',
      onboarding: 'system',
    };
    const inferredAuth = sourceToAuth[task.source] ?? 'founder';
    await taskService.updateTask(taskId, {
      authorized_by: inferredAuth,
      authorization_reason: `Inferred from source "${task.source}" at launch time`,
    });
  }

  // Task is now in_progress and credit is deducted — assign agent
  const startedTask = await taskService.updateTask(taskId, { assigned_to_agent_id: agentId });

  await eventService.emit(task.company_id, 'task_started', {
    task_id: taskId,
    title: task.title,
    agent: agentName,
    agent_id: agentId,
  });

  // 4. Create watchdog with active monitoring + per-agent cost ceiling.
  // The ceiling is a backstop against runaway token spend; the agent also
  // sees the live budget summary in its per-turn context so it can self-pace.
  const costCeilingUsd = getCostCeilingForAgent(agentId, task.complexity);
  const watchdog = new Watchdog(taskId, task.max_turns, task.company_id, costCeilingUsd);
  const abortController = new AbortController();
  watchdog.startActiveMonitor(() => {
    abortController.abort();
  });

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

  // Phase 2: Build typed context objects (SPEC-CTRL-105)
  // These provide structured execution context and permission boundaries.
  // Non-blocking: if context assembly fails, we still proceed with execution.
  let contextPacket: Awaited<ReturnType<typeof buildContextPacket>> | undefined;
  let permissionSnapshot: ReturnType<typeof buildPermissionSnapshot> | undefined;
  try {
    contextPacket = await buildContextPacket(task.company_id, {
      id: task.id,
      title: task.title,
      tag: task.tag,
      description: task.description,
    });
    permissionSnapshot = buildPermissionSnapshot(task, agentId);
    log.info('Context assembled', {
      taskId,
      memoryLayers: Object.keys(contextPacket.memory_layers).length,
      priorReports: contextPacket.prior_reports.length,
      failureFingerprints: contextPacket.failure_fingerprints.length,
      riskCeiling: permissionSnapshot.risk_ceiling,
      maxTurns: permissionSnapshot.max_turns,
    });
  } catch (ctxError) {
    log.warn('Context assembly failed, proceeding without', { taskId, error: ctxError instanceof Error ? ctxError.message : 'Unknown' });
  }

  try {
    // G-EXEC-001: Execute with timeout
    // Phase 2: 3-way dispatch based on execution_mode (SPEC-CTRL-101)
    //   deterministic → Haiku, ≤10 turns (CSS, SEO, config, deploy)
    //   template_plus_params → Haiku, ≤30 turns (landing pages, auth, CRUD)
    //   full_agent → Sonnet, full turn budget (bugs, features, research)
    const executorByMode: Record<string, (input: AgentInput) => Promise<AgentResult>> = {
      deterministic: executeDeterministic,
      template_plus_params: executeTemplate,
      full_agent: executeAgent,
    };
    const executionMode = task.execution_mode ?? 'full_agent';
    const executor = executorByMode[executionMode] ?? executeAgent;

    log.info('Dispatching task', { taskId, executionMode, agent: agentName });

    const result = await Promise.race([
      executor({
        task: startedTask,
        agentId,
        agentName,
        watchdog,
        execution,
        contextPacket,
        permissionSnapshot,
      }),
      // Timeout via setTimeout OR via watchdog active monitor (abort signal)
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Task execution timed out after ${MAX_EXECUTION_MS / 1000}s`)),
          MAX_EXECUTION_MS
        );
        // Listen for watchdog abort (stuck/idle detection)
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Task killed by watchdog: idle or stuck detected'));
        });
      }),
    ]);

    // 6. Transition to verifying — worker is NOT the final authority (SPEC-CTRL-106)
    const wallClockSeconds = Math.round((Date.now() - executionStartTime) / 1000);
    execution.turn_count = result.turnCount;
    execution.execution_log = result.log;
    execution.wall_clock_seconds = wallClockSeconds;
    execution.token_usage = watchdog.getCostStatus() as unknown as Record<string, unknown>;

    await taskService.completeTask(taskId); // transitions to 'verifying'
    await taskService.updateTask(taskId, {
      turn_count: result.turnCount,
      // Subscription-funded runs (night-shift) don't touch credit_ledger
      actual_credits_charged: opts.subscriptionFunded ? 0 : task.estimated_credits,
    });

    // 6.5. Persist execution_log + turn_count to DB BEFORE verification runs.
    // Without this, verifier's deploy evidence check (which queries
    // task_executions.execution_log) can see null and miss deploy tool calls.
    // Persisting here makes Render verification read the same log the agent
    // just produced instead of racing the final execution update.
    // The final persist at the end of this function is now redundant for
    // execution_log but stays for the other fields (status, error_summary,
    // verification_evidence). Idempotent.
    try {
      await db.update(taskExecutions)
        .set({
          execution_log: execution.execution_log,
          turn_count: execution.turn_count,
          wall_clock_seconds: execution.wall_clock_seconds,
          token_usage: execution.token_usage,
        })
        .where(eq(taskExecutions.id, execution.id));
    } catch (preVerifyPersistError) {
      log.warn('Failed to persist execution_log before verification (verifier may see empty log)', {
        taskId,
        error: preVerifyPersistError instanceof Error ? preVerifyPersistError.message : String(preVerifyPersistError),
      });
    }

    // 7. Verification is MANDATORY — verifier is the sole authority for final status
    const verification = await verifyAndUpdate(taskId);
    execution.verification_evidence = verification as unknown as Record<string, unknown>;
    execution.status = verification.passed ? 'completed' : 'failed';
    execution.completed_at = new Date().toISOString();
    log.info('Task verification', { taskId, passed: verification.passed, level: verification.level });

    // Event emission handled by verifyAndUpdate (sole authority for task_completed/task_failed events)

    // 8. Self-healing auto-resolve: if this task succeeded, mark linked failure fingerprints as fixed
    if (verification.passed) {
      try {
        const resolved = await checkAutoResolve(taskId);
        if (resolved > 0) log.info('Auto-resolved failure fingerprints', { taskId, resolved });
      } catch { /* non-blocking */ }
    }

    // 9. Extract learnings (non-blocking)
    try {
      const learned = await processTaskLearnings(taskId);
      if (learned > 0) log.info('Extracted learnings', { taskId, title: task.title, learned });
    } catch { /* non-blocking */ }

    log.info('Task completed', { taskId, title: task.title, turns: result.turnCount, wallClockSeconds, verified: verification.passed });

  } catch (error) {
    // Task failed
    const wallClockSeconds = Math.round((Date.now() - executionStartTime) / 1000);
    execution.status = 'failed';
    execution.completed_at = new Date().toISOString();
    execution.wall_clock_seconds = wallClockSeconds;
    execution.error_summary = error instanceof Error ? error.message : 'Unknown error';
    execution.watchdog_events = watchdog.getEvents() as unknown as Record<string, unknown>[];
    execution.token_usage = watchdog.getCostStatus() as unknown as Record<string, unknown>;

    // H-AGENT-011: FIX — classify failure based on watchdog state
    // Was: always 'worker_failure' regardless of watchdog state (copy-paste bug)
    const failureClass = watchdog.wasKilled()
      ? 'timeout' as const             // Agent was killed by watchdog (turn/time limit)
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

    // Failed tasks consume credit — no auto-refund (SPEC-BILL-103).
    // Refunds are manual-only, issued by platform support for platform-fault failures.

    log.error('Task failed', { taskId, title: task.title, failureClass, error: execution.error_summary });
  }

  // Clean up watchdog monitor
  watchdog.stopMonitor();

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

// Canonical 8-class taxonomy (SPEC-CTRL-106)
function determineFailureClass(errorMessage: string): import('@/types').FailureClass {
  const msg = errorMessage.toLowerCase();

  if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('idle') || msg.includes('stall')) return 'timeout';
  if (msg.includes('credential') || msg.includes('oauth') || msg.includes('api key') || msg.includes('token expired') || msg.includes('auth')) return 'connector_failure';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('503') || msg.includes('502')) return 'external_block';
  if (msg.includes('too large') || msg.includes('scope') || msg.includes('split') || msg.includes('decompos')) return 'scope_overflow';
  if (msg.includes('tool') || msg.includes('rpc') || msg.includes('not supported') || msg.includes('capability')) return 'capability_miss';
  if (msg.includes('policy') || msg.includes('content safety') || msg.includes('guardrail') || msg.includes('blocked')) return 'policy_violation';
  if (msg.includes('verification') || msg.includes('verifier') || msg.includes('quality check')) return 'verification_reject';

  return 'infra_error';
}

// ══════════════════════════════════════════════
// QUEUE PROCESSOR — processes todo tasks for a company
// H-AGENT-022: Burst concurrency — up to MAX_CONCURRENT parallel per company
// Safety: atomic startTask (WHERE status='todo') prevents double-launch
// ══════════════════════════════════════════════

// SPEC-CTRL-001: One active execution slot per company.
// Night shift and manual execution share the slot — no parallel runs.
const MAX_CONCURRENT = 1;

export async function processQueue(companyId: string, opts: LaunchOptions = {}): Promise<number> {
  const allTasks = await taskService.getTasks(companyId);
  const todoTasks = allTasks
    .filter((t) => t.status === 'todo')
    .sort((a, b) => (a.queue_order ?? 999) - (b.queue_order ?? 999));

  // Count currently running tasks
  const runningCount = allTasks.filter((t) => t.status === 'in_progress').length;
  const availableSlots = MAX_CONCURRENT - runningCount;

  if (availableSlots <= 0) {
    log.info('Company at max concurrency, skipping queue', { companyId, runningCount, maxConcurrent: MAX_CONCURRENT });
    return 0;
  }

  if (todoTasks.length === 0) {
    return 0;
  }

  // Launch up to availableSlots tasks
  const toLaunch = todoTasks.slice(0, availableSlots);
  let launched = 0;

  for (const task of toLaunch) {
    log.info('Processing next task in queue', { companyId, title: task.title, slot: `${runningCount + launched + 1}/${MAX_CONCURRENT}` });

    try {
      // launchTask uses atomic startTask (WHERE status='todo') — safe against races
      await launchTask(task.id, opts);
      launched++;
    } catch (error) {
      log.error('Queue processing failed for task', { companyId, title: task.title }, error);
      // Continue to next task — one failure shouldn't block the batch
    }
  }

  return launched;
}

export { launchTask as launch, processQueue as process };
