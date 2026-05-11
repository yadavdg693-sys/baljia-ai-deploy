import { db, tasks, companies, documents, dashboardLinks } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

const PATTERNS: Array<[string, RegExp]> = [
  ['**',  /\*\*/g],
  ['*',   /(?<!\w)\*[^*\n]+\*(?!\w)/g],
  ['_',   /(?<!\w)_[^_\n]+_(?!\w)/g],
  ['—',   /—/g],
  ['–',   /–/g],
  ['`',   /`[^`\n]+`/g],
];

function audit(label: string, value: string | null | undefined) {
  if (!value) return;
  for (const [name, re] of PATTERNS) {
    const matches = value.match(re);
    if (matches && matches.length > 0) {
      console.log(`  ${label}: ${name} x${matches.length}  →  ${matches[0]}`);
    }
  }
}

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }
  console.log(`Auditing company: ${c.id}`);

  console.log('\n[company row]');
  audit('one_liner', c.one_liner);
  audit('mission', c.mission);
  audit('name', c.company_name);

  console.log('\n[tasks]');
  const ts = await db.select().from(tasks).where(eq(tasks.company_id, c.id));
  for (const t of ts) {
    audit(`task[${t.id.slice(0, 8)}].title`, t.title);
    audit(`task[${t.id.slice(0, 8)}].desc`, t.description);
    audit(`task[${t.id.slice(0, 8)}].reasoning`, t.suggestion_reasoning);
  }

  console.log('\n[documents]');
  const ds = await db.select().from(documents).where(eq(documents.company_id, c.id));
  for (const d of ds) {
    audit(`doc[${d.doc_type}]`, d.content);
  }

  console.log('\n[dashboard_links]');
  const ls = await db.select().from(dashboardLinks).where(eq(dashboardLinks.company_id, c.id));
  for (const l of ls) {
    audit(`link[${l.label ?? '?'}].url`, l.url);
    audit(`link[${l.label ?? '?'}].label`, l.label);
  }

  console.log('\nDone.');
  process.exit(0);
})();
