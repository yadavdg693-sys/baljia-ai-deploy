// Migration: add durable-execution lease columns to tasks table.
// Run once per environment (dev + prod): npx tsx scripts/migrate-durable-execution.ts
//
// Idempotent — uses IF NOT EXISTS everywhere. Safe to re-run.

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  console.log('Adding durable-execution lease columns to tasks...');

  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_holder VARCHAR(255)`;
  console.log('  ✓ lease_holder');

  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`;
  console.log('  ✓ lease_expires_at');

  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0`;
  console.log('  ✓ attempt_count');

  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks(status, lease_expires_at)`;
  console.log('  ✓ idx_tasks_claim');

  // Verify
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'tasks'
      AND column_name IN ('lease_holder', 'lease_expires_at', 'attempt_count')
    ORDER BY column_name
  ` as Array<{ column_name: string; data_type: string }>;

  console.log('\nVerified columns on tasks:');
  for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type}`);

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'tasks' AND indexname = 'idx_tasks_claim'
  ` as Array<{ indexname: string }>;
  console.log(`\nVerified index: ${idx[0]?.indexname ?? 'MISSING'}`);

  console.log('\n✅ Migration complete.');
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
