import type { Task, TaskExecution } from '@/types';
import type { Watchdog } from '@/lib/agents/watchdog';

export interface StructuredRunContext {
  enabled: boolean;
  sessionId?: string;
  runId?: string;
  executionId: string;
  taskId: string;
  lastRecordedIndex: number;
  recordingPromise?: Promise<void>;
}

export interface AgentInput {
  task: Task;
  agentId: number;
  agentName: string;
  watchdog: Watchdog;
  execution: TaskExecution;
  contextPacket?: import('@/types').ContextPacket;
  permissionSnapshot?: import('@/types').PermissionSnapshot;
  structuredRun?: StructuredRunContext;
  onProgress?: (snapshot: { turn: number; log: Record<string, unknown>[] }) => Promise<void> | void;
  abortSignal?: AbortSignal;
}

export interface AgentResult {
  turnCount: number;
  log: Record<string, unknown>[];
}

export interface AgentLoopConfig {
  claudeModel: string;
  openAIModel?: string;
  openRouterModel?: string;
  geminiModel?: string;
  maxTurns: number;
  systemPromptOverride?: string;
}
