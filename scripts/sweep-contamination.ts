// Sweep every company in the DB for founder-safety violations.
// Usage:
//   npx tsx scripts/sweep-contamination.ts           # scan all companies
//   npx tsx scripts/sweep-contamination.ts <slug>    # scan one company by slug
//
// Exits with code 1 if violations found — safe to wire into CI / smoke-test
// guardrails ("after an onboarding E2E test runs, sweep the DB; fail on hit").

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { sweepCompanyForContamination, formatViolationReport } from '@/lib/founder-safety/sweep-db';

async function main() {
  const slugArg = process.argv[2];

  let rows: Array<{ id: string; slug: string; name: string }>;
  if (slugArg) {
    rows = await db
      .select({ id: companies.id, slug: companies.slug, name: companies.name })
      .from(companies)
      .where(eq(companies.slug, slugArg));
    if (rows.length === 0) {
      console.error(`No company found with slug "${slugArg}"`);
      process.exit(1);
    }
  } else {
    rows = await db
      .select({ id: companies.id, slug: companies.slug, name: companies.name })
      .from(companies);
  }

  console.log(`Sweeping ${rows.length} company/companies for contamination...\n`);

  let totalViolations = 0;
  for (const c of rows) {
    const violations = await sweepCompanyForContamination(c.id);
    if (violations.length > 0) {
      totalViolations += violations.length;
      console.log(`━━━ ${c.slug} (${c.name}) ━━━`);
      console.log(formatViolationReport(violations));
      console.log('');
    } else {
      console.log(`✅ ${c.slug.padEnd(16)} clean`);
    }
  }

  console.log(`\nTotal violations across all companies: ${totalViolations}`);
  process.exit(totalViolations > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
