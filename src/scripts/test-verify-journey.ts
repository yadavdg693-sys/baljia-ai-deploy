// Smoke test the new verify_user_journey tool against live threadpulse.
// Walks: register a new user → confirm dashboard reached → sign out →
// log in with same credentials → confirm dashboard again.
//
// This is exactly the gap the deterministic verifier missed earlier:
// "Registration failed. Please try again." would surface as a failed
// expect_body_not_contains check.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';
import { db, tasks } from '@/lib/db';
import { like } from 'drizzle-orm';

void (async () => {
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  if (!t) throw new Error('task not found');

  const email = `test+${Date.now()}@baljia.test`;
  const password = 'TestPassword123!';
  const baseUrl = 'https://threadpulse.baljia.app';

  const journeyInput = {
    journey_name: 'register, reach dashboard, sign out, sign back in',
    base_url: baseUrl,
    steps: [
      { step: 'landing page loads with hero copy', path: '/', expect_status: 200,
        expect_body_contains: 'Turn Reddit users into customers' },
      { step: 'register page loads', path: '/register', expect_status: 200,
        expect_body_contains: 'Create account' },
      { step: 'submit registration', method: 'POST', path: '/auth/register',
        body: { email, password }, body_type: 'form',
        expect_status: 302, expect_redirect: '/dashboard',
        expect_body_not_contains: 'Registration failed' },
      { step: 'dashboard accessible after register', path: '/dashboard',
        expect_status: 200,
        expect_body_not_contains: 'Sign in' },
      { step: 'sign out', method: 'POST', path: '/auth/logout', expect_status: 302 },
      { step: 'login page loads', path: '/login', expect_status: 200 },
      { step: 'submit login', method: 'POST', path: '/auth/login',
        body: { email, password }, body_type: 'form',
        expect_status: 302, expect_redirect: '/dashboard',
        expect_body_not_contains: 'Invalid' },
      { step: 'dashboard accessible after sign-in', path: '/dashboard',
        expect_status: 200 },
    ],
  };

  // handleEngineeringTool signature: (toolName, input, task)
  const result = await handleEngineeringTool('verify_user_journey', journeyInput, t as never);

  console.log(result);
  const passed = typeof result === 'string' && result.startsWith('JOURNEY PASS');
  process.exit(passed ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
