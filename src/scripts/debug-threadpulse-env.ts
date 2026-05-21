// Compare what env vars exist on Render vs what should be there.
// Try multiple Render API endpoints since the v1 shape changed.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getCompanyDatabase } from '@/lib/services/neon.service';

const RENDER_API = 'https://api.render.com/v1';

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, 'threadpulse'));
  if (!c?.render_service_id) throw new Error('no service');
  const sid = c.render_service_id;
  const headers = { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' };

  console.log('Service ID:', sid);

  // Endpoint 1: GET /services/:id/env-vars
  const r1 = await fetch(`${RENDER_API}/services/${sid}/env-vars`, { headers });
  console.log(`\nGET /services/${sid}/env-vars → HTTP ${r1.status}`);
  const j1 = await r1.json();
  console.log(JSON.stringify(j1, null, 2).slice(0, 2000));

  // Endpoint 2: GET /services/:id (full service body)
  const r2 = await fetch(`${RENDER_API}/services/${sid}`, { headers });
  console.log(`\nGET /services/${sid} → HTTP ${r2.status}`);
  const j2 = await r2.json() as { service?: Record<string, unknown>; envVars?: unknown };
  // Just print key sections
  const svc = (j2.service ?? j2) as Record<string, unknown>;
  console.log('  name:', svc.name);
  console.log('  type:', svc.type);
  console.log('  serviceDetails:', JSON.stringify(svc.serviceDetails, null, 2)?.slice(0, 1500));
  if ('envVars' in (svc as object)) console.log('  envVars on service body:', JSON.stringify((svc as { envVars: unknown }).envVars, null, 2));

  // What SHOULD the DATABASE_URL be?
  const dbInfo = await getCompanyDatabase(c.id);
  console.log(`\nNeon connectionUri (first 50): ${dbInfo?.connectionUri?.slice(0, 50)}…`);
})().catch(e => { console.error(e); process.exit(1); });
