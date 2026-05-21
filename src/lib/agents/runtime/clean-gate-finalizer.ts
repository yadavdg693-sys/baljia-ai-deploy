import type { Task } from '@/types';

export type EngineeringCompletionGateFn = (
  agentId: number,
  logEntries: Record<string, unknown>[],
  task: Task,
) => string | null;

export function shouldAutoFinalizeEngineeringWorkerError(params: {
  agentId: number;
  logEntries: Record<string, unknown>[];
  task: Task;
  errorSummary: string | null | undefined;
  completionGate: EngineeringCompletionGateFn;
}): boolean {
  if (params.agentId !== 30) return false;
  if (!params.errorSummary) return false;
  return params.completionGate(params.agentId, params.logEntries, params.task) === null;
}
