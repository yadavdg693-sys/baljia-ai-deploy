// Regenerate the one_liner for the latest company via LLM.
// Reads the existing mission doc and asks for a ≤14-word topbar tagline.
//
// Use after onboarding when the topbar shows a mid-clause fragment or an
// overly long sentence that doesn't fit the UI chrome.
import { db, companies, documents } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';
import { callSmallLLM } from '@/lib/services/onboarding/llm/small-llm';
import { stripInlineMarkdown } from '@/lib/services/onboarding/shared/founder-doc-style';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }

  const [mission] = await db.select().from(documents).where(and(
    eq(documents.company_id, c.id),
    eq(documents.doc_type, 'mission'),
  )).limit(1);
  if (!mission?.content) { console.log('no mission doc'); process.exit(0); }

  const content = mission.content;

  const prompt = `You write a dashboard topbar tagline for a company. ONE short descriptive line stating WHAT the product is and WHO it's for. Max 14 words / ~80 characters.

Pattern: "<short noun phrase> for <audience>" or "<verb-led description in <= 14 words>".

Examples (DO NOT copy verbatim, just match length and shape):
- AI stock research for retail Indian investors.
- Auto-confirmation tool for solo dental clinics.
- Cold outreach copywriter for SaaS founders.

Rules:
- NEVER more than 14 words.
- NEVER ends with a comma or "covering..." style fragment.
- Concrete, not aspirational.
- One line, no quotes, no markdown.

Company name: ${c.company_name}

Mission doc:
${content}

Output ONLY the one-line tagline, nothing else.`;

  const raw = await callSmallLLM(prompt, 60);
  const cleaned = stripInlineMarkdown(raw.trim().replace(/^["']|["']$/g, '').split('\n')[0].trim());

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
