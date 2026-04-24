// Delete bookmint + pagegenie + amendly (contaminated test companies) and all
// their related rows across the schema. FK order matters — dependent tables
// first, companies last.
//
// Strategy: group deletes into phases based on FK topology:
//   Phase A: tables referencing tasks.id         → DELETE WHERE task_id IN (...)
//   Phase B: tables referencing documents.id     → DELETE WHERE document_id IN (...)
//   Phase C: tables referencing roadmaps.id      → CASCADE, no explicit delete needed
//   Phase D: tables referencing companies.id     → DELETE WHERE company_id = ANY(ids)
//   Phase E: companies                           → DELETE WHERE id = ANY(ids)

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { neon } from '@neondatabase/serverless';

const SLUGS_TO_DELETE = ['bookmint', 'pagegenie', 'amendly'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  // Resolve company IDs
  const companies = (await sql`
    SELECT id, slug, name FROM companies WHERE slug = ANY(${SLUGS_TO_DELETE})
  `) as Array<{ id: string; slug: string; name: string }>;

  if (companies.length === 0) {
    console.log('No matching companies found. Nothing to delete.');
    process.exit(0);
  }

  console.log('Will delete:');
  for (const c of companies) console.log(`  ${c.slug.padEnd(12)} ${c.id}  (${c.name})`);

  const ids = companies.map((c) => c.id);

  const stepsOrder: Array<{ label: string; run: () => Promise<unknown> }> = [
    // ─────────────────────────────────────────────────────────────
    // PHASE A — tables with task_id FK to tasks.id.
    // Filter by task_id IN (SELECT id FROM tasks WHERE company_id = ANY(ids))
    // so we also catch cross-company rows that happen to reference our tasks.
    // ─────────────────────────────────────────────────────────────
    { label: 'A. task_executions', run: () =>
        sql`DELETE FROM task_executions WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. task_failure_links', run: () =>
        sql`DELETE FROM task_failure_links WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. artifacts', run: () =>
        sql`DELETE FROM artifacts WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. approval_records', run: () =>
        sql`DELETE FROM approval_records WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. runs', run: () =>
        sql`DELETE FROM runs WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. sessions', run: () =>
        sql`DELETE FROM sessions WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. runtime_ai_costs', run: () =>
        sql`DELETE FROM runtime_ai_costs WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. refund_history (via tasks)', run: () =>
        sql`DELETE FROM refund_history WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. learnings (via tasks)', run: () =>
        sql`DELETE FROM learnings WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. reports (via tasks)', run: () =>
        sql`DELETE FROM reports WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. credit_ledger (via tasks)', run: () =>
        sql`DELETE FROM credit_ledger WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. tweets (via tasks)', run: () =>
        sql`DELETE FROM tweets WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },
    { label: 'A. document_suggestions (via tasks)', run: () =>
        sql`DELETE FROM document_suggestions WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ANY(${ids}))` },

    // ─────────────────────────────────────────────────────────────
    // PHASE B — tables with document_id FK. Delete before documents.
    // ─────────────────────────────────────────────────────────────
    { label: 'B. document_suggestions (via documents)', run: () =>
        sql`DELETE FROM document_suggestions WHERE document_id IN (SELECT id FROM documents WHERE company_id = ANY(${ids}))` },

    // ─────────────────────────────────────────────────────────────
    // PHASE D — company-scoped tables. Order matters only where one
    // company-scoped table references another (e.g. milestones→roadmaps).
    // ─────────────────────────────────────────────────────────────
    { label: 'D. tasks', run: () => sql`DELETE FROM tasks WHERE company_id = ANY(${ids})` },
    { label: 'D. documents', run: () => sql`DELETE FROM documents WHERE company_id = ANY(${ids})` },
    { label: 'D. memory_layers', run: () => sql`DELETE FROM memory_layers WHERE company_id = ANY(${ids})` },
    { label: 'D. learnings (via company_id)', run: () => sql`DELETE FROM learnings WHERE company_id = ANY(${ids})` },
    { label: 'D. credit_ledger', run: () => sql`DELETE FROM credit_ledger WHERE company_id = ANY(${ids})` },
    { label: 'D. reports', run: () => sql`DELETE FROM reports WHERE company_id = ANY(${ids})` },
    { label: 'D. refund_history', run: () => sql`DELETE FROM refund_history WHERE company_id = ANY(${ids})` },
    { label: 'D. revenue_ledger', run: () => sql`DELETE FROM revenue_ledger WHERE company_id = ANY(${ids})` },
    { label: 'D. ad_spend_ledger', run: () => sql`DELETE FROM ad_spend_ledger WHERE company_id = ANY(${ids})` },
    { label: 'D. ad_campaigns', run: () => sql`DELETE FROM ad_campaigns WHERE company_id = ANY(${ids})` },
    { label: 'D. recurring_tasks', run: () => sql`DELETE FROM recurring_tasks WHERE company_id = ANY(${ids})` },
    { label: 'D. night_shift_cycles', run: () => sql`DELETE FROM night_shift_cycles WHERE company_id = ANY(${ids})` },
    { label: 'D. email_threads', run: () => sql`DELETE FROM email_threads WHERE company_id = ANY(${ids})` },
    { label: 'D. contacts', run: () => sql`DELETE FROM contacts WHERE company_id = ANY(${ids})` },
    { label: 'D. browser_credentials', run: () => sql`DELETE FROM browser_credentials WHERE company_id = ANY(${ids})` },
    { label: 'D. chat_sessions', run: () => sql`DELETE FROM chat_sessions WHERE company_id = ANY(${ids})` },
    { label: 'D. platform_events', run: () => sql`DELETE FROM platform_events WHERE company_id = ANY(${ids})` },
    { label: 'D. dashboard_links', run: () => sql`DELETE FROM dashboard_links WHERE company_id = ANY(${ids})` },
    { label: 'D. platform_feedback', run: () => sql`DELETE FROM platform_feedback WHERE company_id = ANY(${ids})` },
    { label: 'D. tweets', run: () => sql`DELETE FROM tweets WHERE company_id = ANY(${ids})` },
    { label: 'D. roadmaps (milestones cascade)', run: () => sql`DELETE FROM roadmaps WHERE company_id = ANY(${ids})` },
    { label: 'D. subscriptions', run: () => sql`DELETE FROM subscriptions WHERE company_id = ANY(${ids})` },
    { label: 'D. referrals (referrer+referred)', run: () =>
        sql`DELETE FROM referrals WHERE referrer_company_id = ANY(${ids}) OR referred_company_id = ANY(${ids})` },

    // ─────────────────────────────────────────────────────────────
    // PHASE E — companies (last)
    // ─────────────────────────────────────────────────────────────
    { label: 'E. companies', run: () => sql`DELETE FROM companies WHERE id = ANY(${ids})` },
  ];

  for (const step of stepsOrder) {
    try {
      const result = await step.run() as Array<unknown>;
      const count = Array.isArray(result) ? result.length : '?';
      console.log(`  ✓ ${step.label.padEnd(48)} (${count} rows affected)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('does not exist') || msg.includes('column')) {
        console.log(`  - ${step.label.padEnd(48)} (table/column doesn't exist, skipped)`);
        continue;
      }
      console.error(`  ✗ ${step.label.padEnd(48)} FAILED: ${msg}`);
      throw err;
    }
  }

  console.log('\n✅ Cleanup complete.');
  process.exit(0);
}

main().catch((err) => { console.error('\n❌ Cleanup failed:', err); process.exit(1); });
