// Trace how the founder's raw idea became the final company.
import { db, companies, documents, platformEvents } from '@/lib/db';
import { desc, eq, and } from 'drizzle-orm';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('No companies'); process.exit(0); }

  console.log(`━━━ Company: ${c.slug} (${c.name}) ━━━\n`);
  console.log(`raw_idea field:`);
  console.log(`  ${(c as Record<string, unknown>).raw_idea ?? '(not set)'}\n`);
  console.log(`one_liner: ${c.one_liner ?? '(not set)'}\n`);

  // Find onboarding events that captured the original input + refinement
  const events = await db.select().from(platformEvents)
    .where(and(eq(platformEvents.company_id, c.id)))
    .orderBy(platformEvents.created_at);

  console.log(`━━━ Platform events (${events.length}) ━━━`);
  for (const e of events) {
    const event_type = (e as Record<string, unknown>).event_type;
    if (typeof event_type === 'string' && (
      event_type.includes('onboarding') ||
      event_type.includes('idea') ||
      event_type.includes('refined') ||
      event_type.includes('research')
    )) {
      const payload = e.payload as Record<string, unknown> | null;
      console.log(`  [${e.created_at}] ${event_type}`);
      if (payload) {
        const interesting: Record<string, unknown> = {};
        for (const k of ['raw_idea', 'refined_idea', 'changes_made', 'rationale', 'message', 'note', 'stage']) {
          if (payload[k] !== undefined) interesting[k] = payload[k];
        }
        if (Object.keys(interesting).length) console.log(`    ${JSON.stringify(interesting, null, 2).split('\n').join('\n    ')}`);
      }
    }
  }

  // Check refined idea in mission doc or refined_idea storage
  const docs = await db.select().from(documents).where(eq(documents.company_id, c.id));
  console.log(`\n━━━ Documents (${docs.length}) ━━━`);
  for (const d of docs) {
    console.log(`  ${d.doc_type} (v${d.version ?? 1})`);
  }
  const mission = docs.find(d => d.doc_type === 'mission');
  if (mission?.content) {
    console.log(`\n━━━ Mission doc ━━━\n${mission.content.slice(0, 1000)}`);
  }
  process.exit(0);
})();
