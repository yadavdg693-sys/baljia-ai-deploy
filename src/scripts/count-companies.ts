import { db, companies } from '@/lib/db';
import { sql, desc } from 'drizzle-orm';

void (async () => {
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(companies);
  console.log(`Total companies: ${total[0].count}`);

  const byLifecycle = await db.select({
    lifecycle: companies.lifecycle,
    count: sql<number>`count(*)::int`,
  }).from(companies).groupBy(companies.lifecycle);
  console.log(`\nBy lifecycle:`);
  for (const r of byLifecycle) console.log(`  ${r.lifecycle ?? '(null)'}: ${r.count}`);

  const all = await db.select({
    slug: companies.slug, name: companies.name, lifecycle: companies.lifecycle,
    render_service_id: companies.render_service_id, github_repo: companies.github_repo,
    created_at: companies.created_at,
  }).from(companies).orderBy(desc(companies.created_at));
  console.log(`\nAll companies (newest first):`);
  for (const c of all) {
    const renderState = c.render_service_id ? 'rendered' : 'not-rendered';
    const created = c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : '?';
    console.log(`  ${(c.slug ?? '(no-slug)').padEnd(28)} ${(c.lifecycle ?? '?').padEnd(15)} ${renderState.padEnd(13)} ${created}  ${c.name ?? ''}`);
  }
  process.exit(0);
})();
