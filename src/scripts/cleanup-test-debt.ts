// Soft-clean leftover test fixtures for a company. Sets matching tasks to
// status='rejected' (FK-safe; doesn't actually delete rows that may be
// referenced from credit_ledger / task_executions / platform_events).
//
// Run: npx tsx --env-file=.env.local src/scripts/cleanup-test-debt.ts [companyId]

import { db, tasks } from '@/lib/db';
import { and, eq, inArray, like, or } from 'drizzle-orm';

const TEST_MARKERS = [
  'AGENT-TEST',
  'PARITY-UI',
  'TEST_E2E_DEBUG',
  'E2E-DEBUG',
  'SUPPORT-INBOUND-TEST',
  'DEBUG repro',
];

async function main() {
  const cid = process.argv[2] || 'a7e330c0-7b6d-4a04-8860-ff2d36b10e2e';
  const updated = await db.update(tasks)
    .set({ status: 'rejected' })
    .where(and(
      eq(tasks.company_id, cid),
      inArray(tasks.status, ['todo', 'in_progress']),
      or(...TEST_MARKERS.map((m) => like(tasks.title, `%${m}%`))),
    ))
    .returning({ id: tasks.id, title: tasks.title });
  console.log(`Cleaned ${updated.length} leftover test tasks (set to rejected):`);
  for (const t of updated) console.log(`  - ${t.title}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
