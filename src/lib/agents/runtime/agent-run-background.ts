import { launchTask } from '@/lib/agents/worker-launcher';
import { verifyAndUpdate } from '@/lib/services/verification.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('AgentRunAPI');

export function launchTaskInBackground(taskId: string, context: Record<string, unknown> = {}): void {
  setTimeout(() => {
    void launchTask(taskId).catch((error) => {
      log.error('Background agent run launch failed', {
        taskId,
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 0);
}

export function verifyTaskInBackground(taskId: string, context: Record<string, unknown> = {}): void {
  setTimeout(() => {
    void verifyAndUpdate(taskId).catch((error) => {
      log.error('Background agent run verification failed', {
        taskId,
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 0);
}
