import { and, desc, eq } from 'drizzle-orm';
import {
  agentGateDecisions,
  agentProviderAttempts,
  agentRunControls,
  agentRunEvents,
  agentRunMessages,
  agentSubagentOutputs,
  agentToolCalls,
  agentVerificationResults,
  db,
  runs,
  sessions,
} from '@/lib/db';
import { createLogger } from '@/lib/logger';
import type { PermissionSnapshot, Task, TaskExecution } from '@/types';
import type { StructuredRunContext } from './agent-runtime';
import { executionEntryEventType, normalizeToolResult, redactForExecutionLog } from './execution-log';
import { parseEngineeringLaneOutputEvidence } from './engineering-subagents';

const log = createLogger('StructuredRunStore');

export async function createStructuredRunContext(input: {
  task: Task;
  execution: TaskExecution;
  agentId: number;
  executionMode: string;
  permissionSnapshot?: PermissionSnapshot;
}): Promise<StructuredRunContext> {
  const fallback: StructuredRunContext = {
    enabled: false,
    executionId: input.execution.id,
    taskId: input.task.id,
    lastRecordedIndex: 0,
  };

  try {
    const [session] = await db.insert(sessions).values({
      company_id: input.task.company_id,
      task_id: input.task.id,
      session_type: 'execution',
      status: 'active',
      permission_snapshot: input.permissionSnapshot ?? null,
    }).returning({ id: sessions.id });

    const [run] = await db.insert(runs).values({
      session_id: session.id,
      task_id: input.task.id,
      attempt_number: 1,
      status: 'running',
      agent_id: input.agentId,
      execution_mode: input.executionMode,
    }).returning({ id: runs.id });

    return {
      enabled: true,
      sessionId: session.id,
      runId: run.id,
      executionId: input.execution.id,
      taskId: input.task.id,
      lastRecordedIndex: 0,
    };
  } catch (error) {
    log.warn('Structured run context unavailable; legacy execution_log remains source of truth', {
      taskId: input.task.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export function recordExecutionSnapshot(context: StructuredRunContext | undefined, logEntries: Record<string, unknown>[]): Promise<void> {
  if (!context?.enabled || !context.runId) return Promise.resolve();
  const next = (context.recordingPromise ?? Promise.resolve())
    .catch(() => {})
    .then(() => recordExecutionSnapshotNow(context, logEntries));
  context.recordingPromise = next.catch(() => {});
  return next;
}

async function recordExecutionSnapshotNow(context: StructuredRunContext, logEntries: Record<string, unknown>[]): Promise<void> {
  if (!context?.enabled || !context.runId) return;
  const start = context.lastRecordedIndex;
  const entries = logEntries.slice(start);
  if (entries.length === 0) return;

  try {
    for (let offset = 0; offset < entries.length; offset += 1) {
      const entry = redactForExecutionLog(entries[offset]) as Record<string, unknown>;
      const sequence = start + offset;
      const eventType = executionEntryEventType(entry);
      const turn = typeof entry.turn === 'number' ? entry.turn : null;
      const toolName = typeof entry.tool === 'string' ? entry.tool : null;
      const provider = typeof entry.provider === 'string' ? entry.provider : null;
      const message =
        typeof entry.message === 'string' ? entry.message :
        typeof entry.summary === 'string' ? entry.summary :
        typeof entry.reason === 'string' ? entry.reason :
        null;

      await db.insert(agentRunEvents).values({
        session_id: context.sessionId ?? null,
        run_id: context.runId,
        task_id: context.taskId,
        execution_id: context.executionId,
        sequence,
        turn,
        event_type: eventType,
        provider,
        tool_name: toolName,
        status: inferEntryStatus(entry),
        message,
        input: entry.input ? entry.input as Record<string, unknown> : null,
        output: entry.result ? { result: String(entry.result) } : null,
        metadata: entry,
      });

      if (toolName) {
        const normalized = normalizeToolResult(toolName, entry.result);
        await db.insert(agentToolCalls).values({
          run_id: context.runId,
          task_id: context.taskId,
          execution_id: context.executionId,
          turn,
          tool_name: toolName,
          input: entry.input ? entry.input as Record<string, unknown> : null,
          result: normalized.text,
          status: normalized.status,
          metadata: normalized.evidence ?? null,
        });

        const subagentOutput = engineeringSubagentOutputFromToolResult(toolName, normalized.text);
        if (subagentOutput) {
          await db.insert(agentSubagentOutputs).values({
            run_id: context.runId,
            task_id: context.taskId,
            execution_id: context.executionId,
            role: subagentOutput.role,
            status: subagentOutput.status,
            output: subagentOutput as unknown as Record<string, unknown>,
            cannot_complete_task: true,
          });
        }
      }

      if (eventType === 'completed' || eventType === 'message') {
        await db.insert(agentRunMessages).values({
          run_id: context.runId,
          task_id: context.taskId,
          execution_id: context.executionId,
          turn,
          role: 'assistant',
          provider,
          content: message,
          raw: entry,
        });
      }

      if (eventType.startsWith('completion_gate_') || eventType.includes('pre_tool_gate')) {
        await db.insert(agentGateDecisions).values({
          run_id: context.runId,
          task_id: context.taskId,
          execution_id: context.executionId,
          gate_name: eventType.startsWith('completion_gate_') ? 'engineering_completion_gate' : 'engineering_pre_tool_gate',
          status: eventType.endsWith('_block') || eventType.includes('block') ? 'blocked' : eventType,
          reason: message,
          evidence: entry,
          turn,
        });
      }

      if (eventType.startsWith('provider_') && provider) {
        await db.insert(agentProviderAttempts).values({
          run_id: context.runId,
          task_id: context.taskId,
          execution_id: context.executionId,
          provider,
          model: typeof entry.model === 'string' ? entry.model : null,
          status: eventType.replace(/^provider_/, ''),
          error: typeof entry.error === 'string' ? entry.error : null,
          latency_ms: typeof entry.latency_ms === 'number' ? entry.latency_ms : null,
          metadata: entry,
          completed_at: eventType === 'provider_started' ? null : new Date(),
        });
      }
    }

    context.lastRecordedIndex = logEntries.length;
  } catch (error) {
    context.enabled = false;
    log.warn('Structured run dual-write failed; disabling for this execution', {
      taskId: context.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function engineeringSubagentOutputFromToolResult(toolName: string, result: string): ReturnType<typeof parseEngineeringLaneOutputEvidence> {
  if (toolName !== 'record_engineering_lane_output') return null;
  return parseEngineeringLaneOutputEvidence(result);
}

export async function completeStructuredRun(context: StructuredRunContext | undefined, input: {
  status: 'completed' | 'failed' | 'timed_out' | 'killed';
  turnCount?: number | null;
  wallClockSeconds?: number | null;
  tokenUsage?: Record<string, unknown> | null;
  errorSummary?: string | null;
}): Promise<void> {
  if (!context?.enabled || !context.runId || !context.sessionId) return;
  try {
    await db.update(runs).set({
      status: input.status,
      ended_at: new Date(),
      turn_count: input.turnCount ?? null,
      wall_clock_seconds: input.wallClockSeconds ?? null,
      token_usage: input.tokenUsage ?? null,
      error_summary: input.errorSummary ?? null,
    }).where(eq(runs.id, context.runId));

    await db.update(sessions).set({
      status: input.status === 'completed' ? 'completed' : 'failed',
      ended_at: new Date(),
    }).where(eq(sessions.id, context.sessionId));
  } catch (error) {
    log.warn('Structured run completion update failed', {
      taskId: context.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function recordStructuredVerification(context: StructuredRunContext | undefined, verification: {
  level?: string;
  passed: boolean;
  summary?: string;
  checks?: unknown;
  evidence?: unknown;
}): Promise<void> {
  if (!context?.enabled || !context.runId) return;
  try {
    await db.insert(agentVerificationResults).values({
      run_id: context.runId,
      task_id: context.taskId,
      execution_id: context.executionId,
      verifier: 'baljia_verifier',
      level: verification.level ?? null,
      passed: verification.passed,
      summary: verification.summary ?? null,
      checks: verification.checks as Record<string, unknown> | null,
      evidence: verification.evidence as Record<string, unknown> | null,
    });
  } catch (error) {
    log.warn('Structured verification write failed', {
      taskId: context.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function consumeRequestedAbort(context: StructuredRunContext | undefined): Promise<boolean> {
  if (!context?.enabled || !context.runId) return false;
  try {
    const [control] = await db.select({ id: agentRunControls.id })
      .from(agentRunControls)
      .where(and(
        eq(agentRunControls.run_id, context.runId),
        eq(agentRunControls.action, 'abort'),
        eq(agentRunControls.status, 'requested'),
      ))
      .orderBy(desc(agentRunControls.created_at))
      .limit(1);
    if (!control) return false;
    await db.update(agentRunControls).set({
      status: 'handled',
      handled_at: new Date(),
    }).where(eq(agentRunControls.id, control.id));
    return true;
  } catch {
    return false;
  }
}

function inferEntryStatus(entry: Record<string, unknown>): string | null {
  if (typeof entry.status === 'string') return entry.status;
  const text = `${entry.event ?? ''} ${entry.reason ?? ''} ${entry.result ?? ''}`;
  if (/\b(block|blocked|gate)\b/i.test(text)) return 'blocked';
  if (/\b(error|failed|failure|timeout|kill)\b/i.test(text)) return 'failed';
  if (entry.tool) return 'completed';
  return null;
}
