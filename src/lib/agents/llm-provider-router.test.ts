import { describe, it, expect, beforeEach } from 'vitest';
import { pickProviderOrder, recordProviderOutcome, _resetForTests, _statsSnapshot } from './llm-provider-router';

describe('llm-provider-router', () => {
  beforeEach(() => _resetForTests());

  it('with no history, returns providers in the configured order', () => {
    const order = pickProviderOrder(['openai', 'anthropic', 'openrouter', 'gemini']);
    expect(order).toEqual(['openai', 'anthropic', 'openrouter', 'gemini']);
  });

  it('demotes a provider that has failed ≥3 times with high failure rate', () => {
    // Anthropic flakes out repeatedly
    for (let i = 0; i < 5; i++) recordProviderOutcome('anthropic', false, 0);
    const order = pickProviderOrder(['openai', 'anthropic', 'openrouter', 'gemini']);
    expect(order[0]).toBe('openai');
    expect(order[order.length - 1]).toBe('anthropic'); // pushed to last
  });

  it('keeps a provider with one failure but healthy overall in its preferred slot', () => {
    // 1 fail in 10 calls = 10% failure rate (Laplace smoothed: ~17%) — under threshold
    for (let i = 0; i < 9; i++) recordProviderOutcome('openai', true, 500);
    recordProviderOutcome('openai', false, 0);
    const order = pickProviderOrder(['openai', 'anthropic', 'openrouter', 'gemini']);
    expect(order[0]).toBe('openai'); // not demoted
  });

  it('keeps the preferred provider ahead when it is slow but working', () => {
    // anthropic responds in 30s consistently; openai in 500ms
    for (let i = 0; i < 10; i++) {
      recordProviderOutcome('anthropic', true, 30_000);
      recordProviderOutcome('openai', true, 500);
    }
    const order = pickProviderOrder(['anthropic', 'openai', 'openrouter', 'gemini']);
    expect(order[0]).toBe('anthropic');
  });

  it('a recovered provider re-promotes after ~25 consecutive successes (failure-rate decay)', () => {
    // Outage: 10 failures
    for (let i = 0; i < 10; i++) recordProviderOutcome('anthropic', false, 0);
    let order = pickProviderOrder(['anthropic', 'openai', 'openrouter', 'gemini']);
    expect(order[0]).not.toBe('anthropic'); // demoted

    // Recovery: many consecutive successes. After 25 successes, 5 historical
    // failures should be decayed (1 per 5 successes), bringing failure rate down.
    for (let i = 0; i < 25; i++) recordProviderOutcome('anthropic', true, 500);

    const snap = _statsSnapshot();
    expect(snap.anthropic.failures).toBeLessThan(10); // decayed
    // Configured-preferred is anthropic, healthy now → should be first.
    order = pickProviderOrder(['anthropic', 'openai', 'openrouter', 'gemini']);
    expect(order[0]).toBe('anthropic');
  });

  it('clears active cooldown after 3 consecutive successes', () => {
    // Drive into cooldown
    for (let i = 0; i < 5; i++) recordProviderOutcome('openai', false, 0);
    let snap = _statsSnapshot();
    expect(snap.openai.unhealthyUntil).toBeGreaterThan(0);

    // 3 successes → cooldown lifted
    recordProviderOutcome('openai', true, 500);
    recordProviderOutcome('openai', true, 500);
    recordProviderOutcome('openai', true, 500);
    snap = _statsSnapshot();
    expect(snap.openai.unhealthyUntil).toBe(0);
  });

  it('records outcomes correctly in the snapshot', () => {
    recordProviderOutcome('openai', true, 1000);
    recordProviderOutcome('openai', false, 0);
    const snap = _statsSnapshot();
    expect(snap.openai.attempts).toBe(2);
    expect(snap.openai.failures).toBe(1);
  });
});
