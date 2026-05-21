// End-to-end Redship.io clone test harness.
//
// Creates a fresh founder + company via the build_my_idea journey, grants
// effectively unlimited credits, then queues two CEO-driven tasks:
//   1) Research agent  → analyze how redship.io works
//   2) Engineering agent → build a similar full-stack app and deploy to Render
//
// Both tasks are created in 'todo' status so the founder (or this script with
// --launch) can approve them in-app. With --launch, this script launches the
// research task synchronously, then the engineering task — they share the
// company's single execution slot, so they serialize naturally.
//
// Usage:
//   # Setup only (safe — no external resource creation):
//   npx tsx --env-file=.env.local src/scripts/setup-redship-clone.ts
//
//   # Setup + launch both tasks (real Render service + GitHub repo + LLM cost):
//   npx tsx --env-file=.env.local src/scripts/setup-redship-clone.ts --launch
//
//   # Reset and re-run from scratch:
//   npx tsx --env-file=.env.local src/scripts/setup-redship-clone.ts --reset

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import {
  db,
  users,
  companies,
  tasks,
  taskExecutions,
  taskFailureLinks,
  approvalRecords,
  artifacts,
  runs,
  sessions,
  documents,
  documentSuggestions,
  reports,
  memoryLayers,
  learnings,
  subscriptions,
  creditLedger,
  revenueLedger,
  adCampaigns,
  adSpendLedger,
  refundHistory,
  recurringTasks,
  nightShiftCycles,
  emailThreads,
  contacts,
  browserCredentials,
  chatSessions,
  platformEvents,
  dashboardLinks,
  platformFeedback,
  tweets,
  roadmaps,
  runtimeAiCosts,
} from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import * as companyService from '@/lib/services/company.service';
import * as creditService from '@/lib/services/credit.service';
import * as taskService from '@/lib/services/task.service';
import { runOnboardingPipeline } from '@/lib/services/onboarding/orchestrator';
import { launchTask } from '@/lib/agents/worker-launcher';

// ── Configuration ─────────────────────────────────────────────────────────
const FOUNDER_EMAIL    = 'redship-clone@baljia.test';
const IDEA_INPUT       = 'I want to build something like https://redship.io/';
const REQUEST_IP       = '103.99.0.1';
const TIMEZONE         = 'Asia/Kolkata';
const CREDIT_GRANT     = 10_000;          // Effectively unlimited for testing
const SUBSCRIPTION_PLAN: 'scale' = 'scale'; // Max plan tier — bypasses any plan-gated limits

// Task constants
const TASK_MARKER       = 'REDSHIP-CLONE';
const RESEARCH_TITLE    = `${TASK_MARKER}: Research how redship.io works (features, value prop, monetization)`;
const ENGINEERING_TITLE = `${TASK_MARKER}: Build and deploy a Redship.io-style full-stack app on Render`;

// Argument parsing
const args = new Set(process.argv.slice(2));
const SHOULD_LAUNCH = args.has('--launch');
const FORCE_RESET   = args.has('--reset');

// ── Task descriptions ─────────────────────────────────────────────────────
const RESEARCH_DESCRIPTION = `
Goal: produce an actionable research report on https://redship.io/ that the
Engineering agent can use as a build spec. Be specific — vague research forces
a vague build.

STEP 1 — Fetch and read the home page:
  Use web search and the http_fetch / browse tools to read https://redship.io/.
  Capture: hero copy, value prop, primary CTA, screenshots/feature shots.

STEP 2 — Map the product surface:
  - List every product feature mentioned on the site (with one-line description each).
  - Identify the core user job-to-be-done in one sentence.
  - Identify pricing tiers, monetization model, free-vs-paid split.
  - Identify the target user segment.

STEP 3 — Infer the technical shape (best-effort, no scraping behind auth):
  - What kind of app is it? (web app, dashboard, marketplace, integration tool, etc.)
  - What entities/objects does it manage? (e.g. ships, routes, customers, orders)
  - What integrations does it expose? (APIs, webhooks, third-party logins)

STEP 4 — Competitive scan (3 alternatives max):
  Search for "redship.io alternatives" and pick the top 2-3. One bullet each
  on what they do differently.

STEP 5 — Write the research report:
  Save a structured report (using your report-writing tool) with these sections:
    1. What it is (1 paragraph)
    2. Core features (bullet list with descriptions)
    3. Pricing & monetization
    4. Target user
    5. Technical shape (entities, integrations, app type)
    6. 3 competitor takeaways
    7. Recommended MVP scope for our clone — list 5-8 features that capture
       80% of the value with minimal build effort.
    8. Source URLs (cite every claim)

Do NOT propose tasks or take build actions. Read-only research only. The
Engineering agent will read this report as input for the build task.
`.trim();

