# Skill: Auth (login, register, sessions) for founder apps

**READ THIS BEFORE building any login, register, logout, protected route, or user account feature.**

Founder apps run on Render with Neon Postgres. Use session-based auth by default — it works on any Node.js/Express app without an external service and costs nothing. Only switch to a third-party provider (Clerk, Auth0) if the task explicitly requires OAuth or social login.

---

## Architecture decision

| Pattern | Use when | Notes |
|---|---|---|
| **Session + bcrypt** (this skill) | SaaS MVP, internal tools, book/content apps | Simple, free, works on Render free tier |
| **Clerk** | Google/GitHub OAuth required, or no-code setup preferred | Needs Clerk account + env vars |
| **JWT (stateless)** | Mobile API, microservices | More complex; not needed for Render SSR apps |

**Default: session + bcrypt.** Use this unless the task says otherwise.

---

## Required npm packages

```json
{
  "express-session": "^1.18.0",
  "bcryptjs": "^2.4.3",
  "connect-pg-simple": "^9.0.1"
}
```

- `express-session` — stores session ID in a cookie, session data on server
- `bcryptjs` — hashes passwords (pure JS, no native build, works on Render)
- `connect-pg-simple` — stores sessions in Postgres so they survive Render restarts

**Do NOT use `bcrypt` (native binding).** Use `bcryptjs` — it works on Render without native build tools.

---

## Database schema

Run these migrations via `run_migration` BEFORE writing app code:

```sql
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  plan        text NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Sessions table (connect-pg-simple requires this exact shape)
CREATE TABLE IF NOT EXISTS "session" (
  sid    varchar NOT NULL COLLATE "default",
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" (expire);
```

---

## Express app setup

```js
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const app = express();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PgSession = connectPgSimple(session);

// ── Sessions ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false, // we create it in migration
  }),
  secret: process.env.SESSION_SECRET,   // REQUIRED env var — see below
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,   // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));
```

---

## Auth routes

```js
// ── Register ──────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and password (min 8 chars) required.' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, plan',
      [email.toLowerCase().trim(), hash]
    );
    req.session.userId = rows[0].id;
    req.session.email  = rows[0].email;
    req.session.plan   = rows[0].plan;
    res.json({ ok: true, user: { id: rows[0].id, email: rows[0].email, plan: rows[0].plan } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered.' });
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── Login ─────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  try {
    const { rows } = await pool.query(
      'SELECT id, email, password_hash, plan FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials.' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });
    req.session.userId = rows[0].id;
    req.session.email  = rows[0].email;
    req.session.plan   = rows[0].plan;
    res.json({ ok: true, user: { id: rows[0].id, email: rows[0].email, plan: rows[0].plan } });
  } catch {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── Logout ────────────────────────────────────────────────
app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── Current user ──────────────────────────────────────────
app.get('/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.session.userId, email: req.session.email, plan: req.session.plan });
});
```

---

## Auth middleware

```js
// Protect any route by adding requireAuth as middleware
function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    // API request
    if (req.headers['content-type']?.includes('application/json')) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    // Browser request — redirect to login page
    return res.redirect('/login');
  }
  next();
}

// Protect paid features
function requirePaidPlan(req, res, next) {
  if (req.session?.plan === 'free') {
    return res.status(403).json({ error: 'Upgrade required.', upgrade_url: '/pricing' });
  }
  next();
}

// Usage:
app.get('/dashboard', requireAuth, (req, res) => { /* ... */ });
app.post('/api/generate', requireAuth, requirePaidPlan, (req, res) => { /* ... */ });
```

---

## Render env vars required

Set these in `render_create_service` or `render_deploy` env_vars:

```
DATABASE_URL          → from provision_database (already set if DB provisioned)
SESSION_SECRET        → generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NODE_ENV              → production
```

Generate `SESSION_SECRET` once and store it. If it changes, all sessions invalidate.

---

## HTML login/register pages (server-rendered)

```html
<!-- /login page -->
<form action="/auth/login" method="POST">
  <label>Email <input type="email" name="email" required /></label>
  <label>Password <input type="password" name="password" required minlength="8" /></label>
  <button type="submit" class="primary-action">Sign in</button>
  <p>No account? <a href="/register">Register</a></p>
</form>

<!-- /register page -->
<form action="/auth/register" method="POST">
  <label>Email <input type="email" name="email" required /></label>
  <label>Password <input type="password" name="password" required minlength="8" /></label>
  <button type="submit" class="primary-action">Create account</button>
  <p>Already have one? <a href="/login">Sign in</a></p>
</form>
```

---

## Connecting auth to Stripe payments

After login, use `req.session.userId` to tie a Stripe customer to a user:

```js
// On successful Stripe checkout webhook — mark user as paid
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  if (event.type === 'checkout.session.completed') {
    const userId = event.data.object.metadata.user_id; // pass at checkout creation
    await pool.query('UPDATE users SET plan = $1 WHERE id = $2', ['paid', userId]);
  }
  res.json({ received: true });
});

// When creating a Checkout Session, pass the user ID in metadata
app.post('/checkout', requireAuth, async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    metadata: { user_id: req.session.userId },  // ← critical for webhook linkage
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.APP_URL}/dashboard?upgraded=1`,
    cancel_url:  `${process.env.APP_URL}/pricing`,
  });
  res.redirect(303, session.url);
});
```

---

## Common pitfalls

- **`bcrypt` (native) fails on Render** — always use `bcryptjs`.
- **Sessions lost on restart** — use `connect-pg-simple`. Without it, sessions live in memory and die on every deploy.
- **`secure: true` cookie on HTTP** — only set `secure: true` when `NODE_ENV=production`. Render always uses HTTPS in prod.
- **Missing `SESSION_SECRET`** — app will crash or sessions won't persist. Always set this env var.
- **`sameSite: 'none'` needed for cross-origin** — use `lax` for same-domain SaaS apps.
- **Don't store sensitive data in session** — only `userId`, `email`, `plan`. Fetch fresh user data from DB for anything critical.

---

## Verification checklist

Auth is done when ALL of these pass:

1. `POST /auth/register` with a test email returns `{ ok: true }`.
2. `POST /auth/login` with correct credentials returns `{ ok: true }`.
3. `POST /auth/login` with wrong password returns `401`.
4. `GET /dashboard` (protected route) without a session returns `302 → /login`.
5. `GET /dashboard` after login returns `200`.
6. `POST /auth/logout` clears the session — subsequent `/dashboard` returns `302`.
7. After Render restart (or redeploy), existing sessions survive (proves Postgres session store works).
8. The task report lists: `SESSION_SECRET` env var status, session table migration status, test user email used.
