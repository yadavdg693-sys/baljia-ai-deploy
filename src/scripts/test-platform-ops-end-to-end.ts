// End-to-end test of the platform-ops self-healing loop:
//   1. Pick the Hunter.io bug (status=awaiting_approval)
//   2. Manually flip to 'approved_to_fix' (simulating Gate 1 admin click)
//   3. Run the writer agent → opens a PR
//   4. Run the verifier agent → posts review on PR
//   5. Show final state
//
// Does NOT merge the PR (that's a human decision at Gate 2).
// Does NOT run on schema/auth/billing files (whitelist enforces).
//
// Run: npx tsx --env-file=.env.local src/scripts/test-platform-ops-end-to-end.ts

import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, sql, desc } from 'drizzle-orm';
import { fixApprovedBug } from '@/lib/services/platform-ops-writer.service';
import { verifyOpenPr } from '@/lib/services/platform-ops-verifier.service';

async function main() {
  console.log('═══ Platform-Ops End-to-End Test ═══\n');

  // 1. Find the Hunter.io bug
  const [bug] = await db.select().from(platformFeedback)
    .where(sql`${platformFeedback.title} ILIKE '%hunter%'`).limit(1);
  if (!bug) { console.error('Hunter bug not found'); process.exit(1); }

  console.log(`Found bug: "${bug.title}"`);
  console.log(`  current status: ${bug.status}`);
  console.log(`  diagnosis present: ${!!bug.diagnosis}`);
  console.log();

  // 2. Simulate Gate 1 approve
  console.log('1. Simulating Gate 1 admin approve...');
  await db.update(platformFeedback).set({
    status: 'approved_to_fix',
    approved_at: new Date(),
    approved_by: 'human:e2e-test@baljia.ai',
  }).where(eq(platformFeedback.id, bug.id));
  console.log('   ✓ status → approved_to_fix\n');

  // 3. Run writer agent
  console.log('2. Running writer agent (this will open a real PR)...');
  const writerStart = Date.now();
  const writerResult = await fixApprovedBug(bug.id);
  const writerSec = Math.round((Date.now() - writerStart) / 1000);
  console.log(`   status: ${writerResult.status}  (${writerSec}s)`);
  console.log(`   turns: ${writerResult.turns}`);
  console.log(`   cost:  $${(writerResult.costCents / 100).toFixed(2)}`);
  if (writerResult.prUrl) console.log(`   PR:    ${writerResult.prUrl}`);
  if (writerResult.branchName) console.log(`   branch: ${writerResult.branchName}`);
  if (writerResult.reason) console.log(`   reason: ${writerResult.reason}`);
  console.log();

  if (writerResult.status !== 'done') {
    console.log('═══ ❌ Writer failed ═══');
    process.exit(1);
  }

  // 4. Run verifier agent on the just-opened PR
  console.log('3. Running verifier agent on the PR...');
  const verifierStart = Date.now();
  const verifierResult = await verifyOpenPr(bug.id);
  const verifierSec = Math.round((Date.now() - verifierStart) / 1000);
  console.log(`   status: ${verifierResult.status}  (${verifierSec}s)`);
  console.log(`   turns: ${verifierResult.turns}`);
  console.log(`   cost:  $${(verifierResult.costCents / 100).toFixed(2)}`);
  console.log(`   vote:  ${verifierResult.vote ?? '—'}`);
  if (verifierResult.prCommentUrl) console.log(`   comment: ${verifierResult.prCommentUrl}`);
  if (verifierResult.reasoning) console.log(`   reasoning (snippet): ${verifierResult.reasoning.slice(0, 200)}`);
  console.log();

  // 5. Show final audit trail
  console.log('4. Audit trail for this bug:');
  const runs = await db.select().from(platformOpsRuns)
    .where(eq(platformOpsRuns.feedback_id, bug.id))
    .orderBy(desc(platformOpsRuns.created_at));
  for (const r of runs) {
    console.log(`   ${r.created_at?.toString().slice(0, 16)} ${r.agent_role.padEnd(10)} ${r.phase.padEnd(10)} status=${r.status.padEnd(8)} turns=${r.turns ?? '—'} cost=$${((r.cost_cents ?? 0) / 100).toFixed(2)}`);
  }
  console.log();

  const [updated] = await db.select().from(platformFeedback).where(eq(platformFeedback.id, bug.id));
  console.log(`Final bug status: ${updated?.status}`);
  console.log();

  const totalCost = (writerResult.costCents + verifierResult.costCents) / 100;
  const allOk = writerResult.status === 'done' && verifierResult.status === 'done';
  console.log(`${allOk ? '═══ ✅ END-TO-END LOOP WORKS ═══' : '═══ ⚠ Partial result ═══'}`);
  console.log(`Total cost: $${totalCost.toFixed(2)} (writer + verifier)`);
  console.log(`PR ready for human Gate 2 review.`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
