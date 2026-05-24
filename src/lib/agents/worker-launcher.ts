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
import { engineeringCompletionGate, executeAgent } from './agent-factory';
import { engineeringContractBlockReason } from './execution-contract';
import { ensureEngineeringGithubRepoReady } from './engineering-infra-guard';
import { executeDeterministic } from './deterministic-executor';
import { executeTemplate } from './template-executor';
import type { AgentInput, AgentResult } from './agent-factory';
import { Watchdog } from './watchdog';
import { getCostCeilingForTask } from './cost-ceilings';
import { applyTaskLaneRuntimePolicy, getTaskLanePolicy } from './task-lane';
import {
  completeStructuredRun,
  createStructuredRunContext,
  consumeRequestedAbort,
  recordExecutionSnapshot,
  recordStructuredVerification,
} from './runtime/structured-run-store';
import { shouldAutoFinalizeEngineeringWorkerError } from './runtime/clean-gate-finalizer';
import type { StructuredRunContext } from './runtime/agent-runtime';
import { preflightCheck, formatPreflightFailures } from '@/lib/services/preflight.service';
import { runPromoVideoTask } from '@/lib/services/promo-video-worker.service';
import { db, companies, reports, tasks as tasksTable, taskExecutions } from '@/lib/db';
import { eq, and, gte, inArray, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { TaskExecution, Lifecycle } from '@/types';
import { classifyFailureMessage } from '@/lib/failure-classification';

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
  /**
   * Optional per-call execution cap used by measurement/canary runners.
   * Production launches keep the platform-wide MAX_EXECUTION_MS default.
   */
  maxExecutionMs?: number;
}

function isWatchdogIdleError(message: string | null | undefined): boolean {
  return /watchdog: idle|idle or stuck|stuck detected|timeout/i.test(String(message ?? ''));
}

export function isTransientWorkerDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed query|connect timeout|connection timeout|econnreset|etimedout|fetch failed|network|socket|terminated|timeout|enotfound|temporarily unavailable/i.test(message);
}

