// Debug: end-to-end test of CEO `create_task` tool handler.
// Picks the most-recently-active company, calls handleToolCall directly,
// queries the tasks table to confirm the row landed, then sets the row to
// `rejected` so it never appears in the founder's queue.
//
// Run: npx tsx --env-file=.env.local src/scripts/debug-create-task.ts
//   or: npx tsx --env-file=.env.local src/scripts/debug-create-task.ts <company_email>
//
// Note: the --env-file flag is required because @/lib/db calls neon(process.env.DATABASE_URL)
// at module-load time, BEFORE the in-script dotenv loadEnv() can run. Node 22's
// --env-file populates process.env before any module imports resolve.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, tasks, users } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';
import { handleToolCall } from '@/lib/agents/ceo/ceo.tools';

async function main() {
  const email = process.argv[2];

  // Resolve target company: by email if provided, else most recently updated.
  let companyRow: { id: string; slug: string | null; name: string | null } | undefined;

  if (email) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      console.error(`No user with email ${email}`);
      process.exit(1);
    }
    const [c] = await db.select({ id: companies.id, slug: companies.slug, name: companies.name })
      .from(companies)
      .where(eq(companies.owner_id, user.id))
      .orderBy(desc(companies.updated_at))
      .limit(1);
    companyRow = c;
  } else {
    const [c] = await db.select({ id: companies.id, slug: companies.slug, name: companies.name })
      .from(companies)
      .orderBy(desc(companies.updated_at))
      .limit(1);
    companyRow = c;
  }

  if (!companyRow) {
    console.error('No company found.');
    process.exit(1);
  }

  const companyId = companyRow.id;
  console.log(`Target company: ${companyRow.name ?? '(no name)'} [${companyRow.slug ?? '-'}] ${companyId}\n`);

  // Snapshot tasks BEFORE
  const before = await db.select({ id: tasks.id, title: tasks.title })
    .from(tasks).where(eq(tasks.company_id, companyId));
  console.log(`Tasks before: ${before.length}`);

  // Call create_task exactly the way the CEO LLM would.
  console.log(`\nCalling handleToolCall('create_task', ...)`);
  const result = await handleToolCall(
    'create_task',
    {
      title: 'DEBUG repro task',
      description: 'Verify create_task works end-to-end',
      tag: 'research',
    },
    companyId,
  );

  console.log('\nToolResult.content:');
  console.log(result.content);
  console.log('\nToolResult.action:');
  console.dir(result.action, { depth: 5 });

  // Confirm the row was written.
  const after = await db.select().from(tasks)
    .where(and(eq(tasks.company_id, companyId), eq(tasks.title, 'DEBUG repro task')))
    .orderBy(desc(tasks.created_at))
    .limit(1);

  if (after.length === 0) {
    console.error('\nFAIL: no DEBUG repro task row found in tasks table.');
    process.exit(2);
  }

  const t = after[0];
  console.log(`\nINSERT confirmed:`);
  console.log(`  id=${t.id}`);
  console.log(`  status=${t.status}`);
  console.log(`  source=${t.source}`);
  console.log(`  tag=${t.tag}`);
  console.log(`  assigned_to_agent_id=${t.assigned_to_agent_id}`);
  console.log(`  execution_mode=${t.execution_mode}`);
  console.log(`  verification_level=${t.verification_level}`);

  // Cleanup: reject so it doesn't pollute the queue.
  await db.update(tasks).set({ status: 'rejected', updated_at: new Date() })
    .where(eq(tasks.id, t.id));
  console.log(`\nCleanup: task ${t.id} → rejected.`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
