// Patch the threadpulse Render service by adding the missing env vars
// (DATABASE_URL, SESSION_SECRET, NODE_ENV, PORT, STRIPE_LINK), then trigger
// a redeploy so the new server picks them up.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getCompanyDatabase } from '@/lib/services/neon.service';
import { randomBytes } from 'crypto';

const RENDER_API = 'https://api.render.com/v1';

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadpulse'));
  if (!c?.render_service_id) throw new Error('no service');
  const sid = c.render_service_id;
  const dbInfo = await getCompanyDatabase(c.id);
  if (!dbInfo?.connectionUri) throw new Error('no Neon connection');

  const headers = {
    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const envVars = [
    { key: 'DATABASE_URL',   value: dbInfo.connectionUri },
    { key: 'SESSION_SECRET', value: randomBytes(32).toString('hex') },
    { key: 'NODE_ENV',       value: 'production' },
    { key: 'PORT',           value: '10000' },
    { key: 'STRIPE_LINK',    value: 'https://buy.stripe.com/placeholder' },
  ];

  // Render's bulk env-var update endpoint: PUT /services/:id/env-vars
  // Replaces the entire env-var set for the service.
  console.log(`PUT /services/${sid}/env-vars (5 vars)...`);
  const r = await fetch(`${RENDER_API}/services/${sid}/env-vars`, {
    method: 'PUT', headers,
    body: JSON.stringify(envVars),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`HTTP ${r.status}:`, JSON.stringify(j, null, 2));
    process.exit(1);
  }
  console.log(`  ✓ env vars set (${envVars.length})`);
  console.log(`  keys: ${envVars.map(e => e.key).join(', ')}`);

  // Trigger a redeploy
  console.log(`\nPOST /services/${sid}/deploys ...`);
  const dep = await fetch(`${RENDER_API}/services/${sid}/deploys`, {
    method: 'POST', headers,
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  const dj = await dep.json() as { id?: string; deploy?: { id?: string }; message?: string };
  if (!dep.ok) {
    console.error(`Deploy trigger failed:`, JSON.stringify(dj, null, 2));
    process.exit(1);
  }
  const deployId = dj.id ?? dj.deploy?.id;
  console.log(`  ✓ deploy queued: ${deployId}`);
  console.log(`\nPolling deploy status (max 5 min)...`);

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 15_000));
    const sr = await fetch(`${RENDER_API}/services/${sid}/deploys/${deployId}`, { headers });
    const sj = await sr.json() as { deploy?: { status?: string }; status?: string };
    const status = sj.deploy?.status ?? sj.status ?? '?';
    console.log(`  status=${status}`);
    if (status === 'live') break;
    if (['build_failed','update_failed','canceled'].includes(status)) {
      console.error(`  ⚠ deploy ${status}`); process.exit(1);
    }
  }

  // Verify
  console.log(`\nProbing endpoints...`);
  for (const path of ['/api/health', '/register', '/']) {
    const r = await fetch(`https://threadpulse.baljia.app${path}`, { signal: AbortSignal.timeout(15_000), redirect: 'manual' });
    if (path === '/api/health') {
      const body = await r.text();
      console.log(`  ${path.padEnd(15)} → HTTP ${r.status}  body=${body.slice(0,80)}`);
    } else {
      console.log(`  ${path.padEnd(15)} → HTTP ${r.status}`);
    }
  }

  console.log(`\n✓ Now try registering at https://threadpulse.baljia.app/register`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
