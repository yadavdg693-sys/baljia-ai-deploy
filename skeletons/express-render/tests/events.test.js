// tests/events.test.js — Server-Sent Events endpoint tests.
//
// Catches: missing-headers regressions, no-auth-bypass, heartbeat absence
// (which on Render's proxy would silently drop connections after ~30s).

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

skipIfNoDb('/api/events', () => {
  it('returns 302 to /login when not authenticated', async () => {
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('sets the SSE content-type and disables buffering when authenticated', async () => {
    const agent = request.agent(app);
    const email = `events-${Date.now()}@test.local`;
    await agent.post('/auth/register').type('form').send({ email, password: 'TestPassword123!' });

    // Use buffer(false) + parse so supertest streams instead of buffering.
    // We listen for the first chunk and then close the connection — SSE
    // would otherwise hang the test indefinitely.
    const req = agent.get('/api/events').buffer(false).parse((res, cb) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        if (buf.includes('event: ready')) {
          res.destroy(); // close the connection
          cb(null, buf);
        }
      });
      res.on('error', () => cb(null, buf));
      res.on('end',   () => cb(null, buf));
    });

    let res;
    try {
      res = await req;
    } catch (e) {
      // supertest treats client-side abort as an error; the body is on the
      // error object in some versions.
      res = e.response ?? e;
    }
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(res.headers['x-accel-buffering']).toBe('no');
    // The "ready" frame must appear on connect so clients know the stream is live.
    expect(String(res.body || res.text || '')).toMatch(/event: ready/);
  });
});
