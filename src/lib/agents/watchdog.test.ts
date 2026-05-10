// Watchdog cost-tracking unit tests — covers recordTokens, the warn/kill
// thresholds, getBudgetSummary format stability, and getCostStatus shape.
// Existing recordTurn / recordToolCall behavior is included as a regression
// guard so the cost extension can't break the older paths.

import { describe, it, expect } from 'vitest';
import { Watchdog } from './watchdog';
import { computeCostUsd, getCostCeilingForAgent } from './cost-ceilings';

const TASK_ID = 'task_test_cost';
const COMPANY_ID = 'co_test_cost';
const MODEL = 'claude-sonnet-4-6';

// Sonnet rate: $3/M input, $15/M output → 100k in + 50k out = $0.30 + $0.75 = $1.05
const HEAVY_INPUT = 100_000;
const HEAVY_OUTPUT = 50_000;
const HEAVY_COST = computeCostUsd(HEAVY_INPUT, HEAVY_OUTPUT, MODEL);

describe('Watchdog cost tracking', () => {
  it('accumulates input + output + USD across multiple recordTokens calls', () => {
    const wd = new Watchdog(TASK_ID, 200, COMPANY_ID, 5.0);

    wd.recordTokens(10_000, 5_000, MODEL);
    wd.recordTokens(20_000, 10_000, MODEL);

    const status = wd.getCostStatus();
    expect(status.input_tokens).toBe(30_000);
    expect(status.output_tokens).toBe(15_000);
    // 30k * 3/M + 15k * 15/M = 0.09 + 0.225 = 0.315
    expect(status.cost_usd).toBeCloseTo(0.315, 5);
    expect(status.model_breakdown[MODEL]).toEqual({
      in: 30_000,
      out: 15_000,
      usd: status.cost_usd,
    });
    expect(status.ceiling_usd).toBe(5.0);
  });

  it('returns continue when under ceiling', () => {
    const wd = new Watchdog(TASK_ID, 200, COMPANY_ID, 10.0);
    const verdict = wd.recordTokens(HEAVY_INPUT, HEAVY_OUTPUT, MODEL); // ~$1.05 vs $10
    expect(verdict).toBe('continue');
    expect(wd.wasKilled()).toBe(false);
  });

  it('returns warn when crossing 80% (one-shot)', () => {
    // Ceiling $1.20, single record at ~$1.05 → 87.5% of ceiling
    const wd = new Watchdog(TASK_ID, 200, COMPANY_ID, 1.20);
    const v1 = wd.recordTokens(HEAVY_INPUT, HEAVY_OUTPUT, MODEL);
    expect(v1).toBe('warn');
    const events = wd.getEvents();
    expect(events.some((e) => e.type === 'cost_warning')).toBe(true);

    // Subsequent record under ceiling does NOT re-emit warning
    const v2 = wd.recordTokens(100, 100, MODEL);
    expect(v2).toBe('continue');
    const warningCount = wd.getEvents().filter((e) => e.type === 'cost_warning').length;
    expect(warningCount).toBe(1);
  });

  it('returns kill when over 100% and emits cost_kill event', () => {
    const wd = new Watchdog(TASK_ID, 200, COMPANY_ID, 0.50);
    const verdict = wd.recordTokens(HEAVY_INPUT, HEAVY_OUTPUT, MODEL); // ~$1.05 vs $0.50
    expect(verdict).toBe('kill');
    expect(wd.wasKilled()).toBe(true);
    const events = wd.getEvents();
    expect(events.some((e) => e.type === 'cost_kill')).toBe(true);
  });

  it('getBudgetSummary produces a stable format with both turn + cost', () => {
    const wd = new Watchdog(TASK_ID, 200, COMPANY_ID, 1.50);
    wd.recordTurn(null);
    wd.recordTokens(10_000, 5_000, MODEL); // 10k*3 + 5k*15 = 30 + 75 = 105 micro-cents = $0.105

    const summary = wd.getBudgetSummary();
    expect(summary).toMatch(/^BUDGET:/);
    expect(summary).toContain('turn 1/200');
    expect(summary).toContain('$0.1050'); // 4-dp formatting locked in
    expect(summary).toContain('/$1.50');
  });

  it('getBudgetSummary omits cost portion when ceiling is null', () => {
    const wd = new Watchdog(TASK_ID, 200, COMPANY_ID); // no ceiling
    wd.recordTurn(null);
    wd.recordTokens(10_000, 5_000, MODEL);

    const summary = wd.getBudgetSummary();
    expect(summary).toContain('turn 1/200');
    expect(summary).not.toContain('$');
  });

  it('DISABLE_COST_CEILING env var → getCostCeilingForAgent returns null for every agent', () => {
    const orig = process.env.DISABLE_COST_CEILING;
    try {
      process.env.DISABLE_COST_CEILING = 'true';
      expect(getCostCeilingForAgent(30, 3)).toBeNull();
      expect(getCostCeilingForAgent(30, 10)).toBeNull();
      expect(getCostCeilingForAgent(42)).toBeNull();
      expect(getCostCeilingForAgent(0)).toBeNull();
    } finally {
      if (orig === undefined) delete process.env.DISABLE_COST_CEILING;
      else process.env.DISABLE_COST_CEILING = orig;
    }
  });

  it('null ceiling → recordTokens never kills, getBudgetSummary omits cost', () => {
    const wd = new Watchdog(TASK_ID, 200, COMPANY_ID, null);
    // Spend $$$ — should never trip
    const v = wd.recordTokens(10_000_000, 5_000_000, MODEL); // ~$105
    expect(v).toBe('continue');
    expect(wd.wasKilled()).toBe(false);
    wd.recordTurn(null);
    const summary = wd.getBudgetSummary();
    expect(summary).toContain('turn 1/200');
    expect(summary).not.toContain('$');
  });

  it('regression: recordTurn + recordToolCall still trip kill verdicts independently', () => {
    const wd = new Watchdog(TASK_ID, 1, COMPANY_ID, 100.0); // turn cap 1, generous cost ceiling
    const verdict = wd.recordTurn(null);
    expect(verdict).toBe('kill'); // hits maxTurns immediately
    expect(wd.wasKilled()).toBe(true);

    // Loop-detection path (separate Watchdog so prior kill state doesn't leak)
    const wd2 = new Watchdog(TASK_ID, 200, COMPANY_ID, 100.0);
    let lastVerdict: ReturnType<typeof wd2.recordToolCall> = 'continue';
    for (let i = 0; i < 10; i++) lastVerdict = wd2.recordToolCall('same_tool');
    expect(lastVerdict).toBe('kill');
  });
});
