// What's in the "22 tasks stuck > 1hr" infra alert?
// Shows every todo task older than 1 hour, with company, age, source, and tag.
// Run: npx tsx --env-file=.env.local src/scripts/inspect-stuck-tasks.ts

import { db, tasks, companies } from '@/lib/db';
import { and, eq, sql, asc } from 'drizzle-orm';

async function main() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      tag: tasks.tag,
      source: tasks.source,
      authorized_by: tasks.authorized_by,
      created_at: tasks.created_at,
      company_id: tasks.company_id,
      company_name: companies.name,
      company_slug: companies.slug,
      lifecycle: companies.lifecycle,
    })
    .from(tasks)
    .leftJoin(companies, eq(tasks.company_id, companies.id))
    .where(and(
      eq(tasks.status, 'todo'),
      sql`${tasks.created_at} < ${oneHourAgo}`,
    ))
    .orderBy(asc(tasks.created_at));

  console.log(`${rows.length} stuck todo tasks > 1 hour old\n`);

  // Group by company
  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.company_name ?? '?'} [${r.company_slug ?? '?'}] (${r.lifecycle ?? '?'})`;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key)!.push(r);
  }

  for (const [company, ts] of byCompany) {
    console.log(`── ${company} — ${ts.length} stuck ──`);
    for (const t of ts) {
      const age = t.created_at instanceof Date
        ? Math.floor((Date.now() - t.created_at.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const ageStr = age > 0 ? `${age}d` : `${Math.floor((Date.now() - new Date(String(t.created_at)).getTime()) / (1000 * 60 * 60))}h`;
      console.log(`  ${ageStr.padStart(4)}  ${t.tag.padEnd(15)}  ${t.source.padEnd(20)}  authz=${t.authorized_by ?? 'none'}  ${t.title.slice(0, 60)}`);
    }
    console.log('');
  }

  // Group by source
  console.log('── By source ──');
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  for (const [src, n] of Object.entries(bySource)) {
    console.log(`  ${src.padEnd(25)} ${n}`);
  }

  // Group by authz status
  console.log('\n── By authorization status ──');
  const byAuthz = { authorized: 0, unauthorized: 0 };
  for (const r of rows) {
    if (r.authorized_by) byAuthz.authorized++;
    else byAuthz.unauthorized++;
  }
  console.log(`  authorized   ${byAuthz.authorized}  (founder approved, worker should claim)`);
  console.log(`  unauthorized ${byAuthz.unauthorized}  (awaiting founder approval)`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
