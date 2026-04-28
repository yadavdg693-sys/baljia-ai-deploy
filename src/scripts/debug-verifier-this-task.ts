// Diagnose: why did verifier mark bdc6210c task as failed despite deploy?
// Run: npx tsx --env-file=.env.local src/scripts/debug-verifier-this-task.ts

import { db, tasks } from '@/lib/db';
import { like, desc, eq, and } from 'drizzle-orm';
import { verifyTask } from '@/lib/services/verification.service';

async function main() {
  const [task] = await db.select().from(tasks)
    .where(and(like(tasks.title, '%tiny contact form%'), eq(tasks.tag, 'engineering')))
    .orderBy(desc(tasks.created_at))
    .limit(1);

  if (!task) { console.error('not found'); process.exit(1); }

  console.log(`task: ${task.id}`);
  console.log(`title: ${task.title}`);
  console.log(`tag: ${task.tag}`);
  console.log(`status: ${task.status}`);
  console.log(`failure_class: ${task.failure_class}`);
  console.log(`turn_count: ${task.turn_count}`);
  console.log(`started_at: ${task.started_at}`);
  console.log(`completed_at: ${task.completed_at}`);
  console.log(`verification_level (stored): ${task.verification_level ?? '(none)'}`);
  console.log();

  // Run with stored level
  const r1 = await verifyTask(task);
  console.log(`══ With stored level (${task.verification_level ?? 'auto'}) ══`);
  console.log(`  level: ${r1.level}`);
  console.log(`  passed: ${r1.passed}`);
  console.log(`  summary: ${r1.summary}`);
  for (const c of r1.checks) console.log(`    ${c.passed ? '✓' : '✗'}  ${c.name.padEnd(25)} ${c.detail.slice(0, 100)}`);
  console.log();

  // Run with verification_level cleared so we use determineLevel
  const r2 = await verifyTask({ ...task, verification_level: null } as typeof task);
  console.log(`══ With verification_level=null (determineLevel re-runs) ══`);
  console.log(`  level: ${r2.level}`);
  console.log(`  passed: ${r2.passed}`);
  console.log(`  summary: ${r2.summary}`);
  for (const c of r2.checks) console.log(`    ${c.passed ? '✓' : '✗'}  ${c.name.padEnd(25)} ${c.detail.slice(0, 100)}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
