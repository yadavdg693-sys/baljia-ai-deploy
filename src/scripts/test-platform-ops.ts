// Platform-ops layer test — direct service-function runner.
//
// Per SPEC-OPS-001, the platform has 9 hidden agents/processes that run
// outside the founder-facing surface. 5 of them are implemented as service
// functions invoked by the /api/cron/platform-ops cron (every 15 min). This
// script calls each function directly so we can see PASS / FAIL / RAW output
// without waiting on cron.
//
// Run: npx tsx --env-file=.env.local src/scripts/test-platform-ops.ts

import { runInfraHealthCheck } from '@/lib/services/infra-watchdog.service';
import {
  detectRegressions,
  getKnownIssuesSummary,
  getTopFailures,
  getFailureSummary,
} from '@/lib/services/failure.service';
import { auditCredits } from '@/lib/services/billing-audit.service';

type Status = 'PASS' | 'FAIL';
interface Result { name: string; status: Status; ms: number; note: string }

async function call<T>(name: string, fn: () => Promise<T>, summarize: (v: T) => string): Promise<Result> {
  const t0 = Date.now();
  try {
    const v = await fn();
    return { name, status: 'PASS', ms: Date.now() - t0, note: summarize(v) };
  } catch (err) {
    return {
      name,
      status: 'FAIL',
      ms: Date.now() - t0,
      note: (err instanceof Error ? err.message : String(err)).slice(0, 100),
    };
  }
}

async function main() {
  const results: Result[] = [];

  console.log('Running platform-ops services directly (no cron, no auth)...\n');

  results.push(await call(
    'runInfraHealthCheck (infra_watchdog)',
    () => runInfraHealthCheck(),
    (r) => `queue=${r.queue_depth} stuck=${r.stuck_count} agents_down=${r.agents_down.length} alerts=${r.alerts.length}`,
  ));

  results.push(await call(
    'detectRegressions (regression_guard)',
    () => detectRegressions(),
    (rs) => `${rs.length} regression(s) detected`,
  ));

  results.push(await call(
    'getKnownIssuesSummary (known_issue_registry)',
    () => getKnownIssuesSummary(),
    (s) => `total=${s.total ?? '-'} open=${s.open ?? '-'} fixed=${s.fixed ?? '-'}`,
  ));

  results.push(await call(
    'getTopFailures (failure_fingerprinter)',
    () => getTopFailures(5),
    (fs) => `top ${fs.length} fingerprints`,
  ));

  results.push(await call(
    'getFailureSummary (failure_fingerprinter)',
    () => getFailureSummary(),
    (s) => `${s.total ?? 0} fingerprints | ${s.last24h ?? 0} in last 24h`,
  ));

  results.push(await call(
    'auditCredits (billing_credit_auditor)',
    () => auditCredits(),
    (r) => `phantom=${r.phantom_charges.length} double=${r.double_charges.length} neg_balance=${r.negative_balances.length} missing_refund=${r.missing_refunds.length}`,
  ));

  // ── Hit the cron endpoint with proper auth (proves the wiring) ──
  const cronSecret = process.env.CRON_SECRET;
  const port = process.env.PLAYWRIGHT_PORT || process.env.PORT || '3000';
  const cronUrl = `http://localhost:${port}/api/cron/platform-ops`;
  if (cronSecret) {
    const t0 = Date.now();
    try {
      const res = await fetch(cronUrl, {
        method: 'GET',
        headers: { 'x-cron-secret': cronSecret },
      });
      const body = await res.json() as { ok?: boolean; results?: Record<string, unknown> };
      results.push({
        name: 'GET /api/cron/platform-ops (cron orchestrator)',
        status: res.ok && body.ok ? 'PASS' : 'FAIL',
        ms: Date.now() - t0,
        note: `HTTP ${res.status} | keys=${Object.keys(body.results ?? {}).join(',')}`,
      });
    } catch (err) {
      results.push({
        name: 'GET /api/cron/platform-ops (cron orchestrator)',
        status: 'FAIL',
        ms: Date.now() - t0,
        note: `dev server unreachable: ${err instanceof Error ? err.message : String(err)}`.slice(0, 100),
      });
    }
  } else {
    results.push({
      name: 'GET /api/cron/platform-ops (cron orchestrator)',
      status: 'FAIL',
      ms: 0,
      note: 'CRON_SECRET not set — cannot test',
    });
  }

  // ── Report ──
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${icon} ${r.name.padEnd(50)} ${r.status.padEnd(5)} ${`${r.ms}ms`.padStart(7)}  ${r.note}`);
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n${pass} / ${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error('crashed:', e); process.exit(1); });