const ENGINEERING_DESCRIPTION = `
Goal: Build and deploy a working full-stack web app modeled on the previous
Research agent's report on https://redship.io/. The deployed URL should
return HTTP 200 with real, themed HTML — not a placeholder.

PRE-FLIGHT — read prior research:
  Look at recent reports for this company (the prior task tagged 'research'
  produced a redship.io research report). Use the "Recommended MVP scope"
  section as your build spec. If no report is available, fall back to a
  minimum sensible scope based on the product name.

STEP 1 — Read skills first (mandatory):
  Call list_skills. Then call read_skill for each: auth-sessions,
  neon-postgres, stripe-payments, frontend-design, render-infra.

STEP 2 — Check existing infrastructure:
  Call get_company_tech to see if a GitHub repo / Render service already
  exists for this company. Reuse if present, create if not.

STEP 3 — Provision the database:
  Call provision_database to get DATABASE_URL.

STEP 4 — Run DB migrations (call run_migration per statement). Schema must
  fit the product the research recommended. At minimum:
  CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    plan text NOT NULL DEFAULT 'free',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS "session" (
    sid varchar NOT NULL COLLATE "default",
    sess json NOT NULL,
    expire timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY (sid)
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" (expire);
  Then add 1-2 product-specific tables based on the research findings
  (e.g. if it's a shipping tool: shipments, routes; if it's a workflow tool:
  workflows, runs).

STEP 5 — Stripe (if monetization is planned):
  Call stripe_create_product, stripe_create_price (monthly $9), stripe_create_payment_link.
  Save the URL for the /pricing page. Skip if research said no paid tier.

STEP 6 — Write the full app and push via github_push_files:
  Node.js Express app with at minimum:
    GET  /              → Themed landing page (hero + features + CTA, NOT lorem ipsum)
    GET  /register      → email + password form
    POST /auth/register → bcryptjs hash, INSERT user, create session, redirect /dashboard
    GET  /login         → email + password form
    POST /auth/login    → verify, create session, redirect /dashboard
    POST /auth/logout   → session.destroy(), redirect /
    GET  /dashboard     → requireAuth, show product-specific UI
    GET  /pricing       → Stripe payment link button (if applicable)
    GET  /api/health    → JSON { status: "ok", db: "connected" }
  Plus 1-2 product-specific routes from the research recommendations.

  Session rules (from auth-sessions skill):
    - bcryptjs (NOT bcrypt — pure JS, works on Render)
    - connect-pg-simple for Postgres-backed sessions
    - SESSION_SECRET from env, cookie httpOnly + secure-in-prod + sameSite lax
  package.json deps: express, express-session, bcryptjs, connect-pg-simple, pg

  Theming: read the company's brand record + landing page if present, mirror
  the colors/font. Otherwise pick a clean dark theme. Hero copy must reflect
  the actual product (from research), NOT generic Hello World.

STEP 7 — Deploy to Render with env vars:
    DATABASE_URL      = from provision_database
    SESSION_SECRET    = random 32-char hex
    NODE_ENV          = production
    PORT              = 10000
  The render_create_service tool will attach the company's baljia.app
  subdomain automatically. The deployed app should be reachable at
  <slug>.baljia.app (and also via the Render-assigned URL).

STEP 8 — Verify the deployment:
  Call render_get_deploy_status until live (poll every 30s, max 10 min).
  Call check_url_health on each:
    /
    /register
    /login
    /api/health
  All must return 200. If any returns 404 or 5xx, fix and redeploy.

STEP 9 — Finish:
  Call add_dashboard_link with the live URL (label: "Live app").
  Write a report listing: live URL, all routes implemented, DB tables, Stripe
  link if any, env vars the founder needs to know about.

You are NOT done until render_deploy was called AND all 4 health checks pass.
`.trim();

// ── Helpers ──────────────────────────────────────────────────────────────
async function ensureUser(email: string): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(users).values({ email, auth_provider: 'magic_link' }).returning({ id: users.id });
  return created.id;
}

