// Inspect tasks for the E2E test company to find why a [Retry] was spawned
import { config } from 'dotenv';
config({ path: '.env.local' });

const COMPANY_ID = process.argv[2] ?? '6f6ec03c-0c5f-408a-ba4d-4b3d89b73660';

async function main() {
  const { db, tasks, platformEvents } = await import('../lib/db');
  const { eq, and, asc, inArray } = await import('drizzle-orm');

  const rows = await db.select({
    id: tasks.id,
    title: tasks.title,
    tag: tasks.tag,
    status: tasks.status,
    source: tasks.source,
    related_task_ids: tasks.related_task_ids,
    failure_class: tasks.failure_class,
    repair_attempt_count: tasks.repair_attempt_count,
    authorized_by: tasks.authorized_by,
    authorization_reason: tasks.authorization_reason,
    created_at: tasks.created_at,
  }).from(tasks).where(eq(tasks.company_id, COMPANY_ID))
    .orderBy(asc(tasks.created_at));

  console.log(`\nTasks for ${COMPANY_ID}:\n`);
  for (const t of rows) {
    console.log(`  [${t.status.padEnd(12)}] ${t.tag.padEnd(11)} src=${(t.source ?? '?').padEnd(20)} | ${t.title}`);
    console.log(`    id=${t.id}  authorized_by=${t.authorized_by ?? '?'}  failure_class=${t.failure_class ?? '-'}  repair=${t.repair_attempt_count ?? 0}`);
    if (t.related_task_ids) console.log(`    related_task_ids=${JSON.stringify(t.related_task_ids)}`);
    if (t.authorization_reason) console.log(`    reason=${t.authorization_reason.slice(0, 120)}`);
  }

  // Look at task-related events
  const events = await db.select({
    type: platformEvents.event_type,
    payload: platformEvents.payload,
    created_at: platformEvents.created_at,
  }).from(platformEvents).where(and(
    eq(platformEvents.company_id, COMPANY_ID),
    inArray(platformEvents.event_type, ['task_created', 'task_failed', 'task_completed', 'remediation_run']),
  )).orderBy(asc(platformEvents.created_at));

  console.log(`\nTask events:\n`);
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    console.log(`  ${e.type.padEnd(20)}  ${JSON.stringify(p).slice(0, 200)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
