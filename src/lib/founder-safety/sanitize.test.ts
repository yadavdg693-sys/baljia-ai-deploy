// Unit tests for sanitizeForFounder — keep in lockstep with banned-terms.ts.
// These run on every CI push. The banlist is intentionally NARROW (phrase
// patterns only, no bare product names) so false positives are rare.

import { describe, expect, it } from 'vitest';
import { sanitizeForFounder, FounderSafetyViolation } from './sanitize';

describe('sanitizeForFounder — narrow banlist (critical)', () => {
  it('does NOT flag bare product names used as competitor references', () => {
    // These are the legit-competitor cases we must NEVER mangle.
    const legitCases = [
      'Cloudflare is a major CDN competitor',
      'Our target market is companies currently using Neon',
      'Built on Postgres and highly scalable',
      'We compete with Render and Vercel',
      'The Express framework is one option',         // "Express framework" too generic — not banned
      'Express yourself clearly',                     // bare "Express" — verb
      'render the page carefully',                    // bare "render" — verb
      'R2 object storage is a feature',               // bare "R2"
      'We use a serverless function for this flow',   // generic industry term
      'check our GitHub repo for the full code',      // founder phrasing
    ];
    for (const input of legitCases) {
      const r = sanitizeForFounder(input, { mode: 'soft' });
      expect(r.hadViolations, `expected ${JSON.stringify(input)} to pass clean`).toBe(false);
      expect(r.clean).toBe(input);
    }
  });

  it('does NOT flag founder input describing their own product space', () => {
    const founderInputs = [
      'build something like Vercel but for data',
      'a Postgres GUI for non-technical teams',
      'a Neon alternative with stricter SLAs',
      'make a Render competitor focused on EU',
    ];
    for (const input of founderInputs) {
      const r = sanitizeForFounder(input, { mode: 'soft' });
      expect(r.hadViolations, `expected ${JSON.stringify(input)} to pass clean`).toBe(false);
    }
  });

  it('passes clean platform-authored activity lines', () => {
    const activities = [
      'Setting up your backend infrastructure',
      'Database ready: my-app-123',
      'Code repository ready: https://github.com/BALAJIapps/my-app',  // URL not banned
      'Scouting the web for: "book generator competitors"',
      '3 tasks queued: engineering (3h) → research (1h) → outreach (1h)',
      'Mission: help every founder in Mumbai',
    ];
    for (const input of activities) {
      const r = sanitizeForFounder(input, { mode: 'soft' });
      expect(r.hadViolations, `expected ${JSON.stringify(input)} to pass clean`).toBe(false);
    }
  });
});

describe('sanitizeForFounder — still catches real leaks', () => {
  it('catches implementation-leak phrases', () => {
    const cases = [
      'Cloudflare Worker deployed at {slug}.baljia.app',
      'hosted on Cloudflare',
      'Neon DB ready: my-app-123',
      'our Neon database is live',
      'Neon Postgres connection string',
      'hosted on Render',
      'the Render service spun up cleanly',
      'Express.js server is listening',
      'Express backend with middleware',
      'Used wrangler to deploy',
      'uses drizzle-orm for queries',
    ];
    for (const input of cases) {
      const r = sanitizeForFounder(input, { mode: 'soft' });
      expect(r.hadViolations, `expected ${JSON.stringify(input)} to flag`).toBe(true);
    }
  });

  it('catches internal terminology', () => {
    const cases = [
      'the worker agent will retry',
      'Engineering agent will handle this',
      'assigned to a worker_lane',
      'using the ContextPacket',
      'WORKER-VOICED reasoning expected',
    ];
    for (const input of cases) {
      const r = sanitizeForFounder(input, { mode: 'soft' });
      expect(r.hadViolations, `expected ${JSON.stringify(input)} to flag`).toBe(true);
    }
  });

  it('catches multiple violations', () => {
    const r = sanitizeForFounder(
      'Cloudflare Worker hosted on Render with a Neon DB and Express.js',
      { mode: 'soft' },
    );
    expect(r.violations.length).toBeGreaterThanOrEqual(4);
  });

  it('redacts in place', () => {
    const r = sanitizeForFounder('The Neon DB is ready.', { mode: 'soft' });
    expect(r.clean).toBe('The [redacted] is ready.');
  });
});

