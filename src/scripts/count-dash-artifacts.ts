import { db, companies, documents } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  const [mr] = await db.select().from(documents).where(and(
    eq(documents.company_id, c!.id),
    eq(documents.doc_type, 'market_research'),
  )).limit(1);
  if (!mr?.content) { console.log('no content'); process.exit(0); }

  const c1 = (mr.content.match(/\*\*/g) ?? []).length;
  const c2 = (mr.content.match(/ - /g) ?? []).length;     // space hyphen space
  const c3 = (mr.content.match(/ — /g) ?? []).length;     // space em-dash space
  const c4 = (mr.content.match(/ – /g) ?? []).length;     // space en-dash space
  const c5 = (mr.content.match(/—/g) ?? []).length;       // any em-dash (incl no-space)

  console.log(`In ${c!.slug} market_research:`);
  console.log(`  ** (bold markers):                   ${c1}`);
  console.log(`  " - " (space-hyphen-space):          ${c2}`);
  console.log(`  " — " (space-em-dash-space):         ${c3}`);
  console.log(`  " – " (space-en-dash-space):         ${c4}`);
  console.log(`  any "—" anywhere (incl punctuation): ${c5}`);

  // Show em-dash contexts
  if (c5 > 0) {
    console.log('\nEm-dash contexts (±30 chars):');
    let pos = 0;
    while (pos < mr.content.length) {
      const idx = mr.content.indexOf('—', pos);
      if (idx === -1) break;
      const start = Math.max(0, idx - 30);
      const end = Math.min(mr.content.length, idx + 30);
      console.log(`  …${mr.content.slice(start, end).replace(/\n/g, ' ')}…`);
      pos = idx + 1;
    }
  }
  process.exit(0);
})();
