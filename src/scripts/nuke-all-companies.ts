// FULL NUKE: deletes ALL companies + their cascading external resources.
// USER-AUTHORIZED on 2026-05-10.
//
// Order:
//   1. List all 4 companies
//   2. For each: delete external resources (Render service + custom domains,
//      GitHub repo, Neon DB) — best-effort, errors don't block the next step
//   3. Delete platform DB rows in FK-safe order: discover all tables that
//      reference tasks.id and companies.id via information_schema, then
//      DELETE company-scoped rows from each in dependency order
//   4. Confirm zero companies remain
//
// Idempotent: safe to re-run if a step partially completed.

import { db, companies } from '@/lib/db';
import { sql, inArray } from 'drizzle-orm';

const RENDER_API = 'https://api.render.com/v1';
const GITHUB_API = 'https://api.github.com';
const NEON_API   = 'https://console.neon.tech/api/v2';

const renderHeaders = () => ({ Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' });
const githubHeaders = () => ({ Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baljia-nuke' });
const neonHeaders   = () => ({ Authorization: `Bearer ${process.env.NEON_API_KEY}`, Accept: 'application/json' });

async function deleteRenderCustomDomains(serviceId: string) {
  try {
    const r = await fetch(`${RENDER_API}/services/${serviceId}/custom-domains?limit=20`, { headers: renderHeaders() });
    if (!r.ok) return;
    const domains = await r.json() as Array<{ customDomain: { id: string; name: string } }>;
    for (const d of domains) {
      const dr = await fetch(`${RENDER_API}/services/${serviceId}/custom-domains/${d.customDomain.id}`, {
        method: 'DELETE', headers: renderHeaders(),
      });
      console.log(`    custom-domain ${d.customDomain.name}: ${dr.ok ? 'DELETED' : `failed (HTTP ${dr.status})`}`);
    }
  } catch (e) { console.log(`    custom-domain enumerate threw: ${e instanceof Error ? e.message : e}`); }
}

async function deleteRenderService(serviceId: string | null | undefined): Promise<void> {
  if (!serviceId) return;
  await deleteRenderCustomDomains(serviceId);
  try {
    const r = await fetch(`${RENDER_API}/services/${serviceId}`, { method: 'DELETE', headers: renderHeaders() });
    console.log(`    render service ${serviceId}: ${r.ok ? 'DELETED' : `HTTP ${r.status}`}`);
  } catch (e) { console.log(`    render service ${serviceId}: threw ${e instanceof Error ? e.message : e}`); }
}

async function deleteGitHubRepo(fullRepo: string | null | undefined): Promise<void> {
  if (!fullRepo) return;
  try {
    const r = await fetch(`${GITHUB_API}/repos/${fullRepo}`, { method: 'DELETE', headers: githubHeaders() });
    console.log(`    github repo ${fullRepo}: ${r.ok ? 'DELETED' : `HTTP ${r.status}`}`);
  } catch (e) { console.log(`    github repo ${fullRepo}: threw ${e instanceof Error ? e.message : e}`); }
}

async function deleteNeonProject(projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  if (!process.env.NEON_API_KEY) { console.log(`    neon project ${projectId}: skipped (NEON_API_KEY not set)`); return; }
  try {
    const r = await fetch(`${NEON_API}/projects/${projectId}`, { method: 'DELETE', headers: neonHeaders() });
    console.log(`    neon project ${projectId}: ${r.ok ? 'DELETED' : `HTTP ${r.status}`}`);
  } catch (e) { console.log(`    neon project ${projectId}: threw ${e instanceof Error ? e.message : e}`); }
}

interface FkRef { table: string; column: string }

async function findReferencingTables(target: 'companies' | 'tasks'): Promise<FkRef[]> {
  const result = await db.execute(sql`
    SELECT
      tc.table_name AS table_name,
      kcu.column_name AS column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = ${target}
      AND ccu.column_name = 'id'
  `);
  return (result.rows as Array<{ table_name: string; column_name: string }>).map((r) => ({ table: r.table_name, column: r.column_name }));
}

async function deleteRowsScopedTo(target: 'company' | 'task', refTable: string, refColumn: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const result = await db.execute(sql`DELETE FROM ${sql.identifier(refTable)} WHERE ${sql.identifier(refColumn)} IN (${idList})`);
    console.log(`    DELETE FROM ${refTable} WHERE ${refColumn} IN (...): ${result.rowCount ?? 0} rows`);
  } catch (e) {
    console.log(`    DELETE FROM ${refTable}: ${e instanceof Error ? e.message : e}`);
  }
}

void (async () => {
  const allCompanies = await db.select({
    id: companies.id, slug: companies.slug, name: companies.name,
    render_service_id: companies.render_service_id,
    github_repo: companies.github_repo,
    neon_database_id: companies.neon_database_id,
  }).from(companies);

  if (allCompanies.length === 0) {
    console.log('No companies to delete. Done.');
    process.exit(0);
  }

  console.log(`\n━━━━ NUKE PLAN: ${allCompanies.length} compan(y/ies) ━━━━`);
  for (const c of allCompanies) {
    console.log(`  - ${c.slug ?? '(no slug)'} (id=${c.id})`);
    console.log(`      render: ${c.render_service_id ?? '-'}  github: ${c.github_repo ?? '-'}  neon: ${c.neon_database_id ?? '-'}`);
  }

  console.log(`\n━━━━ STEP 1: Delete external resources per company ━━━━`);
  for (const c of allCompanies) {
    console.log(`  ${c.slug}:`);
    await deleteRenderService(c.render_service_id);
    await deleteGitHubRepo(c.github_repo);
    await deleteNeonProject(c.neon_database_id);
  }

  console.log(`\n━━━━ STEP 2: Delete platform DB rows (FK-safe order) ━━━━`);
  const companyIds = allCompanies.map((c) => c.id);

  // 2a: delete from tables that reference tasks.id (any task row in our companies)
  const taskReferencers = await findReferencingTables('tasks');
  console.log(`  Found ${taskReferencers.length} table(s) referencing tasks.id: ${taskReferencers.map((r) => r.table).join(', ')}`);
  // First we need the task IDs
  const taskRows = await db.execute(sql`SELECT id FROM tasks WHERE company_id IN (${sql.join(companyIds.map((id) => sql`${id}`), sql`, `)})`);
  const taskIds = (taskRows.rows as Array<{ id: string }>).map((r) => r.id);
  console.log(`  ${taskIds.length} task(s) to delete; will first clear ${taskReferencers.length} child table(s).`);
  for (const ref of taskReferencers) {
    await deleteRowsScopedTo('task', ref.table, ref.column, taskIds);
  }

  // 2b: delete from tables that reference companies.id (excluding 'tasks' which we delete in 2c)
  const companyReferencers = (await findReferencingTables('companies')).filter((r) => r.table !== 'tasks');
  console.log(`  Found ${companyReferencers.length} other table(s) referencing companies.id: ${companyReferencers.map((r) => r.table).join(', ')}`);
  for (const ref of companyReferencers) {
    await deleteRowsScopedTo('company', ref.table, ref.column, companyIds);
  }

  // 2c: delete tasks (now that their children are gone)
  await deleteRowsScopedTo('company', 'tasks', 'company_id', companyIds);

  // 2d: finally delete companies
  const finalDelete = await db.delete(companies).where(inArray(companies.id, companyIds));
  console.log(`  DELETE FROM companies: ${(finalDelete as { rowCount?: number }).rowCount ?? 'done'}`);

  // 3: confirm
  const remaining = await db.select({ count: sql<number>`count(*)::int` }).from(companies);
  console.log(`\n━━━━ DONE. Companies remaining: ${remaining[0].count} ━━━━`);
  process.exit(0);
})();
