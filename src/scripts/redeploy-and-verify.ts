// Trigger a fresh deploy on threadpulse + wait + re-run verify_user_journey.
// (The previous patch script crashed parsing the deploy response but did
// successfully push the trust-proxy fix — commit 9f57189.)

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, tasks } from '@/lib/db';
import { eq, like } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';

const RENDER_API = 'https://api.render.com/v1';

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadpulse'));
  if (!c?.render_service_id) throw new Error('no service');
  const sid = c.render_service_id;
  const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  // Check most recent deploy
  const lr = await fetch(`${RENDER_API}/services/${sid}/deploys?limit=2`, { headers });
  const lt = await lr.text();
  console.log('Recent deploys (raw):', lt.slice(0, 500));

  // Trigger fresh deploy
  console.log(`\nTriggering new deploy ...`);
  const dr = await fetch(`${RENDER_API}/services/${sid}/deploys`, { method: 'POST', headers, body: JSON.stringify({ clearCache: 'do_not_clear' }) });
  const drText = await dr.text();
  console.log(`HTTP ${dr.status}: ${drText.slice(0, 300)}`);
  let deployId: string | undefined;
  try {
    const j = JSON.parse(drText);
    deployId = j.id ?? j.deploy?.id;
  } catch {}
  if (!deployId) {
    // Fall back to the latest deploy id from the list
    try {
      const arr = JSON.parse(lt) as Array<{ deploy: { id: string; commit?: { id: string } } }>;
      // pick the one whose commit matches 9f57189
      const match = arr.find(e => e.deploy.commit?.id?.startsWith('9f57189'));
      deployId = match?.deploy.id ?? arr[0]?.deploy.id;
      console.log(`  using existing deploy id ${deployId}`);
    } catch {}
  }
  if (!deployId) throw new Error('Could not determine deployId');

  // Poll
  console.log(`\nPolling deploy ${deployId} (max 5 min) ...`);
  const deadline = Date.now() + 5 * 60 * 1000;
  let lastStatus = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 12_000));
    const sr = await fetch(`${RENDER_API}/services/${sid}/deploys/${deployId}`, { headers });
    const sj = await sr.json() as { deploy?: { status?: string; commit?: { id?: string } }; status?: string; commit?: { id?: string } };
    const status = sj.deploy?.status ?? sj.status ?? '?';
    const sha = (sj.deploy?.commit?.id ?? sj.commit?.id ?? '').slice(0, 7);
    if (status !== lastStatus) {
      console.log(`  status=${status} sha=${sha}`);
      lastStatus = status;
    }
    if (status === 'live') break;
    if (['build_failed','update_failed','canceled','deactivated'].includes(status)) {
      console.error('  deploy failed'); process.exit(1);
    }
  }

  // Re-run journey
  console.log(`\nRe-running verify_user_journey ...\n`);
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  const email = `journey-${Date.now()}@baljia.test`;
  const password = 'TestPassword123!';
  const journey = {
    journey_name: 'register → dashboard → sign out → sign in → dashboard',
    base_url: 'https://threadpulse.baljia.app',
    steps: [
      { step: 'landing',  path: '/',          expect_status: 200, expect_body_contains: 'Turn Reddit users into customers' },
      { step: 'register form', path: '/register', expect_status: 200, expect_body_contains: 'Create account' },
      { step: 'submit register', method: 'POST', path: '/auth/register',
        body: { email, password }, body_type: 'form' as const,
        expect_status: 302, expect_redirect: '/dashboard',
        expect_body_not_contains: 'Registration failed' },
      { step: 'dashboard after register', path: '/dashboard',
        expect_status: 200, expect_body_not_contains: 'Sign in' },
      { step: 'sign out', method: 'POST', path: '/auth/logout', expect_status: 302 },
      { step: 'login form', path: '/login', expect_status: 200 },
      { step: 'submit login', method: 'POST', path: '/auth/login',
        body: { email, password }, body_type: 'form' as const,
        expect_status: 302, expect_redirect: '/dashboard',
        expect_body_not_contains: 'Invalid' },
      { step: 'dashboard after sign-in', path: '/dashboard', expect_status: 200 },
    ],
  };
  const out = await handleEngineeringTool('verify_user_journey', journey, t as never);
  console.log(out);
  const passed = typeof out === 'string' && out.startsWith('JOURNEY PASS');
  process.exit(passed ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
