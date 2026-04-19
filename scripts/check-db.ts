// One-off DB sanity check — verifies platform Neon is reachable and schema is applied.
// Run: npx tsx scripts/check-db.ts
//
// Specifically validates that the tables the onboarding pipeline writes to exist:
//   companies, users, memory_layers, credit_ledger, platform_events, documents

import * as dotenv from 'dotenv';
import * as path from 'path';
// Load .env.local first (Next.js convention), then fall back to .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Dynamic import — env vars must be set BEFORE the db client module evaluates
// (its module-level code calls neon(process.env.DATABASE_URL!) at import time).

const REQUIRED_TABLES = [
  'companies',
  'users',
  'memory_layers',
  'credit_ledger',
  'platform_events',
  'documents',
  'tasks',
  'subscriptions',
  'magic_link_tokens',
  'email_threads',
  'agents',
];

async function main() {
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
  console.log('Connecting...\n');

  const { db } = await import('../src/lib/db/client');
  const { sql } = await import('drizzle-orm');

  const result = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const present = new Set((result.rows as Array<{ table_name: string }>).map((r) => r.table_name));

  console.log(`Found ${present.size} tables in public schema.`);
  console.log('');
  console.log('Required tables (for onboarding to write company rows):');
  let missing = 0;
  for (const t of REQUIRED_TABLES) {
    const ok = present.has(t);
    console.log(`  ${ok ? 'OK ' : 'MISSING'}  ${t}`);
    if (!ok) missing++;
  }

  // Quick row counts for the most-written tables
  console.log('\nRow counts:');
  for (const t of ['companies', 'users', 'agents']) {
    if (!present.has(t)) continue;
    try {
      const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM "${t}"`));
      const n = (r.rows[0] as { c: number }).c;
      console.log(`  ${t}: ${n}`);
    } catch (err) {
      console.log(`  ${t}: query failed — ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  console.log(`\nResult: ${missing === 0 ? 'PASS — schema is fully applied' : `FAIL — ${missing} required table(s) missing`}`);
  process.exit(missing === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('DB check threw:', err instanceof Error ? err.message : err);
  process.exit(1);
});
