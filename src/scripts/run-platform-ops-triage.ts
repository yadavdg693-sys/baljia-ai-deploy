// Run platform-ops triage agent on currently open bugs.
// Phase A — read-only diagnosis. NO code changes. NO PRs. Just diagnoses
// stored back to platform_feedback + a row in platform_ops_runs per bug.
//
// Run: npx tsx --env-file=.env.local src/scripts/run-platform-ops-triage.ts

import { triageOpenBugs } from '@/lib/services/platform-ops.service';

async function main() {
  console.log('═══ Platform-Ops Triage (Phase A — read-only) ═══\n');
  console.log(`PLATFORM_OPS_PAUSED:           ${process.env.PLATFORM_OPS_PAUSED ?? '(unset, running)'}`);
  console.log(`PLATFORM_OPS_DAILY_BUDGET_USD: ${process.env.PLATFORM_OPS_DAILY_BUDGET_USD ?? '20 (default)'}`);
  console.log(`PLATFORM_OPS_MAX_BUGS_PER_RUN: ${process.env.PLATFORM_OPS_MAX_BUGS_PER_RUN ?? '5 (default)'}`);
  console.log();

  const start = Date.now();
  const results = await triageOpenBugs();
  const totalSec = Math.round((Date.now() - start) / 1000);

  console.log(`\n═══ ${results.length} bug(s) processed in ${totalSec}s ═══\n`);

  for (const r of results) {
    console.log(`── ${r.feedbackId.slice(0, 8)}… ──`);
    console.log(`  status: ${r.status}  turns: ${r.turns}  wall: ${r.wallClockSeconds}s  cost: $${(r.costCents / 100).toFixed(2)}`);
    if (r.reason) console.log(`  reason: ${r.reason}`);
    if (r.diagnosis) {
      console.log(`  reproduces: ${r.diagnosis.reproduces}`);
      console.log(`  risk:       ${r.diagnosis.estimated_risk}`);
      console.log(`  files:      ${r.diagnosis.files_to_modify.join(', ') || '(none)'}`);
      console.log(`  root cause: ${r.diagnosis.root_cause.slice(0, 200)}`);
    }
    console.log();
  }

  const totalCost = results.reduce((s, r) => s + r.costCents, 0);
  console.log(`Total LLM cost: $${(totalCost / 100).toFixed(2)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
