// Inspect ALL platform_events for the E2E company to see who launched tasks
import { config } from 'dotenv';
config({ path: '.env.local' });

const COMPANY_ID = process.argv[2] ?? '6f6ec03c-0c5f-408a-ba4d-4b3d89b73660';

async function main() {
  const { db, platformEvents } = await import('../lib/db');
  const { eq, asc } = await import('drizzle-orm');

  const events = await db.select({
    type: platformEvents.event_type,
    payload: platformEvents.payload,
    created_at: platformEvents.created_at,
  }).from(platformEvents).where(eq(platformEvents.company_id, COMPANY_ID))
    .orderBy(asc(platformEvents.created_at));

  console.log(`\n${events.length} events for ${COMPANY_ID}:\n`);
  for (const e of events) {
    const ts = e.created_at?.toISOString().slice(11, 19) ?? '?';
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const summary = JSON.stringify(p).slice(0, 180);
    console.log(`  ${ts}  ${e.type.padEnd(28)}  ${summary}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
