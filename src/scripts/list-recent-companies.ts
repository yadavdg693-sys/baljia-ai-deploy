// Quick read-only inventory of recent companies. Used by measure-success-rate
// to find a clean test target.

import { db, companies } from '@/lib/db';
import { desc } from 'drizzle-orm';

void (async () => {
  const rows = await db.select({
    id: companies.id, name: companies.name, slug: companies.slug,
    lifecycle: companies.lifecycle, render_service_id: companies.render_service_id,
    github_repo: companies.github_repo, billing_state: companies.billing_state,
  }).from(companies).orderBy(desc(companies.created_at)).limit(10);
  for (const r of rows) {
    console.log(`${r.slug ?? '(no slug)'.padEnd(20)} ${r.lifecycle ?? '?'.padEnd(15)} ${r.render_service_id ? 'rendered' : 'not-rendered'} ${r.github_repo ?? ''} ${r.id}`);
  }
  process.exit(0);
})();
