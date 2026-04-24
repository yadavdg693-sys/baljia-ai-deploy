// Unit tests for sanitizeForFounder — keep in lockstep with banned-terms.ts.
// These run on every CI push and catch regressions where someone adds a new
// banned term but forgets to update the matcher, or relaxes the matcher in a
// way that lets real leaks through.

import { describe, expect, it } from 'vitest';
import { sanitizeForFounder, FounderSafetyViolation } from './sanitize';

describe('sanitizeForFounder — soft mode', () => {
  it('passes clean text untouched', () => {
    const r = sanitizeForFounder('Setting up your backend infrastructure', { mode: 'soft' });
    expect(r.hadViolations).toBe(false);
    expect(r.clean).toBe('Setting up your backend infrastructure');
    expect(r.violations).toHaveLength(0);
  });

  it('does not false-positive on common English words', () => {
    // "render" as a verb (lowercase) is OK; only "Render service" / "hosted on Render" is banned
    expect(sanitizeForFounder('render the page carefully', { mode: 'soft' }).hadViolations).toBe(false);
    // "Express yourself" — the ambiguous bare "Express" is never banned alone
    expect(sanitizeForFounder('Express yourself clearly', { mode: 'soft' }).hadViolations).toBe(false);
    // "Mumbai" — geographic names must never trigger
    expect(sanitizeForFounder('help every founder in Mumbai', { mode: 'soft' }).hadViolations).toBe(false);
  });

  it('catches infrastructure leaks', () => {
    const cases = [
      'Neon DB ready: my-app-123',
      'hosted on Render',
      'Express.js server',
      'Cloudflare Worker deployed',
      'Postgres connection string',
      'Used wrangler to deploy',
    ];
    for (const input of cases) {
      const r = sanitizeForFounder(input, { mode: 'soft' });
      expect(r.hadViolations, `expected ${JSON.stringify(input)} to flag`).toBe(true);
      expect(r.clean, `expected ${JSON.stringify(input)} to be redacted`).toContain('[redacted]');
    }
  });

  it('catches internal terminology leaks', () => {
    const cases = [
      'the worker agent will retry',       // "worker agent" is case-insensitive, catches "Worker" too
      'Engineering agent will handle this', // "Engineering agent" is case-sensitive (proper noun)
      'assigned to a worker_lane',
      'using the ContextPacket',
    ];
    for (const input of cases) {
      const r = sanitizeForFounder(input, { mode: 'soft' });
      expect(r.hadViolations, `expected ${JSON.stringify(input)} to flag`).toBe(true);
    }
  });

  it('proper-noun terms are case-sensitive (avoid false positives on verbs)', () => {
    // "engineering agent" lowercase is NOT banned — "Engineering agent" proper noun is.
    // Prevents false positives when founders describe their own engineering work.
    const lowercaseClean = sanitizeForFounder('my engineering plan', { mode: 'soft' });
    expect(lowercaseClean.hadViolations).toBe(false);
  });

  it('catches multiple violations in one pass', () => {
    const r = sanitizeForFounder('Used Cloudflare Workers + Neon Postgres to build', { mode: 'soft' });
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
    const labels = r.violations.map((v) => v.label);
    expect(labels).toContain('Cloudflare');
    expect(labels).toContain('Neon');
    expect(labels).toContain('Postgres');
  });

  it('redacts violations in place, preserving surrounding text', () => {
    const r = sanitizeForFounder('The Postgres database is slow.', { mode: 'soft' });
    expect(r.hadViolations).toBe(true);
    expect(r.clean).toBe('The [redacted] database is slow.');
  });

  it('vendor category is excluded from strict list by default', () => {
    // Hunter.io is a vendor — won't fire unless includeVendors is true
    const withoutVendors = sanitizeForFounder('verified via Hunter.io', { mode: 'soft' });
    expect(withoutVendors.hadViolations).toBe(false);

    const withVendors = sanitizeForFounder('verified via Hunter.io', {
      mode: 'soft',
      includeVendors: true,
    });
    expect(withVendors.hadViolations).toBe(true);
  });
});

describe('sanitizeForFounder — strict mode', () => {
  it('passes clean text without throwing', () => {
    expect(() => sanitizeForFounder('Database ready: my-app', { mode: 'strict' })).not.toThrow();
  });

  it('throws FounderSafetyViolation on banned term', () => {
    expect(() => sanitizeForFounder('Neon DB ready', { mode: 'strict' })).toThrow(FounderSafetyViolation);
  });

  it('error carries the violation list', () => {
    try {
      sanitizeForFounder('hosted on Render with Postgres', { mode: 'strict' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FounderSafetyViolation);
      const violations = (err as FounderSafetyViolation).violations;
      expect(violations.length).toBeGreaterThan(0);
      const labels = violations.map((v) => v.label);
      expect(labels).toEqual(expect.arrayContaining(['hosted on Render', 'Postgres']));
    }
  });
});

describe('sanitizeForFounder — edge cases', () => {
  it('handles empty string', () => {
    const r = sanitizeForFounder('', { mode: 'soft' });
    expect(r.hadViolations).toBe(false);
    expect(r.clean).toBe('');
  });

  it('handles very long input without performance cliff', () => {
    const longClean = 'This is a long clean string. '.repeat(500);
    const start = Date.now();
    const r = sanitizeForFounder(longClean, { mode: 'soft' });
    const elapsed = Date.now() - start;
    expect(r.hadViolations).toBe(false);
    expect(elapsed).toBeLessThan(500); // 500ms budget for ~15kB of text
  });

  it('counts each occurrence of a repeated banned term', () => {
    const r = sanitizeForFounder('Postgres is slow. Postgres is slow.', { mode: 'soft' });
    expect(r.violations.length).toBe(2);
  });

  it('returns violation indices in ascending order', () => {
    const r = sanitizeForFounder('Uses Neon and Postgres and Cloudflare', { mode: 'soft' });
    const indices = r.violations.map((v) => v.index);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });
});