// FK-safe wipe of prior test companies for this founder. Mirrors
// e2e-onboarding.ts wipeTestCompanies layer order.
async function wipePriorCompanies(userId: string): Promise<number> {
  const cos = await db.select({ id: companies.id }).from(companies).where(eq(companies.owner_id, userId));
  if (cos.length === 0) return 0;
  const companyIds = cos.map((c) => c.id);
  const taskRows = await db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.company_id, companyIds));
  const taskIds = taskRows.map((t) => t.id);

  if (taskIds.length > 0) {
    await db.delete(artifacts).where(inArray(artifacts.task_id, taskIds));
    await db.delete(runs).where(inArray(runs.task_id, taskIds));
    await db.delete(taskExecutions).where(inArray(taskExecutions.task_id, taskIds));
    await db.delete(taskFailureLinks).where(inArray(taskFailureLinks.task_id, taskIds));
    await db.delete(approvalRecords).where(inArray(approvalRecords.task_id, taskIds));
  }
  await db.delete(sessions).where(inArray(sessions.company_id, companyIds));
  await db.delete(reports).where(inArray(reports.company_id, companyIds));
  await db.delete(tweets).where(inArray(tweets.company_id, companyIds));
  await db.delete(runtimeAiCosts).where(inArray(runtimeAiCosts.company_id, companyIds));
  await db.delete(creditLedger).where(inArray(creditLedger.company_id, companyIds));
  await db.delete(documentSuggestions).where(inArray(documentSuggestions.company_id, companyIds));
  await db.delete(learnings).where(inArray(learnings.company_id, companyIds));
  await db.delete(refundHistory).where(inArray(refundHistory.company_id, companyIds));
  await db.delete(tasks).where(inArray(tasks.company_id, companyIds));
  await db.delete(documents).where(inArray(documents.company_id, companyIds));
  await db.delete(memoryLayers).where(inArray(memoryLayers.company_id, companyIds));
  await db.delete(revenueLedger).where(inArray(revenueLedger.company_id, companyIds));
  await db.delete(adSpendLedger).where(inArray(adSpendLedger.company_id, companyIds));
  await db.delete(adCampaigns).where(inArray(adCampaigns.company_id, companyIds));
  await db.delete(recurringTasks).where(inArray(recurringTasks.company_id, companyIds));
  await db.delete(nightShiftCycles).where(inArray(nightShiftCycles.company_id, companyIds));
  await db.delete(emailThreads).where(inArray(emailThreads.company_id, companyIds));
  await db.delete(contacts).where(inArray(contacts.company_id, companyIds));
  await db.delete(browserCredentials).where(inArray(browserCredentials.company_id, companyIds));
  await db.delete(chatSessions).where(inArray(chatSessions.company_id, companyIds));
  await db.delete(platformEvents).where(inArray(platformEvents.company_id, companyIds));
  await db.delete(dashboardLinks).where(inArray(dashboardLinks.company_id, companyIds));
  await db.delete(platformFeedback).where(inArray(platformFeedback.company_id, companyIds));
  await db.delete(subscriptions).where(inArray(subscriptions.company_id, companyIds));
  await db.delete(roadmaps).where(inArray(roadmaps.company_id, companyIds));

  for (const id of companyIds) {
    await db.delete(companies).where(eq(companies.id, id));
  }
  return cos.length;
}

