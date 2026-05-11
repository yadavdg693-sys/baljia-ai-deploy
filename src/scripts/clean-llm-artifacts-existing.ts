// Strip LLM artifacts (em/en-dashes, **bold**, *italic*, etc.) from already-
// persisted task and document content for the latest company. Use after any
// onboarding run that landed before sanitization was wired into the persist
// path.
import { db, companies, tasks, documents } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { stripInlineMarkdown } from '@/lib/services/onboarding/shared/founder-doc-style';

function cleanPreserveNewlines(s: string | null | undefined): string {
  if (!s) return '';
  // Keep line structure (newlines) but strip inline markdown + dashes.
  return stripInlineMarkdown(s, { keepLineStructure: true });
}

function cleanPlain(s: string | null | undefined): string {
  if (!s) return '';
  return stripInlineMarkdown(s);
}

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }
  console.log(`Cleaning company: ${c.company_name} (${c.id})`);

  // Tasks: title + description + suggestion_reasoning
  const taskRows = await db.select().from(tasks).where(eq(tasks.company_id, c.id));
  let taskUpdates = 0;
  for (const t of taskRows) {
    const newTitle = cleanPlain(t.title);
    const newDesc = cleanPreserveNewlines(t.description);
    const newReason = cleanPlain(t.suggestion_reasoning);
    if (
      newTitle !== t.title
      || newDesc !== t.description
      || newReason !== (t.suggestion_reasoning ?? '')
    ) {
      await db.update(tasks).set({
        title: newTitle,
        description: newDesc,
        suggestion_reasoning: newReason || null,
      }).where(eq(tasks.id, t.id));
      taskUpdates += 1;
    }
  }
  console.log(`  tasks cleaned: ${taskUpdates}/${taskRows.length}`);

  // Documents: content
  const docRows = await db.select().from(documents).where(eq(documents.company_id, c.id));
  let docUpdates = 0;
  for (const d of docRows) {
    if (!d.content) continue;
    const newContent = cleanPreserveNewlines(d.content);
    if (newContent !== d.content) {
      await db.update(documents).set({ content: newContent }).where(eq(documents.id, d.id));
      docUpdates += 1;
    }
  }
  console.log(`  docs cleaned:  ${docUpdates}/${docRows.length}`);

  // Companies: one_liner, mission
  const cleanOneLiner = cleanPlain(c.one_liner);
  const cleanMission = cleanPlain(c.mission);
  if (cleanOneLiner !== c.one_liner || cleanMission !== c.mission) {
    await db.update(companies).set({
      one_liner: cleanOneLiner || null,
      mission: cleanMission || null,
    }).where(eq(companies.id, c.id));
    console.log(`  company fields cleaned (one_liner / mission)`);
  }

  console.log('\nDone.');
  process.exit(0);
})();
