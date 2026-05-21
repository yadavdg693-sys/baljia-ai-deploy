// Read-only check: how many companies have github_repo / render_service_id set,
// and how recent. Helps diagnose whether GitHub provisioning was working before.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies } from '@/lib/db';
import { sql, desc, isNotNull } from 'drizzle-orm';

void (async () => {
  const [counts] = await db.select({
    total:    sql<number>`COUNT(*)::int`,
    with_gh:  sql<number>`COUNT(github_repo)::int`,
    with_rs:  sql<number>`COUNT(render_service_id)::int`,
    with_neon: sql<number>`COUNT(neon_database_id)::int`,
  }).from(companies);
  console.log('Company counts:', counts);

  const recent = await db.select({
    id: companies.id,
    name: companies.name,
    slug: companies.slug,
    gh: companies.github_repo,
    rs: companies.render_service_id,
    neon: companies.neon_database_id,
    created: companies.created_at,
  }).from(companies)
    .where(isNotNull(companies.github_repo))
    .orderBy(desc(companies.created_at))
    .limit(8);

  console.log(`\nMost-recent ${recent.length} companies WITH github_repo:`);
  for (const c of recent) {
    const ago = c.created ? `${Math.round((Date.now() - new Date(c.created).getTime()) / 86400000)}d ago` : '?';
    console.log(`  ${c.created?.toISOString?.()?.slice(0,10)} (${ago}) | ${c.slug} | gh=${c.gh ?? '-'} | rs=${c.rs ? 'yes' : 'no'}`);
  }

  // Also peek at very-recent companies with NO github_repo to see if it's
  // been failing for a while.
  const recentNoGh = await db.select({
    id: companies.id,
    slug: companies.slug,
    gh: companies.github_repo,
    created: companies.created_at,
  }).from(companies)
    .orderBy(desc(companies.created_at))
    .limit(15);

  console.log(`\nMost-recent 15 companies (any github status):`);
  for (const c of recentNoGh) {
    console.log(`  ${c.created?.toISOString?.()?.slice(0,16)} | ${c.slug.padEnd(20)} | gh=${c.gh ?? '(none)'}`);
  }

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