async function upgradeSubscriptionToScale(companyId: string): Promise<void> {
  const updated = await db.update(subscriptions)
    .set({ plan_type: SUBSCRIPTION_PLAN, status: 'active' })
    .where(eq(subscriptions.company_id, companyId))
    .returning({ id: subscriptions.id, plan: subscriptions.plan_type, status: subscriptions.status });
  if (updated.length === 0) {
    console.warn('  ⚠ No subscription row to upgrade — createCompany should have created one');
    return;
  }
  for (const u of updated) {
    console.log(`  ✓ subscription ${u.id.slice(0, 8)}… → plan=${u.plan} status=${u.status}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  REDSHIP.IO CLONE — END-TO-END SETUP`);
  console.log(`══════════════════════════════════════════════════`);
  console.log(`  founder:   ${FOUNDER_EMAIL}`);
  console.log(`  idea:      ${IDEA_INPUT}`);
  console.log(`  journey:   build_my_idea`);
  console.log(`  launch:    ${SHOULD_LAUNCH ? 'YES (will run agents)' : 'NO (tasks queued in todo)'}`);
  console.log(``);

  // ── 1. Founder ──────────────────────────────────────────────────────
  const userId = await ensureUser(FOUNDER_EMAIL);
  console.log(`  ✓ founder upserted (id=${userId.slice(0, 8)}…)`);

  // ── 2. Wipe prior companies (always, since this is a test harness) ──
  const wiped = await wipePriorCompanies(userId);
  if (wiped > 0) console.log(`  ✓ wiped ${wiped} prior test companies`);

  // ── 3. Create placeholder company ───────────────────────────────────
  const company = await companyService.createCompany({
    owner_id: userId,
    name: 'My Company',
    original_idea: IDEA_INPUT,
  });
  console.log(`  ✓ placeholder company created (id=${company.id.slice(0, 8)}…)`);

  // ── 4. Grant a giant credit balance + upgrade plan ──────────────────
  await creditService.addCredit(
    company.id,
    CREDIT_GRANT,
    'addon_purchase',
    `Test harness — ${CREDIT_GRANT} credits for redship-clone build`,
    undefined,
    `redship:${company.id}:${Date.now()}`,
  );
  console.log(`  ✓ granted ${CREDIT_GRANT} credits`);
  await upgradeSubscriptionToScale(company.id);

  // ── 5. Run onboarding pipeline ──────────────────────────────────────
  console.log(`\n  Running build_my_idea onboarding pipeline... (30–120s)`);
  const t0 = Date.now();
  try {
    await runOnboardingPipeline(
      company.id,
      userId,
      'build_my_idea',
      IDEA_INPUT,
      REQUEST_IP,
      TIMEZONE,
      'en-US',
      'redship-clone-script',
    );
  } catch (e) {
    console.warn(`  ⚠ pipeline threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`  ✓ pipeline returned after ${elapsed}s`);

  // ── 6. Re-read company to capture generated name + slug ─────────────
  const [c] = await db.select().from(companies).where(eq(companies.id, company.id)).limit(1);
  if (!c) throw new Error('Company vanished after onboarding');
  console.log(``);
  console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Company:        ${c.name}`);
  console.log(`  Slug:           ${c.slug}`);
  console.log(`  Subdomain:      ${c.subdomain ?? '(not yet provisioned)'}`);
  console.log(`  Onboarding:     ${c.onboarding_status}`);
  console.log(`  One-liner:      ${c.one_liner ?? '-'}`);
  console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // ── 7. Re-grant credits AFTER onboarding so any auto-deductions during
  //      the pipeline are restored. (Onboarding can spend a few credits on
  //      starter task credit estimates / etc.)
  await creditService.addCredit(
    c.id,
    CREDIT_GRANT,
    'addon_purchase',
    `Post-onboarding top-up — keep balance unlimited for build`,
    undefined,
    `redship-postonb:${c.id}:${Date.now()}`,
  );
  const balance = await creditService.getBalance(c.id);
  console.log(`  ✓ post-onboarding credit balance: ${balance}`);

  // ── 8. Create the two CEO-driven tasks ──────────────────────────────
  console.log(``);
  console.log(`  Creating tasks...`);
  const researchTask = await taskService.createTask({
    company_id:           c.id,
    title:                RESEARCH_TITLE,
    description:          RESEARCH_DESCRIPTION,
    tag:                  'research',
    assigned_to_agent_id: 29,
    status:               'todo',
    priority:             95,
    execution_mode:       'full_agent',
    verification_level:   'quality_review',
    complexity:           6,
    source:               'founder_requested',
  });
  console.log(`  ✓ research task   id=${researchTask.id.slice(0, 8)}…`);

  const engineeringTask = await taskService.createTask({
    company_id:           c.id,
    title:                ENGINEERING_TITLE,
    description:          ENGINEERING_DESCRIPTION,
    tag:                  'engineering',
    assigned_to_agent_id: 30,
    status:               'todo',
    priority:             90,
    execution_mode:       'full_agent',
    verification_level:   'deterministic',
    complexity:           9,
    source:               'founder_requested',
    related_task_ids:     [researchTask.id],
  });
  console.log(`  ✓ engineering task id=${engineeringTask.id.slice(0, 8)}…`);

  // ── 9. Optionally launch ────────────────────────────────────────────
  if (SHOULD_LAUNCH) {
    console.log(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  LAUNCHING — this will use real LLM tokens, GitHub API,`);
    console.log(`  Render API, and ~10-25 minutes of wall time.`);
    console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    console.log(`  → Launching research task...`);
    const r = await launchTask(researchTask.id, { subscriptionFunded: true });
    console.log(`  ← research finished: status=${r.status} turns=${r.turn_count}`);

    if (r.status !== 'completed') {
      console.warn(`  ⚠ research did not complete; engineering will run anyway.`);
    }

    console.log(`\n  → Launching engineering task...`);
    const e = await launchTask(engineeringTask.id, { subscriptionFunded: true });
    console.log(`  ← engineering finished: status=${e.status} turns=${e.turn_count}`);

    process.exit(e.status === 'completed' ? 0 : 1);
  }

  // ── 10. Print next-step instructions ────────────────────────────────
  console.log(``);
  console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  NEXT STEPS`);
  console.log(`  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Dashboard:      http://localhost:3000/dashboard/${c.id}`);
  console.log(`  Landing page:   https://${c.subdomain ?? c.slug}.baljia.app`);
  console.log(``);
  console.log(`  To run the full build pipeline (research → engineering → deploy):`);
  console.log(`    npx tsx --env-file=.env.local src/scripts/setup-redship-clone.ts --launch`);
  console.log(``);
  console.log(`  Or approve the tasks individually from the dashboard.`);
  console.log(``);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
