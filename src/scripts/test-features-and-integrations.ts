// Demonstrate the layered feature/integration verifier on live threadpulse:
//
//   1. Walk full auth journey → verify_user_journey   (HTTP-level)
//   2. Confirm the new user row landed → verify_db_state  (DB-level)
//   3. Confirm Stripe payment link is reachable from /pricing → external URL probe
//
// All three layers in one script — pattern the engineering agent will follow
// after every deploy.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, tasks } from '@/lib/db';
import { like } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';

void (async () => {
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  if (!t) throw new Error('no task');

  const email = `feat-${Date.now()}@baljia.test`;
  const password = 'TestPassword123!';
  const baseUrl = 'https://threadpulse.baljia.app';

  // ── LAYER 1: feature flow via HTTP ───────────────────────────────────
  console.log('═══════════════════════════════════════');
  console.log(' LAYER 1 — verify_user_journey (HTTP)');
  console.log('═══════════════════════════════════════');
  const journey = {
    journey_name: 'register, sign in, view dashboard, view pricing',
    base_url: baseUrl,
    steps: [
      { step: 'landing',          path: '/', expect_status: 200,
        expect_body_contains: 'Turn Reddit users into customers' },
      { step: 'submit register',  method: 'POST', path: '/auth/register',
        body: { email, password }, body_type: 'form' as const,
        expect_status: 302, expect_redirect: '/dashboard',
        expect_body_not_contains: 'Registration failed' },
      { step: 'dashboard reachable', path: '/dashboard',
        expect_status: 200, expect_body_not_contains: 'Sign in' },
      { step: 'pricing page renders Stripe link', path: '/pricing',
        expect_status: 200, expect_body_contains: 'buy.stripe.com' },
    ],
  };
  const journeyResult = await handleEngineeringTool('verify_user_journey', journey, t as never);
  console.log(journeyResult);
  const journeyPassed = typeof journeyResult === 'string' && journeyResult.startsWith('JOURNEY PASS');

  // ── LAYER 2: DB state assertion ──────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(' LAYER 2 — verify_db_state (founder DB)');
  console.log('═══════════════════════════════════════');
  const dbCheck = await handleEngineeringTool('verify_db_state', {
    label: 'user row landed in users table after register',
    sql: `SELECT email, plan FROM users WHERE email = '${email.replace(/'/g, "''")}'`,
    expect_min_rows: 1,
    expect_max_rows: 1,
    expect_first_row_contains: { email: email.toLowerCase().trim(), plan: 'free' },
  }, t as never);
  console.log(dbCheck);
  const dbPassed = typeof dbCheck === 'string' && dbCheck.startsWith('DB STATE PASS');

  // ── LAYER 3: external integration probe ──────────────────────────────
  // Find the Stripe link in /pricing then probe it.
  console.log('\n═══════════════════════════════════════');
  console.log(' LAYER 3 — external integration (Stripe)');
  console.log('═══════════════════════════════════════');
  const pricingResp = await fetch(`${baseUrl}/pricing`, { signal: AbortSignal.timeout(15_000) });
  const pricingHtml = await pricingResp.text();
  const stripeLinkMatch = pricingHtml.match(/https:\/\/buy\.stripe\.com\/[A-Za-z0-9_]+/);
  let stripePassed = false;
  if (!stripeLinkMatch) {
    console.log('STRIPE FAIL: no buy.stripe.com link found on /pricing page');
  } else {
    const stripeUrl = stripeLinkMatch[0];
    console.log(`Found Stripe link: ${stripeUrl}`);
    const stripeProbe = await handleEngineeringTool('verify_user_journey', {
      journey_name: 'Stripe payment link reachable',
      base_url: stripeUrl,
      steps: [
        { step: 'Stripe link returns 200', path: '/', expect_status: 200 },
      ],
    }, t as never);
    console.log(stripeProbe);
    stripePassed = typeof stripeProbe === 'string' && stripeProbe.startsWith('JOURNEY PASS');
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`  Layer 1 (HTTP feature flow):     ${journeyPassed ? 'PASS' : 'FAIL'}`);
  console.log(`  Layer 2 (DB row landed):          ${dbPassed ? 'PASS' : 'FAIL'}`);
  console.log(`  Layer 3 (Stripe integration):     ${stripePassed ? 'PASS' : 'FAIL'}`);
  process.exit(journeyPassed && dbPassed && stripePassed ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
