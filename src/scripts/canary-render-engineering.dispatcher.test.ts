import { describe, expect, it } from 'vitest';

import {
  CANARY_SCENARIOS,
  parseArgs,
  resolveTreeRoot,
  selectScenariosForRun,
} from './canary-render-engineering';
import { EXTENDED_CANARY_SCENARIOS } from './canary-extended-scenarios';

describe('canary runner dispatcher', () => {
  it('no flags → 7 core only (back-compat)', () => {
    const parsed = parseArgs([]);
    const scenarios = selectScenariosForRun(parsed);
    expect(scenarios.length).toBe(CANARY_SCENARIOS.length);
    expect(scenarios.map((s) => s.id)).toEqual(CANARY_SCENARIOS.map((s) => s.id));
    expect(resolveTreeRoot(parsed)).toBe('engineering-95');
  });

  it('--core selects 7 core scenarios', () => {
    const parsed = parseArgs(['--core']);
    const scenarios = selectScenariosForRun(parsed);
    expect(scenarios.length).toBe(7);
    expect(scenarios.map((s) => s.id).sort()).toEqual(CANARY_SCENARIOS.map((s) => s.id).sort());
    expect(resolveTreeRoot(parsed)).toBe('engineering-95');
  });

  it('--extended selects the 12 extended scenarios + world-class tree', () => {
    const parsed = parseArgs(['--extended']);
    const scenarios = selectScenariosForRun(parsed);
    expect(scenarios.length).toBe(12);
    expect(scenarios.map((s) => s.id).sort()).toEqual(EXTENDED_CANARY_SCENARIOS.map((s) => s.id).sort());
    expect(resolveTreeRoot(parsed)).toBe('engineering-world-class');
  });

  it('--all selects all 19 scenarios + world-class tree', () => {
    const parsed = parseArgs(['--all']);
    const scenarios = selectScenariosForRun(parsed);
    expect(scenarios.length).toBe(19);
    expect(resolveTreeRoot(parsed)).toBe('engineering-world-class');
  });

  it('--core --extended together selects all 19', () => {
    const parsed = parseArgs(['--core', '--extended']);
    const scenarios = selectScenariosForRun(parsed);
    expect(scenarios.length).toBe(19);
  });

  it('--confidence-run implies all 19 scenarios + world-class tree', () => {
    const parsed = parseArgs(['--confidence-run']);
    const scenarios = selectScenariosForRun(parsed);
    expect(scenarios.length).toBe(19);
    expect(resolveTreeRoot(parsed)).toBe('engineering-world-class');
  });

  it('--scenario <id> selects exactly that one (core or extended)', () => {
    const parsedCore = parseArgs(['--scenario', 'ai-course-marketplace']);
    expect(selectScenariosForRun(parsedCore).map((s) => s.id)).toEqual(['ai-course-marketplace']);

    const parsedExtended = parseArgs(['--scenario', 'ecommerce-store']);
    expect(selectScenariosForRun(parsedExtended).map((s) => s.id)).toEqual(['ecommerce-store']);
  });

  it('--scenario with unknown id throws with helpful message', () => {
    const parsed = parseArgs(['--scenario', 'totally-not-real']);
    expect(() => selectScenariosForRun(parsed)).toThrow(/Unknown scenario "totally-not-real"/);
  });

  it('every extended scenario is dispatchable via --scenario', () => {
    for (const scenario of EXTENDED_CANARY_SCENARIOS) {
      const parsed = parseArgs(['--scenario', scenario.id]);
      const selected = selectScenariosForRun(parsed);
      expect(selected.map((s) => s.id)).toEqual([scenario.id]);
    }
  });

  it('every core scenario is dispatchable via --scenario', () => {
    for (const scenario of CANARY_SCENARIOS) {
      const parsed = parseArgs(['--scenario', scenario.id]);
      const selected = selectScenariosForRun(parsed);
      expect(selected.map((s) => s.id)).toEqual([scenario.id]);
    }
  });

  it('parseArgs respects --run-id', () => {
    const parsed = parseArgs(['--all', '--run-id', 'my-test-run']);
    expect(parsed.runId).toBe('my-test-run');
  });

  it('parseArgs supports an explicit Render quota-restored retry flag', () => {
    expect(parseArgs(['--scenario', 'finance-crypto-dashboard']).forceAfterQuotaRestored).toBe(false);
    expect(parseArgs(['--scenario', 'finance-crypto-dashboard', '--force-after-quota-restored']).forceAfterQuotaRestored).toBe(true);
    expect(parseArgs(['--scenario', 'finance-crypto-dashboard'], { CANARY_FORCE_AFTER_QUOTA_RESTORED: 'true' }).forceAfterQuotaRestored).toBe(true);
  });

  it('default --run-id uses engineering-world-class prefix', () => {
    const parsed = parseArgs(['--all']);
    expect(parsed.runId).toMatch(/^engineering-world-class-/);
  });
});