describe('sanitizeForFounder — mode semantics', () => {
  it('strict throws on first violation', () => {
    expect(() => sanitizeForFounder('Neon DB ready', { mode: 'strict' }))
      .toThrow(FounderSafetyViolation);
  });

  it('strict passes clean content untouched', () => {
    expect(() => sanitizeForFounder('Database ready', { mode: 'strict' })).not.toThrow();
  });

  it('audit logs but does NOT modify text', () => {
    const input = 'the Neon DB crashed';
    const r = sanitizeForFounder(input, { mode: 'audit' });
    expect(r.hadViolations).toBe(true);
    expect(r.clean).toBe(input); // unchanged — audit is log-only
    expect(r.violations.map((v) => v.label)).toContain('Neon DB');
  });

  it('audit returns input unchanged when clean', () => {
    const input = 'Cloudflare is a competitor in this space';
    const r = sanitizeForFounder(input, { mode: 'audit' });
    expect(r.hadViolations).toBe(false);
    expect(r.clean).toBe(input);
  });
});

describe('sanitizeForFounder — vendor opt-in', () => {
  it('vendors excluded by default', () => {
    const r = sanitizeForFounder('verified via Hunter.io', { mode: 'soft' });
    expect(r.hadViolations).toBe(false);
  });

  it('vendors catch when includeVendors=true', () => {
    const r = sanitizeForFounder('verified via Hunter.io', {
      mode: 'soft',
      includeVendors: true,
    });
    expect(r.hadViolations).toBe(true);
  });
});

describe('sanitizeForFounder — edge cases', () => {
  it('handles empty string', () => {
    const r = sanitizeForFounder('', { mode: 'soft' });
    expect(r.hadViolations).toBe(false);
    expect(r.clean).toBe('');
  });

  it('handles ~15kB in under 500ms', () => {
    const longClean = 'This is a long clean string. '.repeat(500);
    const start = Date.now();
    const r = sanitizeForFounder(longClean, { mode: 'soft' });
    expect(r.hadViolations).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('counts each occurrence of a repeated term', () => {
    const r = sanitizeForFounder('Neon DB is slow. Neon DB is slow.', { mode: 'soft' });
    expect(r.violations.length).toBe(2);
  });

  it('violation indices ascend', () => {
    const r = sanitizeForFounder(
      'Neon DB first then a Cloudflare Worker',
      { mode: 'soft' },
    );
    const idxs = r.violations.map((v) => v.index);
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });
});

describe('sanitizeForFounder — allowedTerms (per-callsite opt-in)', () => {
  // The allowedTerms option lets internal-only callsites permit specific banned
  // phrases through unredacted. Use VERY sparingly — only when the callsite is
  // genuinely internal and the text never lands on a founder-visible surface.

  it('without allowedTerms, banned phrase is redacted in soft mode', () => {
    // Use a phrase that's actually in the strict banlist. "Neon DB" is.
    const r = sanitizeForFounder('Use Neon DB for storage', { mode: 'soft' });
    expect(r.hadViolations).toBe(true);
    expect(r.clean).not.toContain('Neon DB');
  });

  it('with allowedTerms including the phrase, it passes through unredacted', () => {
    const r = sanitizeForFounder('Use Neon DB for storage', {
      mode: 'soft',
      allowedTerms: ['Neon DB'],
    });
    expect(r.hadViolations).toBe(false);
    expect(r.clean).toBe('Use Neon DB for storage');
  });

  it('allowedTerms is case-insensitive', () => {
    const r = sanitizeForFounder('use neon db here', {
      mode: 'soft',
      allowedTerms: ['NEON DB'],
    });
    expect(r.hadViolations).toBe(false);
  });

  it('only allowed phrases pass through; other banned phrases still redact', () => {
    const r = sanitizeForFounder('Use Neon DB and Cloudflare Worker', {
      mode: 'soft',
      allowedTerms: ['Neon DB'],
    });
    expect(r.hadViolations).toBe(true); // Cloudflare Worker still violates
    expect(r.clean).toContain('Neon DB');
    expect(r.clean).not.toContain('Cloudflare Worker');
  });

  it('empty allowedTerms behaves like no option (all banned phrases caught)', () => {
    const a = sanitizeForFounder('Use Neon DB for storage', { mode: 'soft', allowedTerms: [] });
    const b = sanitizeForFounder('Use Neon DB for storage', { mode: 'soft' });
    expect(a.violations.length).toBe(b.violations.length);
  });
});
