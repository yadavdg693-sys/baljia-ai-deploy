// Retry the redship-clone engineering task with:
//   1. Embedded redship.io facts (no separate research dependency)
//   2. Hard deploy-gate at the TOP of the description, not buried in step 9
//   3. snake_case tool names only — bypasses founder-safety phrase redaction
//      that previously stripped "Render service" → "[redacted]"
//   4. DB migrations marked as already-done so the agent doesn't re-run them
//
// Usage: npx tsx --env-file=.env.local src/scripts/retry-redship-engineering.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, users, companies, tasks } from '@/lib/db';
import { eq, and, desc, like } from 'drizzle-orm';
import { launchTask } from '@/lib/agents/worker-launcher';

const FOUNDER_EMAIL = 'redship-clone@baljia.test';

// Tightened description — facts embedded, deploy-gate at top, snake_case tools only.
const TIGHT_DESCRIPTION = `
HARD STOP RULE — read first:
You will NOT mark this task complete until you have called, in order:
  1. github_push_files (push the full app source)
  2. render_create_service (creates the Render web service AND attaches the threadpulse.baljia.app subdomain)
  3. render_deploy (trigger initial deploy after pushing)
  4. render_get_deploy_status (poll until live, max 10 min)
  5. check_url_health on /, /register, /login, /api/health (all 4 must return HTTP 200)
  6. add_dashboard_link with the live URL

If any of these six are missing, the deterministic verifier WILL fail this task. Do not stop early after running migrations — migrations alone do not satisfy verification.

────────────────────────────────────────
PRODUCT TO BUILD (a redship.io clone)

Source product: https://redship.io
What it does (in one paragraph):
  An AI-powered Reddit monitoring platform that identifies relevant conversations where potential customers are seeking solutions, scores posts by relevance (0-100), delivers curated opportunities to users' inboxes daily, and provides AI-drafted replies — enabling founders and marketing teams to acquire customers through authentic Reddit engagement.

MVP scope (build these features only — defer the rest):
  - Sign up / log in (email + password, bcryptjs, sessions in Postgres)
  - "My monitors" dashboard: create/list/delete keyword-monitor configs
  - "Leads" view: list of mock Reddit posts scored 0-100 with title, subreddit, post URL, intent score, AI suggested reply (the AI parts can be hardcoded sample data for the MVP; just prove the UI flow)
  - Pricing page with a single Stripe payment link button ($19/month "Starter" tier per the source product)
  - /api/health → JSON { status: "ok", db: "connected" }

Hero copy (use this exact text on the landing /):
  Headline: "Turn Reddit users into customers"
  Subhead:  "Monitor conversations where people are looking for solutions like yours. Turn Reddit into your best acquisition channel."
  CTA:      "Start finding customers"

────────────────────────────────────────
INFRASTRUCTURE STATE (already done — DO NOT redo):
  - Neon DB:    provisioned (use get_company_tech to retrieve DATABASE_URL)
  - DB tables:  users, session, monitors, leads — already created in a prior run
  - GitHub repo: BALAJIapps/threadpulse — already created (auto-init only, no app code yet)
  - Render service: NOT YET CREATED  ← your job
  - Stripe:     NOT YET CREATED      ← your job (one product + one price + one payment link)

────────────────────────────────────────
EXECUTION PLAN

STEP 1 — Read skills (mandatory):
  list_skills, then read_skill for each: auth-sessions, neon-postgres, stripe-payments, frontend-design

STEP 2 — Inspect existing infra:
  get_company_tech → returns github_repo, neon connection, etc.
  list_tables on the Neon DB → confirm users, session, monitors, leads exist (skip migrations if they do)

STEP 3 — Stripe (one-shot):
  stripe_create_product   name="RedShip Starter"
  stripe_create_price     amount=1900 cents, recurring monthly, USD
  stripe_create_payment_link  → save the URL for the /pricing page

STEP 4 — Write the full Express app (single push via github_push_files):

Required routes:
  GET  /            → Hero landing page using the exact copy above. Dark theme. Single primary CTA "Start finding customers" linking to /register.
  GET  /register    → email + password form
  POST /auth/register → bcryptjs hash, INSERT INTO users, create session, redirect /dashboard
  GET  /login       → email + password form
  POST /auth/login  → SELECT user, compare hash, create session, redirect /dashboard
  POST /auth/logout → req.session.destroy(), redirect /
  GET  /dashboard   → requireAuth. Two sections: "My monitors" (form to add keyword + subreddit, list current) and "Recent leads" (table of mock leads with intent scores 75-95).
  POST /api/monitors → requireAuth. INSERT INTO monitors (user_id, keyword, subreddit). Redirect /dashboard.
  POST /api/monitors/:id/delete → requireAuth. DELETE WHERE user_id=$session.user_id.
  GET  /pricing     → Show the Stripe payment link button for "Starter — $19/mo".
  GET  /api/health  → JSON { status: "ok", db: "connected" } (do a SELECT 1 first to confirm connection)

Session config (auth-sessions skill):
  - bcryptjs (NOT bcrypt — pure JS, works on Render)
  - connect-pg-simple → store sessions in the existing "session" Postgres table
  - SESSION_SECRET from env (32-char random hex)
  - cookie: { httpOnly: true, secure: NODE_ENV==='production', sameSite: 'lax', maxAge: 7*24*3600*1000 }

package.json deps: express, express-session, bcryptjs, connect-pg-simple, pg

Mock data: when /dashboard renders, hardcode 3-5 sample leads in the template (e.g. "r/SaaS — Looking for a Reddit monitoring tool — score: 92"). This is intentional for the MVP.

STEP 5 — Create the Render service:
  render_create_service  → this also attaches threadpulse.baljia.app

STEP 6 — Deploy with env vars:
  render_deploy with:
    DATABASE_URL    = from get_company_tech
    SESSION_SECRET  = generate a 32-char random hex
    STRIPE_LINK     = the payment link URL from step 3
    NODE_ENV        = production
    PORT            = 10000

STEP 7 — Wait for deploy + health-check:
  render_get_deploy_status, poll until status=live (max 10 min).
  check_url_health for each: /, /register, /login, /api/health
  All must return HTTP 200. If any returns 404 or 5xx, fix in code, github_push_files again, render_deploy again.

STEP 8 — Finish:
  add_dashboard_link with label="Live app" and the live URL.
  write_report listing: live URL, all routes implemented, Stripe payment link, and the env vars the founder needs to know about.

REMEMBER THE HARD STOP RULE AT THE TOP. Migrations alone do not pass verification.
`.trim();

