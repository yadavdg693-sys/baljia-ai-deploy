// Quick read-only verifier for the redship-clone test harness.
//
// Usage: npx tsx --env-file=.env.local src/scripts/verify-redship-clone.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, users, tasks, creditLedger, subscriptions, documents, reports } from '@/lib/db';
import { eq, sql, desc, like } from 'drizzle-orm';

void (async () => {
  const [u] = await db.select().from(users).where(eq(users.email, 'redship-clone@baljia.test'));
  if (!u) { console.log('No founder user found.'); process.exit(0); }
  console.log('FOUNDER:', u.id, '| email:', u.email);

  const cs = await db.select().from(companies).where(eq(companies.owner_id, u.id)).orderBy(desc(companies.created_at));
  console.log('COMPANIES:', cs.length);

  for (const c of cs) {
    const [bal] = await db.select({ total: sql<number>`COALESCE(SUM(amount),0)::int` })
      .from(creditLedger).where(eq(creditLedger.company_id, c.id));
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.company_id, c.id));
    const ts = await db.select().from(tasks).where(eq(tasks.company_id, c.id));
    const docs = await db.select().from(documents).where(eq(documents.company_id, c.id));
    const reps = await db.select().from(reports).where(eq(reports.company_id, c.id));
    console.log(`\n──────────────────────────────────────────`);
    console.log(`COMPANY  id=${c.id}`);
    console.log(`  name=${c.name} | slug=${c.slug}`);
    console.log(`  one_liner: ${c.one_liner?.slice(0, 200)}`);
    console.log(`  onboarding=${c.onboarding_status} | billing=${c.billing_state}`);
    console.log(`  subdomain=${c.subdomain ?? '-'} | github_repo=${c.github_repo ?? '-'} | render_service_id=${c.render_service_id ?? '-'}`);
    console.log(`  neon_database_id=${c.neon_database_id ?? '-'}`);
    console.log(`  subscription: plan=${sub?.plan_type ?? '-'} | status=${sub?.status ?? '-'}`);
    console.log(`  credit balance: ${bal?.total ?? 0}`);
    console.log(`  documents (${docs.length}):`);
    for (const d of docs) console.log(`    - ${d.doc_type}: ${d.title?.slice(0, 80) ?? '-'}`);
    console.log(`  reports (${reps.length})`);
    console.log(`  tasks (${ts.length}):`);
    for (const t of ts) {
      console.log(`    - ${t.id.slice(0, 8)} | ${t.status} | tag=${t.tag} | agent=${t.assigned_to_agent_id} | mode=${t.execution_mode} | ver=${t.verification_level} | cx=${t.complexity}`);
      console.log(`        title: ${t.title?.slice(0, 100)}`);
    }

    // Show full descriptions of the REDSHIP-CLONE tasks so we can see what
    // founder-safety redacted.
    const redshipTasks = ts.filter(t => t.title?.includes('REDSHIP-CLONE'));
    if (redshipTasks.length) {
      console.log(`\n──── REDSHIP-CLONE task descriptions (post-sanitize) ────`);
      for (const t of redshipTasks) {
        console.log(`\n[${t.tag.toUpperCase()}] ${t.title}`);
        console.log('---');
        console.log(t.description?.slice(0, 800));
        console.log('  ... (truncated)');
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
