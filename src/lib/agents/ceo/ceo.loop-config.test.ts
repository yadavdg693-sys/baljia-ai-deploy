import { describe, expect, it } from 'vitest';
import {
  CEO_PROCESSING_LIMIT_TEXT,
  getCeoMaxResponseTokens,
  getCeoMaxToolTurns,
  getCeoRollingTaskLimit,
} from './ceo.loop-config';

describe('CEO loop config', () => {
  it('allows enough default tool turns for multi-task creation', () => {
    expect(getCeoMaxToolTurns({})).toBeGreaterThanOrEqual(12);
  });

  it('bounds env overrides for tool turns and response tokens', () => {
    expect(getCeoMaxToolTurns({ CEO_MAX_TOOL_TURNS: '3' })).toBe(5);
    expect(getCeoMaxToolTurns({ CEO_MAX_TOOL_TURNS: '99' })).toBe(30);
    expect(getCeoMaxToolTurns({ CEO_MAX_TOOL_TURNS: '18' })).toBe(18);

    expect(getCeoMaxResponseTokens({ CEO_MAX_RESPONSE_TOKENS: '900' })).toBe(1024);
    expect(getCeoMaxResponseTokens({ CEO_MAX_RESPONSE_TOKENS: '20000' })).toBe(12000);
    expect(getCeoMaxResponseTokens({ CEO_MAX_RESPONSE_TOKENS: '8192' })).toBe(8192);
  });

  it('defaults confirmed build plans to a three-task rolling queue and bounds overrides', () => {
    expect(getCeoRollingTaskLimit({})).toBe(3);
    expect(getCeoRollingTaskLimit({ CEO_ROLLING_TASK_LIMIT: '0' })).toBe(1);
    expect(getCeoRollingTaskLimit({ CEO_ROLLING_TASK_LIMIT: '20' })).toBe(12);
    expect(getCeoRollingTaskLimit({ CEO_ROLLING_TASK_LIMIT: '7' })).toBe(7);
  });

  it('keeps the route-detectable processing limit marker in the user-facing text', () => {
    expect(CEO_PROCESSING_LIMIT_TEXT).toContain('Reached processing limit');
  });
});
