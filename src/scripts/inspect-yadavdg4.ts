// Inspect what the user actually submitted vs what got generated
import { db } from '@/lib/db';
import { companies, users, platformEvents, documents } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const [user] = await db.select().from(users).where(eq(users.email, 'yadavdg4@gmail.com')).limit(1);
  if (!user) { console.log('user not found'); process.exit(0); }

  const [c] = await db.select().from(companies).where(eq(companies.owner_id, user.id)).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no company'); process.exit(0); }

  console.log('=== COMPANY ===');
  console.log('name:        ', c.name);
  console.log('slug:        ', c.slug);
  console.log('one_liner:   ', c.one_liner);
  console.log('journey:     ', (c as unknown as { journey?: string }).journey);
  console.log('lifecycle:   ', c.lifecycle);
  console.log('original_idea:', (c as unknown as { original_idea?: string }).original_idea);
  console.log('strategy:    ', (c as unknown as { strategy?: string }).strategy);
  console.log('mission:     ', (c.mission ?? '').slice(0, 300));

  console.log('\n=== ONBOARDING START EVENT (the input) ===');
  const startEvents = await db.select().from(platformEvents)
    .where(eq(platformEvents.company_id, c.id))
    .orderBy(platformEvents.created_at)
    .limit(40);
  for (const e of startEvents) {
    if (e.event_type.includes('start') || e.event_type === 'onboarding_request' || e.event_type === 'onboarding_input') {
      console.log(`${e.event_type}:`, JSON.stringify(e.payload, null, 2).slice(0, 500));
    }
  }

  console.log('\n=== ALL EVENT TYPES ===');
  const types = new Set<string>();
  for (const e of startEvents) types.add(e.event_type);
  console.log(Array.from(types).join(', '));

  console.log('\n=== DOCUMENTS ===');
  const docs = await db.select().from(documents).where(eq(documents.company_id, c.id));
  for (const d of docs) {
    console.log(`-- ${d.kind} :: ${d.title} (${(d.content ?? '').length} chars)`);
    console.log((d.content ?? '').slice(0, 400));
    console.log('');
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
