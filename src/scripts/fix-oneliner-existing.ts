// Reapply the new full-first-sentence oneLiner rule to the latest company
// in the DB so the existing dashboard shows the full sentence.
import { db, companies, documents } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';
import { stripInlineMarkdown } from '@/lib/services/onboarding/shared/founder-doc-style';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }

  // Grab the mission doc to extract what_were_building's first sentence.
  const [mission] = await db.select().from(documents).where(and(
    eq(documents.company_id, c.id),
    eq(documents.doc_type, 'mission'),
  )).limit(1);

  // Mission doc content is markdown — extract the "What We're Building" block.
  if (!mission?.content) { console.log('no mission doc'); process.exit(0); }
  const content = mission.content;

  // Find the section after "## What we're building" or similar.
  const match = content.match(/##\s+What.{0,30}building[\s\S]*?\n([\s\S]+?)(?=\n##|\n*$)/i);
  const buildingSection = (match?.[1] ?? '').trim();

  if (!buildingSection) {
    console.log('no what_were_building section found in mission doc');
    process.exit(0);
  }

  const firstSentence = buildingSection.split(/[.!?]/)[0].trim();
  const cleaned = stripInlineMarkdown(firstSentence);

  console.log(`Current one_liner: ${c.one_liner ?? '(none)'}`);
  console.log(`New one_liner:     ${cleaned}`);

  if (cleaned && cleaned !== c.one_liner) {
    await db.update(companies).set({ one_liner: cleaned }).where(eq(companies.id, c.id));
    console.log('\n✓ Updated.');
  } else {
    console.log('\n- No change needed.');
  }
  process.exit(0);
})();
