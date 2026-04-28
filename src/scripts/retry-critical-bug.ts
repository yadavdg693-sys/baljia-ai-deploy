// Re-triage the critical bug that timed out at 20 turns. With grep_repo
// fixed and turn cap bumped to 35 for critical bugs, this should succeed.
// Run: npx tsx --env-file=.env.local src/scripts/retry-critical-bug.ts

import { db, platformFeedback } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';
import { triageBug } from '@/lib/services/platform-ops.service';

async function main() {
  // Find the critical "Created task not appearing in dashboard" bug
  const [bug] = await db.select().from(platformFeedback)
    .where(sql`${platformFeedback.title} ILIKE '%not appearing%'`)
    .limit(1);
  if (!bug) { console.error('not found'); process.exit(1); }

  console.log(`Re-triaging: "${bug.title}"`);
  console.log(`Current status: ${bug.status}`);
  console.log();

  // Reset status to 'open' so triage will pick it up cleanly
  await db.update(platformFeedback)
    .set({ status: 'open', diagnosis: null, ops_run_id: null })
    .where(eq(platformFeedback.id, bug.id));

  const result = await triageBug(bug.id);

  console.log(`\n═══ Result ═══`);
  console.log(`status: ${result.status}`);
  console.log(`turns:  ${result.turns}`);
  console.log(`wall:   ${result.wallClockSeconds}s`);
  console.log(`cost:   $${(result.costCents / 100).toFixed(2)}`);
  if (result.reason) console.log(`reason: ${result.reason}`);
  if (result.diagnosis) {
    console.log(`reproduces: ${result.diagnosis.reproduces}`);
    console.log(`risk: ${result.diagnosis.estimated_risk}`);
    console.log(`files: ${result.diagnosis.files_to_modify.join(', ')}`);
    console.log(`\nROOT CAUSE:\n${result.diagnosis.root_cause}`);
    console.log(`\nFULL DIAGNOSIS:\n${result.diagnosis.diagnosis}`);
  }
  process.exit(result.status === 'done' ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
