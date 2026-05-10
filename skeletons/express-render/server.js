// server.js — Baljia hardened Express skeleton (Render + Postgres)
//
// What the Engineering Agent must NOT touch (framework):
//   - Zod config schema (CONFIG_SCHEMA + parseConfig)
//   - withTimeout helper
//   - trust proxy + session middleware setup
//   - /api/health endpoint (probes DB + integrations)
//   - register / login / logout handlers
//   - Structured logger
//   - Error envelope helpers (ok / fail)
//
// What the Engineering Agent SHOULD customize:
//   - Hero copy + landing HTML at landingPage()
//   - Feature routes (currently scaffolded as /api/items — rename + reshape)
//   - Feature-specific DB schema (additions to db/schema.sql)
//   - Dashboard rendering (dashboardPage())

'use strict';

const express        = require('express');
const session        = require('express-session');
const PgSession      = require('connect-pg-simple')(session);
const bcrypt         = require('bcryptjs');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const { Pool }       = require('pg');
const { z }          = require('zod');
const pino           = require('pino');

// ── Structured logger ──────────────────────────────────────────────
// Redacts known sensitive keys before output. Use logger.child(...)
// to add request context (request id, user id) per-handler.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'password', 'password_hash', '*.password', '*.password_hash',
      'session_secret', 'authorization', 'cookie',
      'DATABASE_URL', 'SESSION_SECRET', 'STRIPE_API_KEY',
    ],
    censor: '[REDACTED]',
  },
});

// ── Config schema (boot-time validation) ───────────────────────────
// Every required env var must appear here. process.env.X is NEVER
// read directly anywhere in handler code — always via config.X. Render's
// API has been observed to silently drop env vars; without this schema
// the app would boot with `undefined` and fail at the first user request.
const CONFIG_SCHEMA = z.object({
  DATABASE_URL:    z.string().url(),
  SESSION_SECRET:  z.string().min(32, 'SESSION_SECRET must be ≥32 chars'),
  NODE_ENV:        z.enum(['development', 'production', 'test']).default('development'),
  PORT:            z.coerce.number().int().positive().default(10000),
  STRIPE_API_KEY:  z.string().min(20).optional(),
  STRIPE_LINK:     z.string().url().optional(),
});

