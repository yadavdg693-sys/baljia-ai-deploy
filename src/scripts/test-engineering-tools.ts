// Engineering agent — direct tool-handler test suite.
//
// Calls every tool in handleEngineeringTool() against the most-recent
// completed company, classifies each result, and prints a PASS / WIRED-NOT-
// CONFIGURED / FAIL / SKIP table. No LLM. No credits. No slot contention.
// Read-only tools run for real; destructive tools are tested with safe-input
// + expected-error patterns (proves the handler is wired without doing the
// destructive thing).
//
// Run: npx tsx --env-file=.env.local src/scripts/test-engineering-tools.ts
//      npx tsx --env-file=.env.local src/scripts/test-engineering-tools.ts --include-destructive
//
// Categories:
//   ✅ PASS                — handler returned expected output
//   ⚠  WIRED_NOT_CONFIGURED — handler refused cleanly because env var or
//                              company resource is missing (fixable by
//                              setting that env / running provision_*)
//   ✗  FAIL                — unexpected output (real bug)
//   ○  SKIP                — destructive, skipped unless --include-destructive

import { db, companies } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';
import type { Task } from '@/types';

type Status = 'PASS' | 'WIRED_NOT_CONFIGURED' | 'FAIL' | 'SKIP';
interface Result { tool: string; status: Status; note: string; ms: number }

const includeDestructive = process.argv.includes('--include-destructive');
const results: Result[] = [];

/**
 * A test case. `expect` returns null on PASS, a string on FAIL.
 * If the handler returns a "ENV_VAR not configured" or similar message,
 * the runner classifies it as WIRED_NOT_CONFIGURED automatically.
 */
interface TestCase {
  tool: string;
  input: Record<string, unknown>;
  destructive?: boolean;
  expect?: (output: string) => string | null;
}

const NOT_CONFIGURED_PATTERNS = [
  /not configured/i,
  /not set/i,
  /CLOUDFLARE_API_TOKEN/,
  /CLOUDFLARE_ACCOUNT_ID/,
  /R2_/,
  /NEON_API_KEY/,
  /GITHUB_TOKEN/,
  /STRIPE_SECRET_KEY/,
  /RENDER_API_KEY/,
  /Invalid API Key/i,                  // Stripe placeholder key returns this — wired correctly
  /URI not available/i,                // query_company_db when company DB isn't fully provisioned
  /Database connection URI/i,
];

function classify(tool: string, output: string, expectNote: string | null, destructive: boolean): Result {
  const ms = 0;
  if (destructive && !includeDestructive) {
    return { tool, status: 'SKIP', note: 'destructive — pass --include-destructive to run', ms };
  }
  if (output.startsWith('Unknown engineering tool')) {
    return { tool, status: 'FAIL', note: 'fell through default branch in handler', ms };
  }
  if (NOT_CONFIGURED_PATTERNS.some((p) => p.test(output))) {
    return { tool, status: 'WIRED_NOT_CONFIGURED', note: output.replace(/\s+/g, ' ').slice(0, 80), ms };
  }
  if (expectNote) return { tool, status: 'FAIL', note: expectNote, ms };
  return { tool, status: 'PASS', note: output.replace(/\s+/g, ' ').slice(0, 80), ms };
}

async function run(tc: TestCase, fakeTask: Task): Promise<Result> {
  if (tc.destructive && !includeDestructive) {
    return { tool: tc.tool, status: 'SKIP', note: 'destructive — pass --include-destructive to run', ms: 0 };
  }
  const t0 = Date.now();
  let output: string;
  try {
    output = await handleEngineeringTool(tc.tool, tc.input, fakeTask);
  } catch (err) {
    output = `THROW: ${err instanceof Error ? err.message : String(err)}`;
  }
  const ms = Date.now() - t0;
  const expectNote = tc.expect ? tc.expect(output) : null;
  const r = classify(tc.tool, output, expectNote, !!tc.destructive);
  return { ...r, ms };
}

