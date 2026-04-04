// Auto-Remediation — migrated to Drizzle + Neon
import { db, tasks } from '@/lib/db';
import { eq, and, gte } from 'drizzle-orm';
import * as taskService from '@/lib/services/task.service';
import * as failureService from '@/lib/services/failure.service';
import * as eventService from '@/lib/services/event.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('Remediation');

type RemediationStrategy = 'retry' | 'simplify' | 'escalate' | 'skip';

function determineStrategy(failureClass: string | null, occurrenceCount: number): { strategy: RemediationStrategy; reason: string } {
  if (occurrenceCount >= 3) return { strategy: 'escalate', reason: 'Recurring failure (3+ occurrences), needs manual review' };

  switch (failureClass) {
    case 'worker_failure':      return { strategy: 'retry', reason: 'Worker execution error, worth retrying' };
    case 'external_dependency': return { strategy: 'retry', reason: 'External service failure, may resolve on retry' };
    case 'platform_scoping':    return { strategy: 'simplify', reason: 'Task too complex, needs decomposition' };
    case 'founder_ambiguity':   return { strategy: 'escalate', reason: 'Unclear requirements, needs founder input' };
    case 'missing_prerequisite':return { strategy: 'skip', reason: 'Missing prerequisite, cannot auto-remediate' };
    default:                    return { strategy: 'retry', reason: 'Unknown failure, retrying with same parameters' };
  }
}

export async function remediateFailed(taskId: string): Promise<{
  strategy: RemediationStrategy;
  remediationTaskId: string | null;
  reason: string;
}> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status !== 'failed') throw new Error(`Task ${taskId} is not failed`);

  const fingerprint = await failureService.captureFailure({
    taskId,
    companyId: task.company_id,
    errorMessage: 'Unknown error',
    tag: task.tag,
    agentId: task.assigned_to_agent_id ?? 0,
  });

  const { strategy, reason } = determineStrategy(task.failure_class, fingerprint.occurrence_count);
  let remediationTaskId: string | null = null;

  switch (strategy) {
    case 'retry': {
      const retryTask = await taskService.createTask({
        company_id: task.company_id,
        title: `[Retry] ${task.title}`,
        description: `Auto-retry of failed task.\n\nOriginal: ${task.description ?? ''}`,
        tag: task.tag,
        priority: Math.min((task.priority ?? 50) + 10, 100),
        source: 'auto_remediation',
        status: 'todo',
        estimated_credits: 1,
        related_task_ids: [taskId],
      });
      remediationTaskId = retryTask.id;
      break;
    }
    case 'simplify': {
      const simplifiedTask = await taskService.createTask({
        company_id: task.company_id,
        title: `[Simplified] ${task.title}`,
        description: `Simplified retry: focus on core deliverable only.\n\nOriginal: ${task.description ?? ''}`,
        tag: task.tag,
        priority: task.priority ?? 50,
        source: 'auto_remediation',
        status: 'todo',
        estimated_credits: 1,
        max_turns: Math.max((task.max_turns ?? 200) / 2, 50),
        related_task_ids: [taskId],
      });
      remediationTaskId = simplifiedTask.id;
      break;
    }
    case 'escalate': {
      await eventService.emit(task.company_id, 'task_failed', {
        title: `Recurring failure: ${task.title}`,
        fingerprint_id: fingerprint.id,
        occurrence_count: fingerprint.occurrence_count,
        needs_founder_review: true,
      });
      break;
    }
    case 'skip':
      break;
  }

  log.info('Remediation processed', { taskId, strategy, remediationTaskId: remediationTaskId ?? 'none' });
  return { strategy, remediationTaskId, reason };
}

export async function processRecentFailures(companyId: string, lookbackHours = 24): Promise<{
  processed: number; retried: number; escalated: number; skipped: number;
}> {
  const since = new Date(Date.now() - lookbackHours * 3600000);

  const failedTasks = await db.select({ id: tasks.id }).from(tasks)
    .where(and(
      eq(tasks.company_id, companyId),
      eq(tasks.status, 'failed'),
      gte(tasks.completed_at, since)
    ))
    .limit(10);

  const results = { processed: 0, retried: 0, escalated: 0, skipped: 0 };

  for (const task of failedTasks) {
    try {
      const result = await remediateFailed(task.id);
      results.processed++;
      if (result.strategy === 'retry' || result.strategy === 'simplify') results.retried++;
      else if (result.strategy === 'escalate') results.escalated++;
      else results.skipped++;
    } catch (error) {
      log.error('Error processing task', { taskId: task.id }, error);
    }
  }

  return results;
}
