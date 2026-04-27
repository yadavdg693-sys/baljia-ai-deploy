// Debug: find most recent company for the user and dump everything that should drive the dashboard.
import { db, companies, tasks, documents, reports, users, platformEvents } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const email = process.argv[2] ?? 'yadavdg693@gmail.com';
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) { console.log(`No user found for ${email}`); process.exit(0); }

  console.log(`User: ${user.id} (${user.email})\n`);

  const cos = await db.select().from(companies).where(eq(companies.owner_id, user.id)).orderBy(desc(companies.created_at)).limit(5);
  console.log(`Companies (most recent 5):`);
  for (const c of cos) {
    console.log(`  ${c.id}  ${c.slug ?? '-'}  status=${c.onboarding_status}  lifecycle=${c.lifecycle}  created=${c.created_at?.toISOString?.() ?? c.created_at}`);
    console.log(`    name=${c.name ?? '-'}  one_liner=${(c.one_liner ?? '').slice(0, 80)}`);
  }

  if (cos.length === 0) { process.exit(0); }
  const latest = cos[0];
  console.log(`\n=== Drilling into latest: ${latest.id} ===\n`);

  const [taskRows, docRows, reportRows] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.company_id, latest.id)),
    db.select().from(documents).where(eq(documents.company_id, latest.id)),
    db.select().from(reports).where(eq(reports.company_id, latest.id)),
  ]);

  console.log(`Tasks: ${taskRows.length}`);
  for (const t of taskRows) console.log(`  - [${t.status}] ${t.title} (tag=${t.tag})`);
  console.log(`\nDocuments: ${docRows.length}`);
  for (const d of docRows) console.log(`  - ${d.kind}: ${d.title} (${(d.content ?? '').length} chars)`);
  console.log(`\nReports: ${reportRows.length}`);

  const events = await db.select().from(platformEvents).where(eq(platformEvents.company_id, latest.id)).orderBy(desc(platformEvents.created_at)).limit(40);
  console.log(`\nLast ${events.length} events (newest first):`);
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const summary = (p.message ?? p.stage ?? p.error ?? '').toString().slice(0, 160);
    console.log(`  ${e.created_at?.toISOString?.()} ${e.event_type}: ${summary}`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
