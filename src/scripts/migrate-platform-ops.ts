// Additive-only schema migration for platform-ops Phase A.
// Idempotent: safe to re-run. Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
//
// What it adds:
//   - platform_feedback: 6 new nullable columns (diagnosis, estimated_risk,
//     ops_run_id, resolution, reproduced_at, approved_at, approved_by)
//   - platform_feedback: index on status
//   - platform_ops_runs: new table for full audit trail
//
// What it does NOT change: existing columns, existing data, existing indexes.
// The bug-write path (report_bug → INSERT into platform_feedback) keeps
// working unchanged.
//
// Run: npx tsx --env-file=.env.local src/scripts/migrate-platform-ops.ts

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('═══ platform-ops Phase A migration ═══\n');

  // 1. Add columns to platform_feedback (each idempotent)
  console.log('1. ALTER platform_feedback — additive columns...');
  const newCols = [
    `diagnosis TEXT`,
    `estimated_risk TEXT`,
    `ops_run_id UUID`,
    `resolution TEXT`,
    `reproduced_at TIMESTAMPTZ`,
    `approved_at TIMESTAMPTZ`,
    `approved_by TEXT`,
  ];
  for (const colDef of newCols) {
    const [colName] = colDef.split(' ');
    await db.execute(sql.raw(`ALTER TABLE platform_feedback ADD COLUMN IF NOT EXISTS ${colDef}`));
    console.log(`   ✓ ${colName}`);
  }

  // 2. Add index on status
  console.log('\n2. CREATE INDEX on platform_feedback.status...');
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_platform_feedback_status ON platform_feedback (status)`);
  console.log('   ✓');

  // 3. Create platform_ops_runs table
  console.log('\n3. CREATE platform_ops_runs table...');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS platform_ops_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      feedback_id UUID NOT NULL REFERENCES platform_feedback(id),
      agent_role TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      diagnosis TEXT,
      root_cause TEXT,
      files_to_modify JSONB,
      estimated_risk TEXT,
      reproduces BOOLEAN,
      branch_name TEXT,
      commit_sha TEXT,
      diff_hash TEXT,
      pr_url TEXT,
      pr_number INTEGER,
      repro_evidence JSONB,
      test_evidence JSONB,
      verifier_vote TEXT,
      verifier_reasoning TEXT,
      turns INTEGER,
      wall_clock_seconds INTEGER,
      cost_cents INTEGER,
      llm_provider TEXT,
      llm_model TEXT,
      error_summary TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_platform_ops_runs_feedback ON platform_ops_runs (feedback_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_platform_ops_runs_status ON platform_ops_runs (status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_platform_ops_runs_role_phase ON platform_ops_runs (agent_role, phase)`);
  console.log('   ✓ table + 3 indexes');

  // 4. Verify
  console.log('\n4. Verifying...');
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'platform_feedback' ORDER BY ordinal_position
  `) as unknown as { rows: Array<{ column_name: string }> };
  console.log(`   platform_feedback columns: ${cols.rows.map((r) => r.column_name).join(', ')}`);

  const opsCols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'platform_ops_runs' ORDER BY ordinal_position
  `) as unknown as { rows: Array<{ column_name: string }> };
  console.log(`   platform_ops_runs columns: ${opsCols.rows.length} total`);

  // 5. Confirm existing rows still readable
  const existing = await db.execute(sql`SELECT COUNT(*)::int as c FROM platform_feedback WHERE status = 'open'`) as unknown as { rows: Array<{ c: number }> };
  console.log(`   existing open bugs preserved: ${existing.rows[0]?.c ?? 0}`);

  console.log('\n═══ Migration complete (additive only) ═══');
  process.exit(0);
}

main().catch((e) => { console.error('Migration failed:', e); process.exit(1); });
