// tests/auth.test.js — register / login / logout flow tests.
//
// Mirrors the shape of `verify_user_journey` (which the platform's
// Engineering Agent calls after every deploy). Catches the bug class we
// hit before adding `app.set('trust proxy', 1)`: register would 302 to
// /dashboard but the next /dashboard fetch would 302 to /login because
// the session cookie wasn't being sent.
//
// Uses supertest (in-process — no live server) and a Postgres instance
// pointed at by DATABASE_URL. CI / local: provide a test database in
// .env.test or skip this file (ts.skip).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

let app, pool;

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
    // Skip the suite gracefully if no test DB. Better UX than failing all tests
    // on missing infra.
    return;
  }
  ({ app, pool } = await import('../server.js'));
  // Ensure schema is migrated. In real CI you'd run psql -f db/schema.sql first.
  // Here we tolerate "already exists" so the suite is rerunnable.
  // (Skipped if the import itself failed because of bad env.)
});

afterAll(async () => {
  if (pool) await pool.end();
});

const skipIfNoDb = process.env.DATABASE_URL && process.env.SESSION_SECRET ? describe : describe.skip;

skipIfNoDb('auth flow', () => {
  const email = `auth-${Date.now()}@test.local`;
  const password = 'TestPassword123!';

  it('rejects register with missing password', async () => {
    const res = await request(app).post('/auth/register').type('form').send({ email, password: '' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/required/i);
  });

  it('register: 302 to /dashboard, sets session cookie', async () => {
    const res = await request(app).post('/auth/register').type('form').send({ email, password });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
    // Catches the trust-proxy bug: without app.set('trust proxy', 1) +
    // cookie.secure mismatch, no Set-Cookie comes back at all.
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].join(' ')).toMatch(/sid=/);
  });

  it('reusing the same email returns 409 (handled UNIQUE violation)', async () => {
    const res = await request(app).post('/auth/register').type('form').send({ email, password });
    expect(res.status).toBe(409);
    expect(res.text).toMatch(/already registered/i);
  });

  it('login with wrong password returns 401, not 500', async () => {
    const res = await request(app).post('/auth/login').type('form').send({ email, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.text).toMatch(/invalid/i);
  });

  it('register → /dashboard via cookie persists across requests', async () => {
    const agent = request.agent(app); // persists cookies across calls
    const e2 = `auth-flow-${Date.now()}@test.local`;
    const reg = await agent.post('/auth/register').type('form').send({ email: e2, password });
    expect(reg.status).toBe(302);
    expect(reg.headers.location).toBe('/dashboard');
    const dash = await agent.get('/dashboard');
    // /dashboard is requireAuth-gated. If session lost, it would 302 to /login
    // (the threadpulse trust-proxy bug). 200 means the cookie persisted.
    expect(dash.status).toBe(200);
    expect(dash.text).toMatch(/Dashboard/);
  });

  it('logout clears session — next /dashboard goes to /login', async () => {
    const agent = request.agent(app);
    const e3 = `auth-logout-${Date.now()}@test.local`;
    await agent.post('/auth/register').type('form').send({ email: e3, password });
    const out = await agent.post('/auth/logout');
    expect(out.status).toBe(302);
    const dash = await agent.get('/dashboard');
    expect(dash.status).toBe(302);
    expect(dash.headers.location).toBe('/login');
  });
});