function parseConfig(env) {
  const result = CONFIG_SCHEMA.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`[CONFIG] Invalid environment:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

// ── Discriminated-union return helpers ─────────────────────────────
// Every handler that talks to a service should produce one of these.
// Using { ok } as the discriminant makes "lying server" responses
// (302 with silently-failed INSERT) impossible at the type level.
const ok   = (data)            => ({ ok: true, data });
const fail = (code, message)   => ({ ok: false, error: { code, message } });

// ── Bounded-timeout wrapper for any external call ──────────────────
// Use for every fetch / pool.query / stripe call / postmark send.
// Apps that hang on a slow third party ship 504s and zombie connections.
function withTimeout(promise, ms, label) {
  let timer;
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeoutP]).finally(() => clearTimeout(timer));
}

// ── Bootstrap ──────────────────────────────────────────────────────
const config = parseConfig(process.env);

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL; cert path varies
  max: 5,
  idleTimeoutMillis: 30_000,
  // Server-side query timeout — bounded even if app forgets withTimeout.
  statement_timeout: 10_000,
});

const app = express();

// trust proxy: 1 — Render runs an HTTP-only reverse proxy in front of
// the Node process. Without this, express-session refuses to set Secure
// cookies (it sees the internal HTTP hop), authentication silently fails.
app.set('trust proxy', 1);

// Security headers — helmet's defaults plus a CSP that allows inline styles
// (the skeleton renders HTML inline) but disallows scripts. If you add JS
// to the page, scope this to a nonce per response rather than 'unsafe-inline'.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'none'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'https:'],
      fontSrc:     ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
      formAction:  ["'self'", 'https://buy.stripe.com'], // pricing page can submit to Stripe
      baseUri:     ["'self'"],
      frameAncestors: ["'self'"],
      // CUSTOMIZE if you add JS, third-party widgets, or external image CDNs.
    },
  },
  crossOriginEmbedderPolicy: false, // common-sense default for landing pages with social embeds
}));

// Auth-route brute-force protection — keeps a single bad actor from running
// 1000 password guesses per minute. Window is per-IP via trust-proxy.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // 30 attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Try again in 15 minutes.',
});

// API-route abuse protection — keeps a single client from hammering CRUD
// endpoints. More generous than authLimiter (legitimate dashboards can
// burst), but still bounded. Per-IP via trust-proxy.
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min window
  max: 120,                // 120 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'rate_limited', message: 'Too many requests. Slow down and try again.' } },
});
app.use('/api', apiLimiter);

app.use(express.urlencoded({ extended: true, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));

app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: config.SESSION_SECRET,
  name: 'sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Per-request logger child with a request id, attached to req.log.
app.use((req, _res, next) => {
  req.log = logger.child({ reqId: cryptoRandomId() });
  next();
});

function cryptoRandomId() {
  return require('crypto').randomBytes(8).toString('hex');
}

// ── Auth middleware ────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// ── /api/health — probes every integration, not just SELECT 1 ──────
// Returns 200 only when ALL probed dependencies are OK. Returns 503
// with per-check breakdown when any are degraded — Render uses this
// for healthchecks and routes around degraded instances.
app.get('/api/health', async (req, res) => {
  const checks = {};
  let allOk = true;

  // DB connectivity + a sample read against an actual app table
  try {
    await withTimeout(pool.query('SELECT 1'), 3_000, 'health: pool.query SELECT 1');
    checks.db = 'ok';
  } catch (err) {
    checks.db = `error: ${err.message}`;
    allOk = false;
  }

  // Sessions table reachable (catches "connect-pg-simple migration didn't run")
  try {
    await withTimeout(pool.query('SELECT 1 FROM session LIMIT 0'), 3_000, 'health: session table');
    checks.session_store = 'ok';
  } catch (err) {
    checks.session_store = `error: ${err.message}`;
    allOk = false;
  }

  // Stripe — treat 401/403 as "configured but bad key" (boot-blocker, not a downtime).
  // Skip the probe if STRIPE_API_KEY isn't set (means the app doesn't use Stripe yet).
  if (config.STRIPE_API_KEY) {
    try {
      const r = await withTimeout(
        fetch('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${config.STRIPE_API_KEY}` },
        }),
        5_000,
        'health: Stripe /balance'
      );
      if (r.status === 200) {
        checks.stripe = 'ok';
      } else if ([401, 403].includes(r.status)) {
        checks.stripe = `bad_credentials (HTTP ${r.status})`;
        allOk = false;
      } else {
        checks.stripe = `unexpected (HTTP ${r.status})`;
        allOk = false;
      }
    } catch (err) {
      checks.stripe = `error: ${err.message}`;
      allOk = false;
    }
  } else {
    checks.stripe = 'not_configured';
  }

  res.status(allOk ? 200 : 503).json({ ok: allOk, status: allOk ? 'ok' : 'degraded', checks });
});

// ── Auth handlers ──────────────────────────────────────────────────

app.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8) {
    return res.status(400).send(registerPage('Email and password (min 8 chars) required.'));
  }
  const cleanEmail = email.toLowerCase().trim();
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await withTimeout(
      pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, plan',
        [cleanEmail, hash]
      ),
      5_000,
      'register: INSERT user'
    );
    if (!rows[0]) {
      // RETURNING gave no row — INSERT silently failed.
      req.log.error({ email: cleanEmail }, 'register: INSERT returned no row');
      return res.status(500).send(registerPage('Could not create account. Please try again.'));
    }
    req.session.userId = rows[0].id;
    req.session.email  = rows[0].email;
    req.session.plan   = rows[0].plan;
    res.redirect('/dashboard');
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).send(registerPage('Email already registered. <a href="/login">Sign in</a>.'));
    }
    req.log.error({ err: err.message, code: err.code }, 'register: error');
    res.status(500).send(registerPage('Registration failed. Please try again.'));
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).send(loginPage('Email and password required.'));
  }
  const cleanEmail = email.toLowerCase().trim();
  try {
    const { rows } = await withTimeout(
      pool.query('SELECT id, email, password_hash, plan FROM users WHERE email = $1', [cleanEmail]),
      5_000,
      'login: SELECT user'
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).send(loginPage('Invalid email or password.'));
    }
    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      return res.status(401).send(loginPage('Invalid email or password.'));
    }
    req.session.userId = user.id;
    req.session.email  = user.email;
    req.session.plan   = user.plan;
    res.redirect('/dashboard');
  } catch (err) {
    req.log.error({ err: err.message, code: err.code }, 'login: error');
    res.status(500).send(loginPage('Sign in failed. Please try again.'));
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ── Pages ──────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.send(landingPage()));
app.get('/register', (_req, res) => res.send(registerPage()));
app.get('/login', (_req, res) => res.send(loginPage()));