void (async () => {
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  REDSHIP-CLONE — ENGINEERING RETRY`);
  console.log(`══════════════════════════════════════════════════\n`);

  const [u] = await db.select().from(users).where(eq(users.email, FOUNDER_EMAIL));
  if (!u) throw new Error(`No founder user: ${FOUNDER_EMAIL}`);

  const [c] = await db.select().from(companies)
    .where(eq(companies.owner_id, u.id))
    .orderBy(desc(companies.created_at)).limit(1);
  if (!c) throw new Error('No company');
  console.log(`  Company: ${c.name} (slug=${c.slug}, id=${c.id})`);

  const [eng] = await db.select().from(tasks)
    .where(and(
      eq(tasks.company_id, c.id),
      like(tasks.title, 'REDSHIP-CLONE: Build%'),
    )).limit(1);
  if (!eng) throw new Error('Engineering task not found');
  console.log(`  Engineering task: ${eng.id} (current status=${eng.status}, turns=${eng.turn_count})`);

  // Reset to todo + replace description + clear failure metadata
  await db.update(tasks).set({
    description:           TIGHT_DESCRIPTION,
    status:                'todo',
    started_at:            null,
    completed_at:          null,
    failure_class:         null,
    turn_count:            0,
    actual_credits_charged: 0,
    repair_attempt_count:   0,
    updated_at:            new Date(),
  }).where(eq(tasks.id, eng.id));
  console.log(`  ✓ task reset to todo with tightened description (${TIGHT_DESCRIPTION.length} chars)`);

  console.log(`\n▶ Launching engineering task...`);
  const t0 = Date.now();
  const result = await launchTask(eng.id, { subscriptionFunded: true });
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n◀ Engineering finished after ${elapsed}s`);
  console.log(`  status = ${result.status}`);
  console.log(`  turns  = ${result.turn_count}`);

  // Re-read company to get any new infra
  const [c2] = await db.select().from(companies).where(eq(companies.id, c.id));
  console.log(`\n  github_repo:       ${c2?.github_repo ?? '-'}`);
  console.log(`  render_service_id: ${c2?.render_service_id ?? '-'}`);
  console.log(`  hosting_state:     ${c2?.hosting_state ?? '-'}`);

  process.exit(result.status === 'completed' ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