async function retryWorkerDbWrite<T>(label: string, operation: () => Promise<T>, attempts = 20): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientWorkerDbError(error) || attempt === attempts) break;
      const delayMs = Math.min(30_000, 1_000 * attempt);
      log.warn(`${label} failed transiently; retrying`, {
        attempt,
        attempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function isOnlyFinalizationGateReason(reason: string | null): boolean {
  if (!reason) return false;
  return /write_codebase_map|create_report|final report|codebase map/i.test(reason) &&
    !/verify_release|verify_user_journey|verify_db_state|verify_browser_ui|static_code_scan|review_pushed_code|design_audit|design_critique|render_get_logs|check_url_health|HIGH-severity|BLOCKER|known-bad/i.test(reason);
}

function extractRoutesFromExecutionLog(logEntries: Record<string, unknown>[]): Array<{ path: string; method: string; auth: 'public' | 'session' | 'admin'; notes?: string }> {
  const routes = new Map<string, { path: string; method: string; auth: 'public' | 'session' | 'admin'; notes?: string }>();
  const routeRe = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/(?:api\/)?[A-Za-z0-9_./:[\]-]*)/g;
  for (const entry of logEntries) {
    const text = JSON.stringify(entry);
    for (const match of text.matchAll(routeRe)) {
      const method = match[1].toUpperCase();
      const rawPath = match[2].replace(/[),"'.]+$/g, '');
      if (!rawPath || rawPath.length > 160) continue;
      const auth: 'public' | 'session' | 'admin' = /admin/i.test(rawPath) ? 'admin' : /auth|login|session/i.test(text) ? 'session' : 'public';
      routes.set(`${method} ${rawPath}`, { method, path: rawPath, auth, notes: 'Auto-finalized from execution evidence.' });
    }
  }
  return [...routes.values()].slice(0, 40);
}

function extractTablesFromExecutionLog(logEntries: Record<string, unknown>[]): Array<{ table: string; columns: string[]; notes?: string }> {
  const tables = new Set<string>();
  const tableRe = /\b([a-z][a-z0-9_]*(?:_[a-z0-9]+)*)\b/g;
  for (const entry of logEntries) {
    const text = JSON.stringify(entry);
    for (const match of text.matchAll(tableRe)) {
      const name = match[1];
      if (/^(canary_|user$|session$|account$|verification$)/.test(name) && name.length <= 80) {
        tables.add(name);
      }
    }
  }
  return [...tables].slice(0, 40).map((table) => ({
    table,
    columns: [],
    notes: 'Auto-finalized from execution evidence; rerun write_codebase_map manually for full columns.',
  }));
}

function extractLatestCommitFromExecutionLog(logEntries: Record<string, unknown>[]): string | null {
  for (const entry of [...logEntries].reverse()) {
    const text = String(entry.result ?? entry.content ?? JSON.stringify(entry));
    const match = text.match(/\bCommit:\s*([a-f0-9]{7,40})\b/i) ?? text.match(/\bcommit\s+([a-f0-9]{7,40})\b/i);
    if (match) return match[1];
  }
  return null;
}

async function tryAutoFinalizeAfterWatchdogIdle(params: {
  task: Awaited<ReturnType<typeof taskService.getTask>>;
  execution: TaskExecution;
  agentId: number;
  gateReason: string | null;
}): Promise<boolean> {
  const { task, execution, agentId, gateReason } = params;
  if (!task || agentId !== 30 || !isOnlyFinalizationGateReason(gateReason)) return false;
  const logEntries = Array.isArray(execution.execution_log) ? execution.execution_log as Record<string, unknown>[] : [];
  if (logEntries.length === 0) return false;

  const [company] = await db.select({
    github_repo: companies.github_repo,
    render_service_id: companies.render_service_id,
    custom_domain: companies.custom_domain,
    subdomain: companies.subdomain,
    slug: companies.slug,
  }).from(companies).where(eq(companies.id, task.company_id)).limit(1);

  const now = new Date().toISOString();
  const appUrl = company?.custom_domain
    ? `https://${company.custom_domain}`
    : company?.subdomain
      ? `https://${company.subdomain}.baljia.app`
      : company?.slug
        ? `https://${company.slug}.baljia.app`
        : null;

  const { getCodebaseMap, writeCodebaseMap } = await import('@/lib/services/codebase-map.service');
  const existingMap = await getCodebaseMap(task.company_id).catch(() => null);
  const routes = extractRoutesFromExecutionLog(logEntries);
  const schema = extractTablesFromExecutionLog(logEntries);
  await writeCodebaseMap(task.company_id, {
    schema_version: 1,
    stack: existingMap?.stack ?? {
      framework: 'unknown',
      runtime: 'Node.js',
      database: 'Neon Postgres',
      hosting: 'Render',
      integrations: [],
    },
    deploy: {
      github_repo: company?.github_repo ?? existingMap?.deploy.github_repo ?? null,
      render_service_id: company?.render_service_id ?? existingMap?.deploy.render_service_id ?? null,
      app_url: appUrl ?? existingMap?.deploy.app_url ?? null,
      last_commit_sha: extractLatestCommitFromExecutionLog(logEntries) ?? existingMap?.deploy.last_commit_sha ?? null,
      last_deployed_at: now,
    },
    schema: schema.length > 0 ? schema : existingMap?.schema ?? [],
    routes: routes.length > 0 ? routes : existingMap?.routes ?? [],
    patterns: existingMap?.patterns ?? {
      auth: 'unknown',
      query_layer: 'unknown',
      error_handling: 'unknown',
    },
    shipped_features: [
      ...(existingMap?.shipped_features ?? []),
      { feature: `Auto-finalized task: ${task.title}`, task_id: task.id, shipped_at: now },
    ],
    notes: 'auto_finalized=true; generated after watchdog idle because functional gates were already clean and only final artifacts were missing.',
  });

  const mapLog = {
    tool: 'write_codebase_map',
    result: `Codebase map saved (${Math.max(schema.length, existingMap?.schema.length ?? 0)} table(s), ${Math.max(routes.length, existingMap?.routes.length ?? 0)} route(s)). auto_finalized=true`,
  };
  const reportTitle = `Auto-finalized Engineering Report: ${task.title}`;
  const reportContent = [
    `auto_finalized=true`,
    `Task: ${task.title}`,
    appUrl ? `Live URL: ${appUrl}` : null,
    company?.github_repo ? `GitHub repo: ${company.github_repo}` : null,
    company?.render_service_id ? `Render service: ${company.render_service_id}` : null,
    '',
    'Reason: watchdog idle/stuck occurred after functional gates were clean; only final codebase map/report artifacts were missing.',
    `Previous completion gate reason: ${gateReason}`,
  ].filter(Boolean).join('\n');
  await db.insert(reports).values({
    company_id: task.company_id,
    task_id: task.id,
    title: reportTitle,
    content: reportContent,
    report_type: 'execution',
    structured_data: { auto_finalized: true, gate_reason: gateReason },
  });
  const reportLog = {
    tool: 'create_report',
    result: `Report created: "${reportTitle}" auto_finalized=true`,
  };
  execution.execution_log = [
    ...logEntries,
    { event: 'auto_finalizer_started', reason: gateReason },
    mapLog,
    reportLog,
  ];
  const postReason = engineeringCompletionGate(agentId, execution.execution_log, task as never);
  if (postReason) {
    execution.execution_log = [
      ...execution.execution_log,
      { event: 'auto_finalizer_failed_gate_replay', reason: postReason },
    ];
    return false;
  }
  return true;
}

export async function launchTask(taskId: string, opts: LaunchOptions = {}): Promise<TaskExecution> {
  const task = await taskService.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // C-TASK-005: Re-check status to prevent double execution
  if (task.status !== 'todo') {
    throw new Error(`Task ${taskId} is not in todo status (currently: ${task.status})`);
  }

  // G-BILL-001: Check company lifecycle before execution
  const [company] = await db.select({
    lifecycle: companies.lifecycle,
    execution_state: companies.execution_state,
    github_repo: companies.github_repo,
    slug: companies.slug,
  })
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

  // 1. Use CEO-assigned agent first; routeTask is only a legacy fallback.
  const agentId = task.assigned_to_agent_id ?? routeTask(task.tag);
  const agentName = getAgentName(agentId);
  const isPromoVideoTask = task.tag.toLowerCase().trim() === 'promo-video';

  log.info('Launching task', { taskId, title: task.title, agent: agentName, agentId });

  const contractBlockReason = engineeringContractBlockReason(task, agentId);
  if (contractBlockReason) {
    await taskService.updateTask(taskId, { status: 'blocked_pre_start' });
    await eventService.emit(task.company_id, 'task_failed', {
      task_id: taskId,
      title: task.title,
      reason: contractBlockReason,
    });
    throw new Error(contractBlockReason);
  }

  // Company-scoped GitHub preflight: the global preflight proves the token can
  // call GitHub, but Engineering also needs this company's repo to exist and be
  // writable. If onboarding's best-effort repo creation was deferred or the org
  // token lacks admin/write access, stop before claiming a slot or charging a
  // credit. This prevents 100+ turn GitHub/Render retry loops.
  if (agentId === 30 && !isPromoVideoTask) {
    const repoReady = await ensureEngineeringGithubRepoReady({
      companyId: task.company_id,
      githubRepo: company.github_repo,
      slug: company.slug,
      persistRepo: async (fullName) => {
        await db.update(companies)
          .set({ github_repo: fullName })
          .where(eq(companies.id, task.company_id));
      },
    });

    if (!repoReady.ok) {
      const reason = repoReady.reason ?? 'GitHub repo preflight failed before launching Engineering.';
      await taskService.updateTask(taskId, {
        status: 'blocked_pre_start',
        failure_class: 'connector_failure',
        completed_at: new Date().toISOString(),
      });
      await eventService.emit(task.company_id, 'task_failed', {
        task_id: taskId,
        title: task.title,
        reason,
        failure_class: 'connector_failure',
      });
      throw new Error(reason);
    }
  }

  // PREFLIGHT: For engineering tasks, verify all required external creds are
  // healthy BEFORE claiming a slot or charging credits. Stale GitHub tokens,
  // missing Render keys, and unreachable Neon connections used to waste
  // entire 200-turn runs before discovery. Fail loud, fail cheap.
  if (agentId === 30 && !isPromoVideoTask) {
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
  const runtimeTask = applyTaskLaneRuntimePolicy(startedTask, agentId);
  const lanePolicy = getTaskLanePolicy(runtimeTask);

  await eventService.emit(task.company_id, 'task_started', {
    task_id: taskId,
    title: task.title,
    agent: agentName,
    agent_id: agentId,
  });

  // 4. Create watchdog with active monitoring + per-agent cost ceiling.
  // The ceiling is a backstop against runaway token spend; the agent also
  // sees the live budget summary in its per-turn context so it can self-pace.
  const costCeilingUsd = getCostCeilingForTask(agentId, runtimeTask);
  const watchdog = new Watchdog(taskId, runtimeTask.max_turns, task.company_id, costCeilingUsd);
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
    execution_mode: runtimeTask.execution_mode ?? 'full_agent',
    status: 'running',
    turn_count: 0,
    max_turns: runtimeTask.max_turns,
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
      assigned_to_agent_id: agentId,
    });
    permissionSnapshot = buildPermissionSnapshot(runtimeTask, agentId);
    log.info('Context assembled', {
      taskId,
      lane: lanePolicy.lane,
      memoryLayers: Object.keys(contextPacket.memory_layers).length,
      priorReports: contextPacket.prior_reports.length,
      failureFingerprints: contextPacket.failure_fingerprints.length,
      riskCeiling: permissionSnapshot.risk_ceiling,
      maxTurns: runtimeTask.max_turns,
      costCeilingUsd,
    });
  } catch (ctxError) {
    log.warn('Context assembly failed, proceeding without', { taskId, error: ctxError instanceof Error ? ctxError.message : 'Unknown' });
  }

  const structuredRun: StructuredRunContext = await createStructuredRunContext({
    task: runtimeTask,
    execution,
    agentId,
    executionMode: runtimeTask.execution_mode ?? 'full_agent',
    permissionSnapshot,
  });
  const runControlPollInterval = structuredRun.enabled
    ? setInterval(() => {
        void consumeRequestedAbort(structuredRun).then((shouldAbort) => {
          if (shouldAbort) abortController.abort();
        });
      }, 2000)
    : null;

  if (isPromoVideoTask) {
    try {
      const result = await runPromoVideoTask({ task: startedTask, executionId: execution.id });
      const wallClockSeconds = Math.round((Date.now() - executionStartTime) / 1000);
      execution.turn_count = 1;
      execution.execution_log = result.log;
      execution.wall_clock_seconds = wallClockSeconds;
      execution.token_usage = watchdog.getCostStatus() as unknown as Record<string, unknown>;
      execution.verification_evidence = {
        level: runtimeTask.verification_level ?? 'quality_review',
        passed: true,
        summary: 'Deterministic promo-video pipeline rendered and uploaded the requested media.',
        phase: result.phase,
        ...(result.outputUrl ? { output_url: result.outputUrl } : {}),
        ...(result.previewUrl ? { preview_url: result.previewUrl } : {}),
        ...(result.thumbnailUrl ? { thumbnail_url: result.thumbnailUrl } : {}),
      };
      execution.status = 'completed';
      execution.completed_at = new Date().toISOString();

      await retryWorkerDbWrite('complete deterministic promo-video task', () => taskService.completeTask(taskId));
      await retryWorkerDbWrite('update promo-video task accounting', () => taskService.updateTask(taskId, {
        turn_count: 1,
        actual_credits_charged: opts.subscriptionFunded ? 0 : task.estimated_credits,
      }));
      await retryWorkerDbWrite('finalize deterministic promo-video task', () => taskService.finalizeTask(taskId, true));
      await eventService.emit(task.company_id, 'task_completed', {
        task_id: taskId,
        title: task.title,
        agent: agentName,
        phase: result.phase,
        ...(result.outputUrl ? { output_url: result.outputUrl } : {}),
        ...(result.previewUrl ? { preview_url: result.previewUrl } : {}),
        ...(result.thumbnailUrl ? { thumbnail_url: result.thumbnailUrl } : {}),
      });
      await recordStructuredVerification(structuredRun, {
        level: runtimeTask.verification_level ?? 'quality_review',
        passed: true,
        summary: 'Promo video rendered and uploaded.',
        checks: [],
        evidence: execution.verification_evidence,
      });
      log.info('Deterministic promo-video task completed', { taskId, wallClockSeconds, phase: result.phase, outputUrl: result.outputUrl });
    } catch (error) {
      const wallClockSeconds = Math.round((Date.now() - executionStartTime) / 1000);
      execution.status = 'failed';
      execution.completed_at = new Date().toISOString();
      execution.wall_clock_seconds = wallClockSeconds;
      execution.error_summary = error instanceof Error ? error.message : 'Unknown error';
      execution.watchdog_events = watchdog.getEvents() as unknown as Record<string, unknown>[];
      execution.token_usage = watchdog.getCostStatus() as unknown as Record<string, unknown>;
      const failureClass = determineFailureClass(execution.error_summary);

      await retryWorkerDbWrite('mark deterministic promo-video task failed', () => taskService.failTask(taskId, failureClass));
      await eventService.emit(task.company_id, 'task_failed', {
        task_id: taskId,
        title: task.title,
        agent: agentName,
        error: execution.error_summary,
        failure_class: failureClass,
      }).catch((eventError) => {
        log.warn('Failed to emit promo-video task_failed event', {
          taskId,
          error: eventError instanceof Error ? eventError.message : String(eventError),
        });
      });
      log.error('Deterministic promo-video task failed', { taskId, error: execution.error_summary });
    } finally {
      watchdog.stopMonitor();
      if (runControlPollInterval) clearInterval(runControlPollInterval);

      try {
        await retryWorkerDbWrite('persist deterministic promo-video execution state', async () => {
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
        });
        await recordExecutionSnapshot(structuredRun, execution.execution_log ?? []);
        await completeStructuredRun(structuredRun, {
          status: execution.status === 'running' ? 'failed' : execution.status,
          turnCount: execution.turn_count,
          wallClockSeconds: execution.wall_clock_seconds,
          tokenUsage: execution.token_usage,
          errorSummary: execution.error_summary,
        });
      } catch (persistError) {
        log.error('Failed to persist deterministic promo-video execution', { taskId }, persistError);
      }
    }

    return execution;
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
    const executionMode = runtimeTask.execution_mode ?? 'full_agent';
    const executor = executorByMode[executionMode] ?? executeAgent;

    log.info('Dispatching task', { taskId, executionMode, agent: agentName, lane: lanePolicy.lane, maxTurns: runtimeTask.max_turns, costCeilingUsd });

    // Stream execution_log + turn_count to the DB every ~3s while the agent
    // runs. Without this, founders staring at the dashboard see null columns
    // for the entire 10-15 minute build. The agent-factory throttles internally;
    // we just write whatever it hands us.
    const onProgress = async (snapshot: { turn: number; log: Record<string, unknown>[] }) => {
      try {
        watchdog.recordHeartbeat('execution progress flushed to database', 'progress_flush');
        await db.update(taskExecutions)
          .set({
            execution_log: snapshot.log as unknown as Record<string, unknown>[],
            turn_count: snapshot.turn,
          })
          .where(eq(taskExecutions.id, execution.id));
        await recordExecutionSnapshot(structuredRun, snapshot.log);
        if (await consumeRequestedAbort(structuredRun)) {
          abortController.abort();
        }
      } catch (err) {
        log.warn('Mid-flight execution_log flush failed (non-fatal)', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const executionTimeoutMs = opts.maxExecutionMs ?? MAX_EXECUTION_MS;
    const result = await Promise.race([
      executor({
        task: runtimeTask,
        agentId,
        agentName,
        watchdog,
        execution,
        contextPacket,
        permissionSnapshot,
        structuredRun,
        onProgress,
        abortSignal: abortController.signal,
      }),
      // Timeout via setTimeout OR via watchdog active monitor (abort signal).
      // Both paths MUST abort the AbortController so the executor's threaded
      // signal fires and the inner LLM fetch + agent loop cancel within
      // ~100ms. Without the .abort() on the timeout path, the hard 4-hour
      // cap would reject the race promise but the agent kept running in the
      // background and could land late github_create_commit / render_deploy
      // writes after the task was marked failed.
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          abortController.abort();
          reject(new Error(`Task execution timed out after ${executionTimeoutMs / 1000}s`));
        }, executionTimeoutMs);
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

    await retryWorkerDbWrite('complete task after agent execution', () => taskService.completeTask(taskId)); // transitions to 'verifying'
    await retryWorkerDbWrite('update task execution accounting', () => taskService.updateTask(taskId, {
      turn_count: result.turnCount,
      // Subscription-funded runs (night-shift) don't touch credit_ledger
      actual_credits_charged: opts.subscriptionFunded ? 0 : task.estimated_credits,
    }));

    // 6.5. Persist execution_log + turn_count to DB BEFORE verification runs.
    // Without this, verifier's deploy evidence check (which queries
    // task_executions.execution_log) can see null and miss deploy tool calls.
    // Persisting here makes Render verification read the same log the agent
    // just produced instead of racing the final execution update.
    // The final persist at the end of this function is now redundant for
    // execution_log but stays for the other fields (status, error_summary,
    // verification_evidence). Idempotent.
    try {
      await retryWorkerDbWrite('persist execution log before verification', async () => {
        await db.update(taskExecutions)
          .set({
            execution_log: execution.execution_log,
            turn_count: execution.turn_count,
            wall_clock_seconds: execution.wall_clock_seconds,
            token_usage: execution.token_usage,
          })
          .where(eq(taskExecutions.id, execution.id));
      });
      await recordExecutionSnapshot(structuredRun, execution.execution_log ?? []);
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
    await recordStructuredVerification(structuredRun, {
      level: verification.level,
      passed: verification.passed,
      summary: verification.summary,
      checks: verification.checks,
      evidence: verification,
    });
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

    if (!execution.execution_log || execution.turn_count === 0) {
      try {
        const [persistedProgress] = await db.select({
          execution_log: taskExecutions.execution_log,
          turn_count: taskExecutions.turn_count,
        }).from(taskExecutions).where(eq(taskExecutions.id, execution.id)).limit(1);
        if (!execution.execution_log && persistedProgress?.execution_log) {
          execution.execution_log = persistedProgress.execution_log as Record<string, unknown>[];
        }
        if (execution.turn_count === 0 && persistedProgress?.turn_count) {
          execution.turn_count = persistedProgress.turn_count;
        }
      } catch (progressReadError) {
        log.warn('Failed to preserve failed execution progress log', {
          taskId,
          error: progressReadError instanceof Error ? progressReadError.message : String(progressReadError),
        });
      }
    }

    let autoFinalized = false;
    if (watchdog.wasKilled() && isWatchdogIdleError(execution.error_summary)) {
      const gateReason = engineeringCompletionGate(agentId, Array.isArray(execution.execution_log) ? execution.execution_log : [], task as never);
      autoFinalized = await tryAutoFinalizeAfterWatchdogIdle({
        task,
        execution,
        agentId,
        gateReason,
      }).catch((autoError) => {
        log.warn('Watchdog auto-finalizer failed', {
          taskId,
          error: autoError instanceof Error ? autoError.message : String(autoError),
        });
        return false;
      });

      if (autoFinalized) {
        try {
          execution.error_summary = null;
          execution.status = 'running';
          await retryWorkerDbWrite('complete auto-finalized task', () => taskService.completeTask(taskId));
          await retryWorkerDbWrite('update auto-finalized task accounting', () => taskService.updateTask(taskId, {
            turn_count: execution.turn_count,
            actual_credits_charged: opts.subscriptionFunded ? 0 : task.estimated_credits,
          }));
          await retryWorkerDbWrite('persist auto-finalized execution progress', async () => {
            await db.update(taskExecutions)
              .set({
                execution_log: execution.execution_log,
                turn_count: execution.turn_count,
                wall_clock_seconds: execution.wall_clock_seconds,
                token_usage: execution.token_usage,
                watchdog_events: execution.watchdog_events,
              })
              .where(eq(taskExecutions.id, execution.id));
          });
          const verification = await verifyAndUpdate(taskId);
          execution.verification_evidence = verification as unknown as Record<string, unknown>;
          execution.status = verification.passed ? 'completed' : 'failed';
          execution.completed_at = new Date().toISOString();
          await recordStructuredVerification(structuredRun, {
            level: verification.level,
            passed: verification.passed,
            summary: verification.summary,
            checks: verification.checks,
            evidence: verification,
          });
          log.info('Task auto-finalized after watchdog idle', { taskId, verified: verification.passed });
        } catch (autoFinalizePersistError) {
          autoFinalized = false;
          execution.status = 'failed';
          execution.error_summary = autoFinalizePersistError instanceof Error
            ? autoFinalizePersistError.message
            : String(autoFinalizePersistError);
          log.warn('Auto-finalized watchdog task could not be persisted or verified; falling back to failed state', {
            taskId,
            error: execution.error_summary,
          });
        }
      }
    }

    if (!autoFinalized && shouldAutoFinalizeEngineeringWorkerError({
      agentId,
      logEntries: Array.isArray(execution.execution_log) ? execution.execution_log : [],
      task: task as never,
      errorSummary: execution.error_summary,
      completionGate: engineeringCompletionGate,
    })) {
      const previousError = execution.error_summary;
      try {
        const logEntries = Array.isArray(execution.execution_log) ? execution.execution_log : [];
        execution.execution_log = [
          ...logEntries,
          {
            event: 'auto_finalizer_started',
            reason: 'worker_error_after_clean_completion_gate',
            error: String(previousError ?? '').slice(0, 1000),
          },
          {
            event: 'auto_finalizer_completed',
            reason: 'worker_error_after_clean_completion_gate',
          },
        ];
        execution.error_summary = null;
        execution.status = 'running';
        await retryWorkerDbWrite('complete clean-gate auto-finalized task', () => taskService.completeTask(taskId));
        await retryWorkerDbWrite('update clean-gate auto-finalized task accounting', () => taskService.updateTask(taskId, {
          turn_count: execution.turn_count,
          actual_credits_charged: opts.subscriptionFunded ? 0 : task.estimated_credits,
        }));
        await retryWorkerDbWrite('persist clean-gate auto-finalized execution progress', async () => {
          await db.update(taskExecutions)
            .set({
              execution_log: execution.execution_log,
              turn_count: execution.turn_count,
              wall_clock_seconds: execution.wall_clock_seconds,
              token_usage: execution.token_usage,
              watchdog_events: execution.watchdog_events,
            })
            .where(eq(taskExecutions.id, execution.id));
        });
        await recordExecutionSnapshot(structuredRun, execution.execution_log ?? []);
        const verification = await verifyAndUpdate(taskId);
        execution.verification_evidence = verification as unknown as Record<string, unknown>;
        execution.status = verification.passed ? 'completed' : 'failed';
        execution.completed_at = new Date().toISOString();
        await recordStructuredVerification(structuredRun, {
          level: verification.level,
          passed: verification.passed,
          summary: verification.summary,
          checks: verification.checks,
          evidence: verification,
        });
        autoFinalized = true;
        log.info('Task auto-finalized after worker error because completion gate was clean', {
          taskId,
          verified: verification.passed,
          previousError: String(previousError ?? '').slice(0, 300),
        });
      } catch (cleanFinalizeError) {
        autoFinalized = false;
        execution.status = 'failed';
        execution.error_summary = cleanFinalizeError instanceof Error
          ? cleanFinalizeError.message
          : String(cleanFinalizeError);
        log.warn('Clean-gate worker-error auto-finalizer failed; falling back to failed state', {
          taskId,
          error: execution.error_summary,
        });
      }
    }

    if (!autoFinalized) {
      try {
        await retryWorkerDbWrite('mark task failed after worker error', () => taskService.failTask(taskId, failureClass));
      } catch (failTaskError) {
        log.error('Failed to mark task failed after retries; continuing to persist execution state', {
          taskId,
          failureClass,
          error: failTaskError instanceof Error ? failTaskError.message : String(failTaskError),
        });
      }

      try {
        await eventService.emit(task.company_id, 'task_failed', {
          task_id: taskId,
          title: task.title,
          agent: agentName,
          error: execution.error_summary,
          failure_class: failureClass,
        });
      } catch (eventError) {
        log.warn('Failed to emit task_failed event after worker error', {
          taskId,
          error: eventError instanceof Error ? eventError.message : String(eventError),
        });
      }

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
  }

  // Clean up watchdog monitor
  watchdog.stopMonitor();
  if (runControlPollInterval) clearInterval(runControlPollInterval);

  // C-TASK-001: Persist final execution state to DB
  try {
    await retryWorkerDbWrite('persist final execution state', async () => {
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
    });
    await recordExecutionSnapshot(structuredRun, execution.execution_log ?? []);
    await completeStructuredRun(structuredRun, {
      status: execution.status,
      turnCount: execution.turn_count,
      wallClockSeconds: execution.wall_clock_seconds,
      tokenUsage: execution.token_usage,
      errorSummary: execution.error_summary,
    });
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
  return classifyFailureMessage(errorMessage);
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
