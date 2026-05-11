// Find the founder's raw input wherever it was captured.
import { db, companies, memoryLayers, platformEvents } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }
  console.log(`Company: ${c.slug} (${c.name})\n`);
  console.log('--- companies table columns of interest ---');
  for (const k of ['raw_idea', 'idea', 'one_liner', 'mission', 'name', 'slug', 'strategy'] as const) {
    const v = (c as Record<string, unknown>)[k];
    if (v) console.log(`  ${k}: ${String(v).slice(0, 250)}`);
  }

  // Memory layers — onboarding writes context here
  const layers = await db.select().from(memoryLayers).where(eq(memoryLayers.company_id, c.id));
  console.log(`\n--- memory_layers (${layers.length}) ---`);
  for (const l of layers) {
    console.log(`\nLayer ${l.layer}:`);
    console.log((l.content ?? '').slice(0, 1200));
  }

  // Onboarding activity events — look for "Refined:" or "Invented:" or "Original input:"
  const events = await db.select().from(platformEvents).where(eq(platformEvents.company_id, c.id));
  console.log(`\n--- key activity log entries ---`);
  for (const e of events) {
    const p = e.payload as Record<string, unknown> | null;
    if (!p) continue;
    const msg = String(p.message ?? p.note ?? '');
    if (/refined|invented|original|idea|multibagg|equity/i.test(msg)) {
      console.log(`  [${(p as { stage?: string }).stage ?? '?'}] ${msg.slice(0, 300)}`);
    }
  }
  process.exit(0);
})();
