// Re-apply the latest stripInlineMarkdown rules to the latest company's
// existing market_research and mission docs in the DB. Use when content
// was generated before a renderer fix landed.

import { db, companies, documents } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';
import * as documentService from '@/lib/services/document.service';
import { stripInlineMarkdown } from '@/lib/services/onboarding/shared/founder-doc-style';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('No company'); process.exit(0); }
  console.log(`Cleaning docs for: ${c.slug} (${c.name})\n`);

  const docs = await db.select().from(documents).where(eq(documents.company_id, c.id));
  let updated = 0;

  for (const doc of docs) {
    if (!doc.content) continue;
    if (!['market_research', 'mission', 'product_overview', 'tech_notes', 'brand_voice'].includes(doc.doc_type ?? '')) continue;

    // For market research, the content is sectioned markdown. Strip while
    // preserving line structure (so headings, tables, and bullet lists stay
    // intact while inline ** / * / leftover " - " separators are gone).
    const cleaned = stripInlineMarkdown(doc.content, { keepLineStructure: true });
    if (cleaned !== doc.content) {
      await documentService.updateDocument(doc.id, cleaned);
      updated++;
      const before = (doc.content.match(/\*\*/g) ?? []).length;
      const after = (cleaned.match(/\*\*/g) ?? []).length;
      console.log(`  ✓ ${doc.doc_type}: ${doc.content.length} → ${cleaned.length} chars; ** count ${before} → ${after}`);
    } else {
      console.log(`  - ${doc.doc_type}: no change needed`);
    }
  }

  console.log(`\nUpdated ${updated} doc(s).`);
  process.exit(0);
})();
