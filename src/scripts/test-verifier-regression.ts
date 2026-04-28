// Regression test: would the new verifier catch queryforge's silent-failure
// task? Re-runs verification logic against the existing task record.
// Run: npx tsx --env-file=.env.local src/scripts/test-verifier-regression.ts

import { db, tasks } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { verifyTask } from '@/lib/services/verification.service';

const QUERYFORGE_CAMPAIGN_TASK = '9a36e013-6527-4c8d-84a4-8162a063cd26';

async function main() {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, QUERYFORGE_CAMPAIGN_TASK)).limit(1);
  if (!task) { console.error('task not found'); process.exit(1); }

  console.log('═══ Re-running verification on the failed-but-marked-completed task ═══');
  console.log(`  task: "${task.title}"`);
  console.log(`  tag: ${task.tag}`);
  console.log(`  current status: ${task.status}`);
  console.log(`  current verification_level: ${task.verification_level ?? '(not set)'}`);
  console.log();

  // Force re-classification by clearing verification_level so determineLevel runs fresh
  const taskWithFreshLevel = { ...task, verification_level: null } as typeof task;

  const result = await verifyTask(taskWithFreshLevel);
  console.log('═══ NEW verification result ═══');
  console.log(`  level:   ${result.level}`);
  console.log(`  passed:  ${result.passed}`);
  console.log(`  summary: ${result.summary}`);
  console.log();
  console.log('  checks:');
  for (const c of result.checks) {
    console.log(`    ${c.passed ? '✓' : '✗'}  ${c.name.padEnd(25)} ${c.detail}`);
  }
  console.log();

  // The fix should make this task FAIL on the deploy_evidence check
  const deployCheck = result.checks.find((c) => c.name === 'deploy_evidence');
  if (deployCheck && !deployCheck.passed) {
    console.log('═══ ✅ FIX VERIFIED ═══');
    console.log('   The new verifier correctly identifies that NO DEPLOY tool was called.');
    console.log('   This task would now be marked FAILED (not completed) → no false credit charge.');
    process.exit(0);
  } else if (deployCheck && deployCheck.passed) {
    console.log('═══ ❌ FIX FAILED ═══');
    console.log('   deploy_evidence check passed but should have failed.');
    process.exit(1);
  } else {
    console.log('═══ ⚠ deploy_evidence check did not run ═══');
    console.log('   Tag classification may have routed this to a different verification level.');
    console.log(`   Verifier ran at level: ${result.level} — may need to also strengthen browser_flow.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
