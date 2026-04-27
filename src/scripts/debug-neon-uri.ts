// Diagnostic: why does query_company_db return "Database connection URI not available"?
//
// Probes the Neon Management API directly to expose the exact response from
// GET /projects/{id}/connection_uri — the call that getCompanyDatabase makes
// on line 170 of neon.service.ts. The current code silently swallows
// non-2xx responses and falls through to empty string, hence the unhelpful
// "URI not available" message in handleQueryCompanyDb.

import { db, companies } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

const NEON_API = 'https://console.neon.tech/api/v2';

async function main() {
  const slug = process.argv[2] ?? 'threadmint';
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    console.error('NEON_API_KEY not set');
    process.exit(1);
  }

  const [c] = await db.select({ id: companies.id, slug: companies.slug, neon_database_id: companies.neon_database_id })
    .from(companies)
    .where(eq(companies.slug, slug))
    .orderBy(desc(companies.updated_at))
    .limit(1);
  if (!c?.neon_database_id) {
    console.error(`No company with slug ${slug} or no neon_database_id set`);
    process.exit(1);
  }
  console.log(`Project: ${c.neon_database_id}\n`);

  // ── Call 1: GET /projects/{id} (the call that succeeded) ──
  console.log('1. GET /projects/{id}');
  const res1 = await fetch(`${NEON_API}/projects/${c.neon_database_id}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  console.log(`   status: ${res1.status} ${res1.statusText}`);
  const data1 = await res1.json();
  if (res1.ok) {
    const proj = (data1 as { project?: Record<string, unknown> }).project ?? {};
    console.log(`   project.id:                ${proj.id}`);
    console.log(`   project.default_branch_id: ${proj.default_branch_id}`);
    console.log(`   project.org_id:            ${proj.org_id}`);
    console.log(`   project keys:              ${Object.keys(proj).join(', ')}`);
  }

  // ── Call 2: GET /projects/{id}/connection_uri WITHOUT query params (current code) ──
  console.log('\n2. GET /projects/{id}/connection_uri  (no query params — current code)');
  const res2 = await fetch(`${NEON_API}/projects/${c.neon_database_id}/connection_uri`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  console.log(`   status: ${res2.status} ${res2.statusText}`);
  console.log(`   body:   ${(await res2.text()).slice(0, 250)}`);

  // ── Call 3: WITH query params (the fix) ──
  console.log('\n3. GET /projects/{id}/connection_uri?database_name=neondb&role_name=neondb_owner');
  const url3 = new URL(`${NEON_API}/projects/${c.neon_database_id}/connection_uri`);
  url3.searchParams.set('database_name', 'neondb');
  url3.searchParams.set('role_name', 'neondb_owner');
  const res3 = await fetch(url3.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  console.log(`   status: ${res3.status} ${res3.statusText}`);
  const text3 = await res3.text();
  // Mask password
  const masked = text3.replace(/:[^:@/]{4,}@/, ':***@');
  console.log(`   body:   ${masked.slice(0, 250)}`);

  // ── Call 4: list databases to find the actual database name ──
  console.log('\n4. GET /projects/{id}/branches/{default}/databases — find the actual db + role names');
  const proj = ((await fetch(`${NEON_API}/projects/${c.neon_database_id}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  }).then((r) => r.json())) as { project?: { default_branch_id?: string } }).project;
  const defaultBranch = proj?.default_branch_id;
  if (defaultBranch) {
    const dbsRes = await fetch(`${NEON_API}/projects/${c.neon_database_id}/branches/${defaultBranch}/databases`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    const dbsData = await dbsRes.json() as { databases?: Array<{ name: string; owner_name: string }> };
    if (dbsData.databases) {
      for (const d of dbsData.databases) {
        console.log(`   database: name="${d.name}" owner_name="${d.owner_name}"`);
      }
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error('crashed:', e); process.exit(1); });
