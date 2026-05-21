// tests/health.test.js — /api/health probe-shape tests.
//
// Why this file exists: a /api/health endpoint that only does SELECT 1
// passes when the DB is up but the app is broken in other ways (env vars
// dropped, Stripe key invalid, session table missing). These tests pin
// down the SHAPE of the health response so a regression to "just return ok"
// trips a test, not a deploy.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

let app, pool;

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) return;
  ({ app, pool } = await import('../server.js'));
});

afterAll(async () => {
  if (pool) await pool.end();
});

const skipIfNoDb = process.env.DATABASE_URL && process.env.SESSION_SECRET ? describe : describe.skip;

skipIfNoDb('/api/health', () => {
  it('returns JSON with per-check breakdown, not just "ok"', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBeOneOf([200, 503]);
    expect(res.body).toHaveProperty('ok');
    expect(res.body).toHaveProperty('checks');
    expect(typeof res.body.checks).toBe('object');
  });

  it('reports the DB check explicitly', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.checks).toHaveProperty('db');
    // Either 'ok' or an explanatory error string — never undefined / null.
    expect(typeof res.body.checks.db).toBe('string');
    expect(res.body.checks.db.length).toBeGreaterThan(0);
  });

  it('reports the session-store check explicitly', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.checks).toHaveProperty('session_store');
    expect(typeof res.body.checks.session_store).toBe('string');
  });

  it('Stripe is not_configured when STRIPE_API_KEY is unset', async () => {
    if (process.env.STRIPE_API_KEY) {
      // Live key configured — skip this assertion.
      return;
    }
    const res = await request(app).get('/api/health');
    expect(res.body.checks.stripe).toBe('not_configured');
  });

  it('returns 503 (not 200) when any dependency is degraded', async () => {
    // The intent: even if the test env happens to be all-green, the SHAPE
    // of the response (the conditional status code) must be there.
    const res = await request(app).get('/api/health');
    if (res.body.ok === false) {
      expect(res.status).toBe(503);
    } else {
      expect(res.status).toBe(200);
    }
    // No matter what, body.ok must agree with status code.
    expect(res.body.ok).toBe(res.status === 200);
  });
});

// Tiny matcher polyfill — vitest doesn't ship toBeOneOf by default.
expect.extend({
  toBeOneOf(received, list) {
    const pass = list.includes(received);
    return { pass, message: () => `expected ${received} to be one of ${list.join(', ')}` };
  },
});
