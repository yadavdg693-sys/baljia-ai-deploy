// Manually trigger a task's worker execution. Simulates "founder clicks approve".
// Run: npx tsx scripts/trigger-pagegenie-task.ts <taskId>

import { launchTask } from '@/lib/agents/worker-launcher';
import { db, tasks } from '@/lib/db';
import { eq } from 'drizzle-orm';

async function main() {
  const taskId = process.argv[2];
  if (!taskId) {
    console.error('Usage: npx tsx scripts/trigger-pagegenie-task.ts <taskId>');
    process.exit(1);
  }

  // Mark as founder-authorized so audit lineage is clean
  await db.update(tasks).set({ authorized_by: 'founder', authorization_reason: 'E2E test manual approval' }).where(eq(tasks.id, taskId));

  console.log(`Triggering launchTask(${taskId})...\n`);
  const start = Date.now();
  try {
    const execution = await launchTask(taskId);
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`\n=== Task execution returned in ${elapsed}s ===`);
    console.log('execution:', JSON.stringify(execution, null, 2).slice(0, 2000));
    process.exit(0);
  } catch (err) {
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.error(`\n=== Task launch failed in ${elapsed}s ===`);
    console.error('Error:', err instanceof Error ? err.message : err);
    console.error('Stack:', err instanceof Error ? err.stack : '');
    process.exit(1);
  }
}

main().catch((err) => { console.error('Threw:', err); process.exit(1); });
