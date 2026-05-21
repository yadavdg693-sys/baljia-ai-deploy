// End-to-end smoke test for the three Tier-1 patterns shipped today:
//   1. static_code_scan against the real threadpulse repo
//   2. review_pushed_code against the real threadpulse repo
//   3. policy gate via withPolicyGate against representative inputs
//
// Validates that the unit-tested logic actually works when wired against
// real GitHub + real Anthropic.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, tasks } from '@/lib/db';
import { eq, like } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';
import { withPolicyGate } from '@/lib/agents/policy-gate';

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadpulse'));
  if (!c) throw new Error('threadpulse company not found');
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  if (!t) throw new Error('threadpulse engineering task not found');
  console.log(`Target: ${c.slug} (id=${c.id}, repo=${c.github_repo})\n`);

  let allPassed = true;

  // ── 1. static_code_scan ─────────────────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log(' 1. static_code_scan (real repo)');
  console.log('═══════════════════════════════════════');
  const t0 = Date.now();
  const staticResult = await handleEngineeringTool('static_code_scan', {}, t as never);
  const staticElapsed = Date.now() - t0;
  console.log(staticResult);
  console.log(`\n  elapsed: ${staticElapsed}ms`);
  if (typeof staticResult !== 'string') {
    console.error('  FAIL: result is not a string');
    allPassed = false;
  } else if (!staticResult.startsWith('STATIC SCAN')) {
    console.error('  FAIL: result does not start with "STATIC SCAN"');
    allPassed = false;
  } else {
    console.log('  PASS: static scan returned a structured response');
  }

  // ── 2. review_pushed_code ───────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(' 2. review_pushed_code (real diff + Haiku)');
  console.log('═══════════════════════════════════════');
  const t1 = Date.now();
  const reviewResult = await handleEngineeringTool('review_pushed_code', {}, t as never);
  const reviewElapsed = Date.now() - t1;
  console.log(reviewResult);
  console.log(`\n  elapsed: ${reviewElapsed}ms`);
  if (typeof reviewResult !== 'string') {
    console.error('  FAIL: result is not a string');
    allPassed = false;
  } else if (!/^CODE REVIEW/.test(reviewResult)) {
    console.error('  FAIL: result does not start with "CODE REVIEW"');
    allPassed = false;
  } else {
    console.log('  PASS: code review returned a structured response');
  }

  // ── 3. Policy gate (end-to-end via withPolicyGate) ──────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(' 3. policy gate (representative blocks)');
  console.log('═══════════════════════════════════════');
  const cases = [
    {
      label: 'render_delete_service WITHOUT confirm — should BLOCK',
      tool: 'render_delete_service',
      input: { service_id: 'srv-fake' },
      expectBlocked: true,
    },
    {
      label: 'render_delete_service WITH confirm:true — should ALLOW',
      tool: 'render_delete_service',
      input: { service_id: 'srv-fake', confirm: true },
      expectBlocked: false,
    },
    {
      label: 'run_migration with DROP TABLE — should BLOCK',
      tool: 'run_migration',
      input: { sql: 'DROP TABLE users' },
      expectBlocked: true,
    },
    {
      label: 'run_migration with CREATE TABLE — should ALLOW',
      tool: 'run_migration',
      input: { sql: 'CREATE TABLE foo (id int)' },
      expectBlocked: false,
    },
    {
      label: 'github_delete_file on framework file — should BLOCK',
      tool: 'github_delete_file',
      input: { path: 'server.js', confirm: true },
      expectBlocked: true,
    },
    {
      label: 'query_company_db with SELECT — should ALLOW',
      tool: 'query_company_db',
      input: { sql: 'SELECT id FROM users LIMIT 1' },
      expectBlocked: false,
    },
  ];
  for (const tc of cases) {
    let dispatched = false;
    const result = await withPolicyGate(tc.tool, tc.input, t as never, async () => {
      dispatched = true;
      return 'mock-allowed';
    });
    const wasBlocked = result.startsWith('BLOCKED');
    const ok = wasBlocked === tc.expectBlocked;
    const symbol = ok ? '✓' : '✗';
    console.log(`  ${symbol} ${tc.label} — ${wasBlocked ? 'BLOCKED' : 'ALLOWED'} (dispatched=${dispatched})`);
    if (!ok) allPassed = false;
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`  Result: ${allPassed ? 'PASS' : 'FAIL'}`);
  process.exit(allPassed ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
