// scripts/trigger-task.ts — E2E test helper to directly launch a specific task.
// Usage: npx tsx src/scripts/trigger-task.ts <taskId>
// Called by engineering-agent.spec.ts to simulate the worker picking up the task.
// Uses launchTask directly (same as the approve route does internally).
// Passes subscriptionFunded:true to bypass daily spend caps during E2E testing.

import './load-env-local';
import { launchTask } from '@/lib/agents/worker-launcher';
import { createLogger } from '@/lib/logger';

const log = createLogger('TriggerTask');

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: npx tsx src/scripts/trigger-task.ts <taskId>');
  process.exit(1);
}

void (async () => {
  log.info('Launching task directly', { taskId });
  try {
    // subscriptionFunded:true skips daily spend cap checks — safe for E2E testing
    const execution = await launchTask(taskId, { subscriptionFunded: true });
    console.log(`OK: task ${taskId} completed with status=${execution.status} turns=${execution.turn_count}`);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "not in todo" means it's already running / completed — treat as success
    if (msg.includes('not in todo') || msg.includes('already claimed') || msg.includes('slot_occupied')) {
      console.log(`OK (already running): ${msg}`);
      process.exit(0);
    }
    console.error('ERROR:', msg);
    process.exit(1);
  }
})();
