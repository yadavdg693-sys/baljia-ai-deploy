// Migration script: Map legacy 5-class failure taxonomy to canonical 8-class (SPEC-CTRL-106)
// Run: npx tsx src/scripts/migrate-failure-classes.ts

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { LEGACY_FAILURE_CLASS_MAP } from '@/types';

async function migrate() {
  console.log('Migrating failure classes to canonical 8-class taxonomy...');

  for (const [legacy, canonical] of Object.entries(LEGACY_FAILURE_CLASS_MAP)) {
    const result = await db.execute(sql`
      UPDATE tasks SET failure_class = ${canonical}
      WHERE failure_class = ${legacy}
    `);
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) console.log(`  tasks: ${legacy} → ${canonical}: ${count} rows`);

    const fpResult = await db.execute(sql`
      UPDATE failure_fingerprints SET category = ${canonical}
      WHERE category = ${legacy}
    `);
    const fpCount = (fpResult as unknown as { rowCount?: number }).rowCount ?? 0;
    if (fpCount > 0) console.log(`  failure_fingerprints: ${legacy} → ${canonical}: ${fpCount} rows`);
  }

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
