import { describe, it, expect } from 'vitest';
import { scanFile, scanFiles, summarizeFindings } from './static-code-scan';

describe('static-code-scan rules', () => {
  it('flags silent catch (empty body)', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'try { doIt(); } catch (e) {}' });
    expect(f.some((x) => x.rule === 'silent-catch')).toBe(true);
  });

  it('flags silent catch (return false body)', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'try { doIt(); } catch (err) { return false; }' });
    expect(f.some((x) => x.rule === 'silent-catch' && x.severity === 'high')).toBe(true);
  });

  it('does NOT flag a catch with a real handler', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'try { doIt(); } catch (e) { logger.error(e); throw e; }' });
    expect(f.some((x) => x.rule === 'silent-catch')).toBe(false);
  });

  it('flags secret-shaped var in console.log', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'console.log("DB:", DATABASE_URL);' });
    expect(f.some((x) => x.rule === 'secret-in-log')).toBe(true);
  });

  it('flags STRIPE_API_KEY in logger.info', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'logger.info({ key: STRIPE_API_KEY });' });
    expect(f.some((x) => x.rule === 'secret-in-log')).toBe(true);
  });

  it('does NOT flag a regular log of non-secret data', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'console.log("user signed up", userId);' });
    expect(f.some((x) => x.rule === 'secret-in-log')).toBe(false);
  });

  it('flags TODO/FIXME', () => {
    const f = scanFile({ path: 'src/foo.js', content: '// TODO: fix this\nfoo();' });
    expect(f.some((x) => x.rule === 'todo-fixme')).toBe(true);
  });

  it('flags template-literal SQL interpolation', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'pool.query(`SELECT * FROM users WHERE email = ${email}`)' });
    expect(f.some((x) => x.rule === 'sql-template-interpolation' && x.severity === 'high')).toBe(true);
  });

  it('does NOT flag parameterized SQL', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'pool.query("SELECT * FROM users WHERE email = $1", [email])' });
    expect(f.some((x) => x.rule === 'sql-template-interpolation')).toBe(false);
  });

  it('flags app.use(session) without trust proxy in server.js', () => {
    const f = scanFile({
      path: 'server.js',
      content: 'const app = express();\napp.use(session({ secret: "x", store: new PgSession() }));',
    });
    expect(f.some((x) => x.rule === 'session-without-trust-proxy' && x.severity === 'high')).toBe(true);
  });

  it('does NOT flag session usage when trust proxy is set', () => {
    const f = scanFile({
      path: 'server.js',
      content: 'const app = express();\napp.set("trust proxy", 1);\napp.use(session({ secret: "x" }));',
    });
    expect(f.some((x) => x.rule === 'session-without-trust-proxy')).toBe(false);
  });

  it('flags hardcoded test email in non-test code', () => {
    const f = scanFile({ path: 'src/foo.js', content: 'const adminEmail = "test+admin@baljia.test";' });
    expect(f.some((x) => x.rule === 'hardcoded-test-email')).toBe(true);
  });

  it('skips test files entirely', () => {
    const all = scanFiles([
      { path: 'tests/foo.test.js', content: 'try {} catch (e) {} // would normally flag' },
    ]);
    expect(all.length).toBe(0);
  });

  it('skips non-source files', () => {
    const all = scanFiles([
      { path: 'README.md',     content: '// TODO: nothing in markdown is code' },
      { path: 'package.json',  content: '{}' },
    ]);
    expect(all.length).toBe(0);
  });

  it('summarizeFindings returns PASS line on empty', () => {
    expect(summarizeFindings([])).toMatch(/^STATIC SCAN PASS/);
  });

  it('summarizeFindings groups by severity', () => {
    const summary = summarizeFindings([
      { severity: 'high',   file: 'a.js', rule: 'silent-catch',  message: 'm' },
      { severity: 'medium', file: 'b.js', rule: 'env-without-config', message: 'm' },
      { severity: 'low',    file: 'c.js', rule: 'todo-fixme',    message: 'm' },
    ]);
    expect(summary).toMatch(/high=1/);
    expect(summary).toMatch(/medium=1/);
    expect(summary).toMatch(/low=1/);
  });

  // ── Skeleton-hardening rules (catch agent removing default protection) ──

  it('flags Express main entry without helmet', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst app = express();\napp.set('trust proxy', 1);\napp.get('/', (_, res) => res.send('hi'));`,
    });
    expect(f.some((x) => x.rule === 'missing-helmet' && x.severity === 'high')).toBe(true);
  });

  it('does NOT flag missing-helmet when helmet IS used', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst helmet = require('helmet');\nconst app = express();\napp.use(helmet({ contentSecurityPolicy: { directives: {} } }));`,
    });
    expect(f.some((x) => x.rule === 'missing-helmet')).toBe(false);
  });

  it('flags auth route without rate-limit', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst app = express();\napp.post('/auth/login', async (req, res) => res.json({}));`,
    });
    expect(f.some((x) => x.rule === 'auth-route-without-rate-limit' && x.severity === 'high')).toBe(true);
  });

  it('does NOT flag auth route when rate-limit IS imported', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst rateLimit = require('express-rate-limit');\nconst app = express();\nconst lim = rateLimit({ max: 30 });\napp.post('/auth/login', lim, async (req, res) => res.json({}));`,
    });
    expect(f.some((x) => x.rule === 'auth-route-without-rate-limit')).toBe(false);
  });

  it('flags /api/health without DB probe', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst app = express();\napp.get('/api/health', (req, res) => { res.json({ ok: true }); });`,
    });
    expect(f.some((x) => x.rule === 'health-without-db-probe' && x.severity === 'high')).toBe(true);
  });

  it('does NOT flag /api/health when it queries the DB', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst app = express();\napp.get('/api/health', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });`,
    });
    expect(f.some((x) => x.rule === 'health-without-db-probe')).toBe(false);
  });

  it('flags express.json() without explicit limit', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst app = express();\napp.use(express.json());`,
    });
    expect(f.some((x) => x.rule === 'body-without-size-limit' && x.severity === 'medium')).toBe(true);
  });

  it('does NOT flag express.json({ limit: ... })', () => {
    const f = scanFile({
      path: 'server.js',
      content: `const express = require('express');\nconst app = express();\napp.use(express.json({ limit: '64kb' }));`,
    });
    expect(f.some((x) => x.rule === 'body-without-size-limit')).toBe(false);
  });
});
