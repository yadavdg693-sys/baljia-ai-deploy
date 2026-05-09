// Dry smoke for the Watchdog cost ceiling — no network, no DB, no API spend.
// Verifies that:
//   1. recordTokens accumulates and computes USD
//   2. Ceiling kill triggers when total spend exceeds the configured ceiling
//   3. getBudgetSummary contains the expected pieces
//   4. getCostStatus returns the structured shape we persist into task_executions

import { Watchdog } from '@/lib/agents/watchdog';
import { getCostCeilingForAgent, computeCostUsd } from '@/lib/agents/cost-ceilings';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { console.log(`  PASS  ${name}`); pass++; }
  else    { console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

console.log('━━━ Watchdog cost-ceiling smoke ━━━\n');

// 1. Heavy spend trips kill on a tight ceiling
{
  const wd = new Watchdog('task_smoke', 200, 'co_smoke', 0.05); // $0.05 ceiling
  const verdict = wd.recordTokens(100_000, 50_000, 'claude-sonnet-4-6'); // ≈ $1.05
  check('verdict is kill when over ceiling', verdict === 'kill', `got ${verdict}`);
  const status = wd.getCostStatus();
  check('cost_usd > ceiling', status.cost_usd > 0.05, `cost=${status.cost_usd}`);
  check('cost_kill event emitted', wd.getEvents().some((e) => e.type === 'cost_kill'));
  check('wasKilled() is true', wd.wasKilled());
}

// 2. Budget summary contains BUDGET, turn marker, dollar sign
{
  const wd = new Watchdog('task_smoke2', 200, 'co_smoke', 1.50);
  wd.recordTurn(null);
  wd.recordTokens(10_000, 5_000, 'claude-sonnet-4-6');
  const summary = wd.getBudgetSummary();
  console.log(`  > summary: ${summary}`);
  check('summary starts with BUDGET:', summary.startsWith('BUDGET:'));
  check('summary contains "turn"', summary.includes('turn'));
  check('summary contains "$"', summary.includes('$'));
}

// 3. Per-agent ceiling lookup uses sensible defaults
{
  check('engineering ceiling resolves', getCostCeilingForAgent(30) === 1.50);
  check('browser ceiling resolves',     getCostCeilingForAgent(42) === 1.00);
  check('CEO ceiling resolves',         getCostCeilingForAgent(0)  === 0.20);
  check('unknown agent falls back',     getCostCeilingForAgent(999) === 0.50);
}

// 4. computeCostUsd uses the right rates
{
  // Sonnet: 1M input + 0M output = $3
  check('Sonnet 1M input ≈ $3',
    Math.abs(computeCostUsd(1_000_000, 0, 'claude-sonnet-4-6') - 3) < 1e-9);
  // Haiku: 1M output = $5
  check('Haiku 1M output ≈ $5',
    Math.abs(computeCostUsd(0, 1_000_000, 'claude-haiku-4-5-20251001') - 5) < 1e-9);
  // Unknown model uses fallback (= Sonnet rate)
  check('unknown model falls back to default rate',
    computeCostUsd(1_000_000, 0, 'never-heard-of-it') === 3);
}

console.log(`\n━━━ smoke result: ${pass} pass, ${fail} fail ━━━`);
process.exit(fail === 0 ? 0 : 1);
