// Dump QueryForge's full generated content: tasks, mission, market research
import { db } from '@/lib/db';
import { companies, users, tasks, documents } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const [user] = await db.select().from(users).where(eq(users.email, 'yadavdg4@gmail.com')).limit(1);
  if (!user) process.exit(0);
  const [c] = await db.select().from(companies).where(eq(companies.owner_id, user.id)).orderBy(desc(companies.created_at)).limit(1);
  if (!c) process.exit(0);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('COMPANY:', c.name, '/', c.slug);
  console.log('original_idea:', (c as unknown as { original_idea?: string }).original_idea);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('━━━━━━━ MISSION DOC (full) ━━━━━━━');
  const docs = await db.select().from(documents).where(eq(documents.company_id, c.id));
  const mission = docs.find((d) => d.kind === 'mission');
  console.log(mission?.content ?? '(no mission)');

  console.log('\n━━━━━━━ MARKET RESEARCH (full) ━━━━━━━');
  const mr = docs.find((d) => d.kind === 'market_research');
  console.log(mr?.content ?? '(no market_research)');

  console.log('\n━━━━━━━ TASKS (full each) ━━━━━━━');
  const ts = await db.select().from(tasks).where(eq(tasks.company_id, c.id));
  for (const t of ts) {
    console.log(`\n[${t.status}] [${t.tag}] ${t.title}`);
    console.log(`PRIORITY: ${t.priority}  COMPLEXITY: ${t.complexity}  HOURS: ${t.estimated_hours}`);
    console.log(`DESCRIPTION (${(t.description ?? '').length} chars):`);
    console.log(t.description);
    console.log(`REASONING: ${t.suggestion_reasoning}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