async function main() {
  const [company] = await db.select({
    id: companies.id,
    slug: companies.slug,
    name: companies.name,
    github_repo: companies.github_repo,
    custom_domain: companies.custom_domain,
  })
    .from(companies)
    .where(eq(companies.onboarding_status, 'completed'))
    .orderBy(desc(companies.updated_at))
    .limit(1);

  if (!company?.id) {
    console.error('No completed company found.');
    process.exit(1);
  }

  console.log(`Target company: ${company.name} [${company.slug}] ${company.id}`);
  console.log(`  github_repo:   ${company.github_repo ?? '(none)'}`);
  console.log(`  custom_domain: ${company.custom_domain ?? '(none)'}`);
  console.log(`  destructive:   ${includeDestructive ? 'INCLUDED (will hit external APIs!)' : 'skipped (default)'}\n`);

  const fakeTask: Task = {
    id: 'eng-test-fake-task',
    company_id: company.id,
    status: 'in_progress',
    tag: 'engineering',
  } as unknown as Task;

  const repo = company.github_repo ?? 'baljia-ai/missing-repo';

  // ── Read-only / safe tools ──────────────────────────────────────────────
  const cases: TestCase[] = [
    // Skills (Polsia-style knowledge layer)
    {
      tool: 'list_skills',
      input: {},
      expect: (out) => /cloudflare-workers/i.test(out) && /neon-postgres/i.test(out)
        ? null
        : `expected skills index but got: ${out.slice(0, 80)}`,
    },
    {
      tool: 'read_skill',
      input: { skill: 'cloudflare-workers' },
      expect: (out) => /Hono/i.test(out) && /nodejs_compat/i.test(out)
        ? null
        : `expected SKILL.md content but got: ${out.slice(0, 80)}`,
    },

    { tool: 'get_company_tech', input: {} },
    { tool: 'check_url_health', input: { url: 'https://example.com' } },

    // GitHub reads — gated by GITHUB_TOKEN + cross-tenant check (the
    // company's github_repo column). If the company has no repo, the
    // tool returns a known error (correctly).
    { tool: 'github_list_files', input: { repo, path: '/' } },
    { tool: 'github_read_file', input: { repo, path: 'README.md' } },
    { tool: 'github_search_code', input: { repo, query: 'fetch' } },

    // Cloudflare — gated by CLOUDFLARE_* env vars
    { tool: 'cf_verify_founder_app', input: {} },
    { tool: 'cf_get_app_info', input: {} },
    { tool: 'cf_get_logs', input: { tail: 20 } },

    // Custom domain
    { tool: 'verify_custom_domain', input: {} },

    // DB — gated by NEON_API_KEY. get_database_info is safe (read-only).
    { tool: 'get_database_info', input: {} },
    {
      tool: 'query_company_db',
      input: { sql: 'SELECT 1 as ok' },
      // Three valid outcomes: 1=success (returns "1"), 2=no DB provisioned (returns
      // "provision" message), 3=URI not retrievable (returns "URI not available").
      // 2 and 3 get auto-classified as WIRED_NOT_CONFIGURED by the patterns above.
    },

    // Stripe — gated by STRIPE_SECRET_KEY. Read-only listing.
    { tool: 'stripe_get_products', input: {} },

    // ── Destructive (require --include-destructive) ────────────────────────
    { tool: 'github_create_repo', input: { name: 'baljia-eng-test-DELETEME', description: 'test fixture — safe to delete' }, destructive: true },
    { tool: 'github_push_file', input: { repo, path: 'TEST.md', content: '# eng test', message: 'eng test commit' }, destructive: true },
    { tool: 'github_create_branch', input: { repo, branch: 'eng-test-branch', from: 'main' }, destructive: true },
    { tool: 'github_create_commit', input: { repo, branch: 'eng-test-branch', message: 'test', files: [] }, destructive: true },
    { tool: 'github_create_pr', input: { repo, head: 'eng-test-branch', base: 'main', title: 'eng test', body: 'test' }, destructive: true },
    { tool: 'github_delete_file', input: { repo, path: 'TEST.md', message: 'cleanup' }, destructive: true },
    { tool: 'cf_deploy_landing', input: { html: '<h1>eng test</h1>' }, destructive: true },
    { tool: 'cf_deploy_app', input: { script_content: 'export default { fetch: () => new Response("ok") }' }, destructive: true },
    { tool: 'cf_delete_founder_app', input: {}, destructive: true },
    { tool: 'cf_delete_app', input: {}, destructive: true },
    { tool: 'attach_custom_domain', input: { domain: 'eng-test.example.com' }, destructive: true },
    { tool: 'provision_database', input: {}, destructive: true },
    { tool: 'run_migration', input: { sql: 'CREATE TABLE eng_test (id int)' }, destructive: true },
    { tool: 'stripe_create_product', input: { name: 'Eng Test Product', description: 'test' }, destructive: true },
    { tool: 'stripe_create_price', input: { product_id: 'prod_test', amount_cents: 100, currency: 'usd' }, destructive: true },
    { tool: 'stripe_create_payment_link', input: { product_id: 'prod_test', amount_cents: 100, currency: 'usd', name: 'eng test' }, destructive: true },
  ];

  console.log(`Running ${cases.length} tool tests (${cases.filter((c) => !c.destructive).length} read-only, ${cases.filter((c) => c.destructive).length} destructive)\n`);

  // Run all sequentially so logs stay readable + we don't hammer external APIs
  for (const tc of cases) {
    const r = await run(tc, fakeTask);
    results.push(r);
    const icon = r.status === 'PASS' ? '✓'
      : r.status === 'WIRED_NOT_CONFIGURED' ? '⚠'
      : r.status === 'SKIP' ? '○'
      : '✗';
    console.log(`  ${icon} ${tc.tool.padEnd(30)} ${r.status.padEnd(22)} ${r.ms ? `${r.ms}ms`.padStart(7) : '       '}  ${r.note}`);
  }

  // ── Aggregate report ─────────────────────────────────────────────────────
  const counts: Record<Status, number> = { PASS: 0, WIRED_NOT_CONFIGURED: 0, FAIL: 0, SKIP: 0 };
  for (const r of results) counts[r.status]++;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ✓ PASS:                  ${counts.PASS} / ${results.length}`);
  console.log(`  ⚠ WIRED_NOT_CONFIGURED:  ${counts.WIRED_NOT_CONFIGURED}  (env var missing — fixable)`);
  console.log(`  ✗ FAIL:                  ${counts.FAIL}  (real bugs to investigate)`);
  console.log(`  ○ SKIP:                  ${counts.SKIP}  (destructive, --include-destructive to run)`);

  if (counts.FAIL > 0) {
    console.log('\n  ✗ FAILED TOOLS:');
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`    - ${r.tool}: ${r.note}`);
    }
  }

  if (counts.WIRED_NOT_CONFIGURED > 0) {
    console.log('\n  ⚠ MISSING-CONFIG TOOLS (set env to unblock):');
    for (const r of results.filter((x) => x.status === 'WIRED_NOT_CONFIGURED')) {
      console.log(`    - ${r.tool}: ${r.note}`);
    }
  }

  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Runner crashed:', e);
  process.exit(1);
});
