// scripts/build-fullstack-app.ts
// Directly inserts a full-stack SaaS engineering task into the DB with
// execution_mode='full_agent' and verification_level='deterministic',
// then launches it via the worker. Bypasses the CEO governance LLM so
// the agent is forced into a full build run (not a 2-turn summary).
//
// Usage:  npx tsx --env-file=.env.local src/scripts/build-fullstack-app.ts
// Watch:  tail the console — the agent will print every LLM turn.

import { db, companies } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import { launchTask } from '@/lib/agents/worker-launcher';
import * as creditService from '@/lib/services/credit.service';
import * as taskService from '@/lib/services/task.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('BuildFullStack');

// ── Task definition ───────────────────────────────────────────────────────
const TASK_TITLE = 'Build book generation SaaS — full stack (auth + DB + Stripe)';

const TASK_DESCRIPTION = `
The company GitHub repo and hosting service already exist from a prior deployment.
REPLACE the entire app with a new full-stack SaaS. Do not keep any Hello World code.

Follow this build order exactly:

STEP 1 — Read skills first (mandatory):
  Call list_skills. Then call read_skill for each: auth-sessions, neon-postgres, stripe-payments, agent-sdk, frontend-design.

STEP 2 — Check existing infrastructure:
  Call get_company_tech to retrieve the GitHub repo slug and hosting service ID.

STEP 3 — Provision the database:
  Call provision_database to get the Postgres connection string (DATABASE_URL).

STEP 4 — Run DB migrations (call run_migration for each statement):
  CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    plan text NOT NULL DEFAULT 'free',
    books_generated int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS "session" (
    sid varchar NOT NULL COLLATE "default",
    sess json NOT NULL,
    expire timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY (sid)
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" (expire);
  CREATE TABLE IF NOT EXISTS books (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    title text NOT NULL,
    genre text NOT NULL,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

STEP 5 — Create Stripe product:
  Call stripe_create_product (name: "Book Generation Pro"), stripe_create_price ($9/month recurring), stripe_create_payment_link.
  Save the payment link URL — you will need it for the /pricing page.

STEP 6 — Write the full app and push to GitHub via github_push_files:
  Write a Node.js Express app with these routes:
  GET  /              → Landing page with links to /register and /login
  GET  /register      → HTML form: email + password fields
  POST /auth/register → Hash password with bcryptjs, INSERT into users, create session, redirect to /dashboard
  GET  /login         → HTML form: email + password fields
  POST /auth/login    → SELECT user, compare hash, create session, redirect to /dashboard
  POST /auth/logout   → req.session.destroy(), redirect to /
  GET  /dashboard     → requireAuth middleware. Show book generation form (title input + genre select).
  POST /api/generate  → requireAuth middleware. Call Anthropic API (process.env.ANTHROPIC_API_KEY).
                        Generate a 3-chapter book outline. Save result in books table. Return JSON.
  GET  /pricing       → Show the Stripe payment link button for Pro plan.
  GET  /api/health    → Return JSON: { status: "ok", db: "connected" }

  Session setup rules (from auth-sessions skill):
  - Use bcryptjs (NOT bcrypt — bcryptjs is pure JS and works on Render)
  - Use connect-pg-simple to store sessions in Postgres so they survive restarts
  - SESSION_SECRET from process.env.SESSION_SECRET
  - cookie: { httpOnly: true, secure: NODE_ENV=production, sameSite: lax, maxAge: 7 days }

  package.json must include these dependencies:
  express, express-session, bcryptjs, connect-pg-simple, pg

STEP 7 — Deploy to the hosting service:
  Call render_deploy with env vars:
    DATABASE_URL      = connection string from provision_database
    SESSION_SECRET    = generate a random 32-char hex string
    ANTHROPIC_API_KEY = sk-placeholder (tell founder to replace this)
    NODE_ENV          = production
    PORT              = 10000

STEP 8 — Verify the deployment:
  Call render_get_deploy_status and wait for it to show live.
  Call check_url_health on each of these paths (call it 4 times, once per path):
    /
    /register
    /login
    /api/health
  All 4 must return HTTP 200. If any return 404, the route is missing — fix and redeploy.

STEP 9 — Finish:
  Call add_dashboard_link with the live URL.
  Write a report listing: live URL, all routes, DB tables, Stripe payment link URL, env vars the founder must configure.

You are NOT done until render_deploy was called AND all 4 check_url_health calls return 200.
`.trim();


// ── Main ──────────────────────────────────────────────────────────────────
void (async () => {
  // Pick the most-recently-active completed company
  const [co] = await db
    .select({ id: companies.id, name: companies.name, slug: companies.slug, owner_id: companies.owner_id })
    .from(companies)
    .where(eq(companies.onboarding_status, 'completed'))
    .orderBy(desc(companies.updated_at))
    .limit(1);

  if (!co) throw new Error('No completed company found in DB');
  log.info('Target company', { id: co.id, name: co.name, slug: co.slug });

  // Ensure 100 credits (no daily cap anyway, but belt-and-suspenders)
  await creditService.addCredit(
    co.id, 100, 'addon_purchase',
    'Build full-stack SaaS pre-flight credit reset',
    undefined,
    `build-saas:${co.id}:${Date.now()}`,
  );
  log.info('Credits topped up to 100');

  // Insert via createTask service — handles all type coercions correctly.
  // We force execution_mode + verification_level so the worker cannot
  // downgrade to a lightweight / planning-only run.
  const task = await taskService.createTask({
    company_id:           co.id,
    title:                TASK_TITLE,
    description:          TASK_DESCRIPTION,
    tag:                  'engineering',
    assigned_to_agent_id: 30,           // Engineering agent
    status:               'todo',
    priority:             90,           // High priority (numeric, 0-100)
    execution_mode:       'full_agent', // Force full agentic execution
    verification_level:   'deterministic', // Require render_deploy + check_url_health
    complexity:           9,            // High complexity (numeric, 1-10)
    source:               'founder_requested',
  });

  log.info('Task inserted', { taskId: task.id, title: TASK_TITLE });
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Task ID:     ${task.id}`);
  console.log(`  Company:     ${co.name} [${co.slug}]`);
  console.log(`  Mode:        full_agent (forced)`);
  console.log(`  Verifier:    deterministic (deploy + health check required)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Launching Engineering Agent...\n');

  // Launch — subscriptionFunded:true bypasses any remaining spend cap logic
  const execution = await launchTask(task.id, { subscriptionFunded: true });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Status:      ${execution.status}`);
  console.log(`  Turns used:  ${execution.turn_count}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(execution.status === 'completed' ? 0 : 1);
})();
