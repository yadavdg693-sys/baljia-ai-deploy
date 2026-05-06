// One-shot migration runner for the domain_skills table.
// Used because `npm run db:push` got truncated mid-stream.
// Safe to re-run — handles "already exists" gracefully.

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

(async () => {
  const migration = readFileSync(join(process.cwd(), 'drizzle/0002_sticky_fallen_one.sql'), 'utf8');
  const statements = migration.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    console.log('Running:', stmt.substring(0, 80) + '...');
    try {
      await db.execute(sql.raw(stmt));
      console.log('  OK');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('already exists')) {
        console.log('  SKIP (already exists)');
      } else {
        console.log('  FAIL:', msg);
        process.exit(1);
      }
    }
  }
  console.log('Migration complete');
  process.exit(0);
})();