// /pricing — skeleton scaffold. CUSTOMIZE: wire a real Stripe payment link.
// The Backend Quality Bar requires that if STRIPE_LINK is set in env, the
// /pricing page must show a real Stripe checkout link. If your app has no
// monetization, delete this route AND remove the link from the landing page.
app.get('/pricing', (_req, res) => {
  if (!config.STRIPE_LINK) {
    return res.status(503).send('<h1>Pricing not yet configured</h1><p>This deployment does not have STRIPE_LINK set. Add a payment link in Stripe and redeploy.</p>');
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pricing</title><style>${baseStyles()}</style></head><body><main class="container narrow"><h1>Pricing</h1><p class="lead">Get started for $19/month.</p><a class="btn" href="${escapeHtml(config.STRIPE_LINK)}" rel="noopener">Subscribe via Stripe</a><p class="muted"><a href="/">← Back</a></p></main></body></html>`);
});

app.get('/dashboard', requireAuth, async (req, res) => {
  // CUSTOMIZE: replace the "items" model with feature-specific data.
  let items = [];
  try {
    const { rows } = await withTimeout(
      pool.query('SELECT id, title, created_at FROM items WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [req.session.userId]),
      3_000,
      'dashboard: list items'
    );
    items = rows;
  } catch (err) {
    req.log.error({ err: err.message }, 'dashboard: items query failed');
  }
  res.send(dashboardPage(req.session.email, items));
});

// ── Feature scaffold (CUSTOMIZE) ───────────────────────────────────
// Replace `items` with the feature-specific noun (monitors, posts, leads, etc.).
// Keep the discriminated-union response shape and the withTimeout wrapper.

app.post('/api/items', requireAuth, async (req, res) => {
  const { title } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json(fail('invalid_input', 'title is required'));
  }
  try {
    const { rows } = await withTimeout(
      pool.query(
        'INSERT INTO items (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at',
        [req.session.userId, title.trim()]
      ),
      5_000,
      'create item'
    );
    // Notify any open SSE subscribers (e.g. another tab the user has open).
    // CUSTOMIZE: change event type to feature-specific ('lead_arrived', etc.).
    publishEvent(req.session.userId, 'item_created', rows[0]);
    res.status(201).json(ok(rows[0]));
  } catch (err) {
    req.log.error({ err: err.message }, 'create item: error');
    res.status(500).json(fail('internal_error', 'Could not save item.'));
  }
});

// ── /api/events — Server-Sent Events for real-time updates ────────
// CUSTOMIZE: emit feature-specific events (new lead arrived, build finished,
// payment received, etc.). Server-Sent Events run on plain HTTP, work on
// Render's free tier without WebSocket plan upgrades, and survive Render's
// reverse proxy without any special config. Use this pattern for:
//   - Live progress bars during a long-running task
//   - "New item arrived" notifications without polling
//   - Per-user activity streams
//
// On the client, subscribe with:
//     const es = new EventSource('/api/events');
//     es.onmessage = (e) => { const d = JSON.parse(e.data); /* update UI */ };
//
// Render's free instance sleeps after 15 min idle. SSE keeps a connection
// open, which prevents sleep AND counts against your 750 free hours/month.
// If your app doesn't need realtime, delete this route entirely.
//
// Architecture: a simple in-memory subscriber map keyed by user_id. For
// multi-instance deployments, swap to Redis pub/sub or Postgres LISTEN/NOTIFY.

const sseSubscribers = new Map(); // userId -> Set<res>

app.get('/api/events', requireAuth, (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx-style buffering on Render's proxy
  });
  res.flushHeaders();

  const userId = req.session.userId;
  const subs = sseSubscribers.get(userId) ?? new Set();
  subs.add(res);
  sseSubscribers.set(userId, subs);

  // Send a hello frame so the client knows the stream is live.
  res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

  // Heartbeat every 25s — Render's proxy idle-timeout is ~30s; without this
  // the connection drops and EventSource auto-reconnects (noisy logs).
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25_000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    const set = sseSubscribers.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseSubscribers.delete(userId);
    }
  });
});

// Helper for handlers to emit an event to a specific user. Call this
// inside your CRUD handlers when something the user cares about happens.
function publishEvent(userId, type, payload) {
  const subs = sseSubscribers.get(userId);
  if (!subs) return;
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subs) {
    try { res.write(frame); } catch { /* client disconnected; cleaned up via 'close' */ }
  }
}

app.delete('/api/items/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await withTimeout(
      pool.query('DELETE FROM items WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]),
      5_000,
      'delete item'
    );
    if (rowCount === 0) return res.status(404).json(fail('not_found', 'Item not found.'));
    res.json(ok({ deleted: true }));
  } catch (err) {
    req.log.error({ err: err.message }, 'delete item: error');
    res.status(500).json(fail('internal_error', 'Could not delete item.'));
  }
});

// ── HTML templates (CUSTOMIZE for the founder's product) ───────────

function landingPage() {
  // CUSTOMIZE: replace hero, subhead, CTA with the founder's product.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Your product</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyles()}</style></head><body><main class="container"><h1>Your product headline goes here</h1><p class="lead">A one-sentence description of what this product does for the user.</p><a class="btn" href="/register">Get started</a></main></body></html>`;
}

function registerPage(error) {
  return formPage('Create account', '/auth/register', error, [
    { name: 'email',    type: 'email',    placeholder: 'you@company.com', required: true, autocomplete: 'email' },
    { name: 'password', type: 'password', placeholder: 'Min. 8 characters', required: true, minlength: 8, autocomplete: 'new-password' },
  ], 'Already have an account? <a href="/login">Sign in</a>');
}

function loginPage(error) {
  return formPage('Sign in', '/auth/login', error, [
    { name: 'email',    type: 'email',    placeholder: 'you@company.com', required: true, autocomplete: 'email' },
    { name: 'password', type: 'password', placeholder: 'Your password',    required: true, autocomplete: 'current-password' },
  ], 'New here? <a href="/register">Create an account</a>');
}

function formPage(title, action, errorHtml, fields, footer) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyles()}</style></head><body><main class="container narrow"><h1>${title}</h1>${errorHtml ? `<div class="error">${errorHtml}</div>` : ''}<form method="POST" action="${action}">${fields.map(f => `<label>${f.name}<input ${Object.entries(f).filter(([k,v]) => v !== undefined && v !== null && v !== false).map(([k,v]) => `${k}="${String(v)}"`).join(' ')} /></label>`).join('')}<button type="submit" class="btn">${title}</button></form><p class="muted">${footer}</p></main></body></html>`;
}

function dashboardPage(email, items) {
  // CUSTOMIZE: replace items list with the feature-specific dashboard.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseStyles()}</style></head><body><main class="container"><nav><span>${email}</span><form method="POST" action="/auth/logout" style="display:inline"><button class="btn-link">Sign out</button></form></nav><h1>Dashboard</h1>${items.length === 0 ? '<p class="muted">No items yet.</p>' : `<ul>${items.map(i => `<li>${escapeHtml(i.title)}</li>`).join('')}</ul>`}</main></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function baseStyles() {
  return `:root{color-scheme:dark}*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0a;color:#f5f5f5;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:2rem}.container{max-width:720px;margin:0 auto}.narrow{max-width:420px}h1{font-size:2rem;font-weight:600;margin-bottom:1rem;letter-spacing:-.02em}.lead{font-size:1.1rem;color:#a3a3a3;margin-bottom:2rem}.muted{color:#a3a3a3;margin-top:1.5rem}.error{background:#3a1a1a;border:1px solid #5a2a2a;padding:1rem;margin-bottom:1rem;border-radius:4px;color:#ffb3b3}label{display:block;margin-bottom:1rem}label input{display:block;width:100%;background:#171717;border:1px solid #333;color:#f5f5f5;padding:.6rem;border-radius:4px;margin-top:.25rem;font:inherit}.btn,button.btn-link{background:#F5A623;color:#000;padding:.6rem 1.2rem;border:0;border-radius:4px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}button.btn-link{background:transparent;color:#F5A623;padding:.4rem 0}nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem;color:#a3a3a3}ul{list-style:none}li{padding:.6rem;border-bottom:1px solid #222}`;
}

// ── Boot ───────────────────────────────────────────────────────────
// Skip the actual listen when running under tests — supertest works directly
// against the `app` object without a real network listener, and starting one
// here would force concurrent test files to fight over PORT and would pin the
// vitest process open after the tests finish.
let server = null;
if (config.NODE_ENV !== 'test') {
  server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'app started');
  });
}

// Graceful shutdown — drain in-flight requests, close pool. No-op under tests.
function shutdown(signal) {
  logger.info({ signal }, 'shutdown initiated');
  if (!server) {
    pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
    return;
  }
  server.close((err) => {
    if (err) logger.error({ err: err.message }, 'server close error');
    pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
if (config.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

module.exports = { app, pool, config, withTimeout, ok, fail, logger };
