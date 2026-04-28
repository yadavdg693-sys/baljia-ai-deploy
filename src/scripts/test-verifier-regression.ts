// Regression tests for the verifier: re-run on real task records to confirm
// (a) silent-failure task still gets rejected
// (b) successful deploy task now correctly passes (was false-rejected when
//     verifier required has_report as a hard check)
// Run: npx tsx --env-file=.env.local src/scripts/test-verifier-regression.ts

import { db, tasks } from '@/lib/db';
import { eq, like, desc, and } from 'drizzle-orm';
import { verifyTask } from '@/lib/services/verification.service';

const QUERYFORGE_NOOP_TASK = '9a36e013-6527-4c8d-84a4-8162a063cd26';

async function checkTask(taskId: string, expectedPass: boolean, label: string): Promise<boolean> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) { console.log(`  ⚠ ${label}: task ${taskId} not found, skipping`); return true; }
  const taskFresh = { ...task, verification_level: null } as typeof task;
  const result = await verifyTask(taskFresh);

  console.log(`── ${label} ──`);
  console.log(`  task: "${task.title}" (tag=${task.tag})`);
  console.log(`  level: ${result.level}`);
  console.log(`  result.passed: ${result.passed} (expected: ${expectedPass})`);
  console.log(`  summary: ${result.summary}`);
  for (const c of result.checks) {
    console.log(`    ${c.passed ? '✓' : '✗'}  ${c.name.padEnd(25)} ${c.detail.slice(0, 100)}`);
  }
  console.log();
  return result.passed === expectedPass;
}

async function main() {
  console.log('═══ Verifier regression checks ═══\n');

  // Case 1: queryforge campaign-generator — agent never deployed. Must FAIL.
  const case1 = await checkTask(
    QUERYFORGE_NOOP_TASK,
    /* expectedPass */ false,
    'CASE 1: queryforge no-op task should still FAIL',
  );

  // Case 2: most recent terse-task test — agent successfully deployed.
  // Find by title pattern. Must PASS.
  const [recentDeploy] = await db.select()
    .from(tasks)
    .where(and(
      like(tasks.title, '%tiny contact form%'),
      eq(tasks.tag, 'engineering'),
    ))
    .orderBy(desc(tasks.created_at))
    .limit(1);

  let case2 = true;
  if (recentDeploy) {
    case2 = await checkTask(
      recentDeploy.id,
      /* expectedPass */ true,
      'CASE 2: terse contact-form task with successful deploy should PASS',
    );
  } else {
    console.log('── CASE 2: skipped (no recent contact-form task in DB) ──\n');
  }

  if (case1 && case2) {
    console.log('═══ ✅ BOTH REGRESSION CASES PASSED ═══');
    console.log('   Verifier correctly distinguishes "shipped" from "did nothing".');
    process.exit(0);
  } else {
    console.log('═══ ❌ REGRESSION FAILED ═══');
    if (!case1) console.log('   CASE 1: no-op task incorrectly passed (or expected mismatch)');
    if (!case2) console.log('   CASE 2: successful deploy incorrectly failed');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
