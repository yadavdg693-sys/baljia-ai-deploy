// What's in platform_feedback right now? Who's actually reading it?
import { db, platformFeedback } from '@/lib/db';
import { desc } from 'drizzle-orm';

async function main() {
  const rows = await db.select().from(platformFeedback)
    .orderBy(desc(platformFeedback.created_at)).limit(30);
  console.log(`Total rows seen: ${rows.length}\n`);
  for (const r of rows) {
    const ts = (r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at))).toISOString().slice(0, 16);
    console.log(`  [${ts}] ${r.type?.padEnd(15)} severity=${(r.severity ?? '?').padEnd(8)} status=${(r.status ?? '?').padEnd(10)}`);
    console.log(`    "${r.title}"`);
    if (r.description && r.description.length > 0) {
      console.log(`    desc: ${r.description.slice(0, 200).replace(/\n/g, ' ')}`);
    }
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
