// Show all events for a company in a time window — debugging multi-tool LLM sequences
import { db, platformEvents } from '@/lib/db';
import { eq, gt, desc, and } from 'drizzle-orm';

async function main() {
  const since = new Date(Date.now() - 30 * 60 * 1000); // last 30 min
  const rows = await db.select({
    type: platformEvents.event_type,
    payload: platformEvents.payload,
    ts: platformEvents.created_at,
    company: platformEvents.company_id,
  })
    .from(platformEvents)
    .where(and(
      gt(platformEvents.created_at, since),
      eq(platformEvents.company_id, 'a7e330c0-7b6d-4a04-8860-ff2d36b10e2e'),
    ))
    .orderBy(desc(platformEvents.created_at))
    .limit(30);
  console.log(`Last 30 events for Threadmint in last 30min:`);
  for (const r of rows) {
    const ts = r.ts instanceof Date ? r.ts.toISOString() : String(r.ts);
    const p = r.payload as Record<string, unknown>;
    console.log(`  ${ts}  ${r.type.padEnd(20)}  ${JSON.stringify(p).slice(0, 100)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
