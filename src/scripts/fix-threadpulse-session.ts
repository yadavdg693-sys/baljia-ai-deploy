// Patch server.js in BALAJIapps/threadpulse to add `app.set('trust proxy', 1)`
// before the session middleware. Render runs an HTTP-only reverse proxy in
// front of the Node service; without trust-proxy, express-session sees the
// internal HTTP hop and refuses to send Set-Cookie when cookie.secure=true.
//
// Pushes the patched file via the GitHub Contents API, then triggers a
// Render deploy and re-runs the journey verifier.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, tasks } from '@/lib/db';
import { eq, like } from 'drizzle-orm';
import { handleEngineeringTool } from '@/lib/agents/tools/engineering.tools';

const GH_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';
const REPO = 'BALAJIapps/threadpulse';

void (async () => {
  const ghHeaders = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // 1. Fetch current server.js
  const cur = await fetch(`${GH_API}/repos/${REPO}/contents/server.js`, { headers: ghHeaders });
  const curJ = await cur.json() as { content: string; sha: string };
  const code = Buffer.from(curJ.content, 'base64').toString();

  // 2. Patch: insert `app.set('trust proxy', 1);` after `const app = express();`
  let patched = code;
  if (!/app\.set\(['"]trust proxy['"]/.test(patched)) {
    patched = patched.replace(
      /const app = express\(\);/,
      `const app = express();\napp.set('trust proxy', 1); // Render runs an HTTP-only reverse proxy; without this express-session refuses to set Secure cookies.`,
    );
    console.log('  ✓ inserted trust proxy directive');
  } else {
    console.log('  trust proxy already set — skipping');
  }

  if (patched === code) {
    console.log('  no changes — server.js was already patched');
  } else {
    // 3. Commit via PUT /contents
    const put = await fetch(`${GH_API}/repos/${REPO}/contents/server.js`, {
      method: 'PUT', headers: ghHeaders,
      body: JSON.stringify({
        message: 'fix(session): app.set(trust proxy, 1) so Render reverse proxy lets express-session set Secure cookies',
        content: Buffer.from(patched, 'utf8').toString('base64'),
        sha: curJ.sha,
      }),
    });
    const putJ = await put.json() as { commit?: { sha?: string }; message?: string };
    if (!put.ok) {
      console.error('Push failed:', JSON.stringify(putJ, null, 2));
      process.exit(1);
    }
    console.log(`  ✓ pushed commit ${putJ.commit?.sha?.slice(0, 7)}`);
  }

  // 4. Trigger Render deploy
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadpulse'));
  if (!c?.render_service_id) throw new Error('no service');
  const renderHeaders = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const dep = await fetch(`${RENDER_API}/services/${c.render_service_id}/deploys`, {
    method: 'POST', headers: renderHeaders, body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  const dj = await dep.json() as { id?: string; deploy?: { id?: string } };
  const deployId = dj.id ?? dj.deploy?.id;
  console.log(`\n  ✓ Render deploy queued: ${deployId}`);

  // 5. Poll until live
  console.log(`\n  Polling deploy (max 5 min)...`);
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 15_000));
    const sr = await fetch(`${RENDER_API}/services/${c.render_service_id}/deploys/${deployId}`, { headers: renderHeaders });
    const sj = await sr.json() as { deploy?: { status?: string }; status?: string };
    const status = sj.deploy?.status ?? sj.status ?? '?';
    console.log(`    status=${status}`);
    if (status === 'live') break;
    if (['build_failed','update_failed','canceled'].includes(status)) {
      console.error('  deploy failed'); process.exit(1);
    }
  }

  // 6. Re-run verify_user_journey
  console.log(`\n  Re-running verify_user_journey ...\n`);
  const [t] = await db.select().from(tasks).where(like(tasks.title, 'REDSHIP-CLONE: Build%')).limit(1);
  const email = `test+${Date.now()}@baljia.test`;
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
