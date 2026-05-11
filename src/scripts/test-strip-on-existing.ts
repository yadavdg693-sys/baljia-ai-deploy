// Apply the latest stripInlineMarkdown to the existing market_research doc
// to prove the fix works on previously-generated content.
import { db, companies, documents } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';
import { stripInlineMarkdown } from '@/lib/services/onboarding/shared/founder-doc-style';

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('No company'); process.exit(0); }

  const [mr] = await db.select().from(documents).where(and(
    eq(documents.company_id, c.id),
    eq(documents.doc_type, 'market_research'),
  )).limit(1);

  if (!mr?.content) { console.log('No market research'); process.exit(0); }

  // Take the Market Validation section as a sample
  const lines = mr.content.split('\n');
  const startIdx = lines.findIndex((l) => /^## Market Validation/.test(l));
  const endIdx = lines.findIndex((l, i) => i > startIdx && /^## /.test(l));
  const original = lines.slice(startIdx, endIdx).join('\n');

  console.log('━━━ ORIGINAL (pre-fix, in DB now) ━━━\n');
  console.log(original);
  console.log('\n━━━ AFTER stripInlineMarkdown (latest code) ━━━\n');
  console.log(stripInlineMarkdown(original, { keepLineStructure: true }));

  console.log('\n━━━ Same applied to a competitor cell (plain text) ━━━\n');
  // Find the first competitor row in the table
  const tableRow = lines.find((l) => l.startsWith('| ') && !l.startsWith('| Competitor') && !l.startsWith('|---'));
  if (tableRow) {
    console.log(`ORIGINAL: ${tableRow}`);
    console.log(`STRIPPED: ${stripInlineMarkdown(tableRow)}`);
  }

  process.exit(0);
})();
