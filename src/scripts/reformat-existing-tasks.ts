// Apply the latest task-shape line-break formatter to existing tasks
// already stored in the DB (which were generated as single-paragraph text).
import { db, tasks, companies } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { stripInlineMarkdown } from '@/lib/services/onboarding/shared/founder-doc-style';

// Reuse the same formatter shape as create-starter-tasks.ts.
function applyTaskShapeLineBreaks(s: string): string {
  let out = s;
  out = out.replace(/\s+Input:\s+/g, '\n\nInput: ');
  out = out.replace(/\s+Output:\s+/g, '\nOutput: ');
  out = out.replace(/\s+Core flow:\s+/g, '\nCore flow: ');
  out = out.replace(/([.!?])\s+Use\s+/g, '$1\nUse ');
  out = out.replace(/\s+For each:\s+/g, '\nFor each: ');
  out = out.replace(/\s+Document:\s+/g, '\nDocument: ');
  out = out.replace(/([.!?])\s+Identify\s+/g, '$1\nIdentify ');
  out = out.replace(/([.!?:])\s+(Find|Identify|Target|Send|Focus|Goal|Reach|Search|Track)\b/g, '$1\n$2');
  return out;
}

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }
  const all = await db.select().from(tasks).where(eq(tasks.company_id, c.id));

  for (const t of all) {
    if (!t.description) continue;
    const withBreaks = applyTaskShapeLineBreaks(t.description.replace(/\r\n/g, '\n'));
    const normalized = withBreaks
      .split('\n')
      .map((line) => stripInlineMarkdown(line))
      .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (normalized !== t.description) {
      await db.update(tasks).set({ description: normalized }).where(eq(tasks.id, t.id));
      console.log(`✓ ${t.tag}: ${t.title}`);
      console.log(`   ${normalized.split('\n').length} lines now`);
    } else {
      console.log(`- ${t.tag}: no change`);
    }
  }
  process.exit(0);
})();
