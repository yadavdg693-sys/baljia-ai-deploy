// Direct deployment recovery — bypasses the engineering agent and creates
// the Render web service for the existing Threadpulse company.
//
// Why this script exists: the engineering agent successfully pushed app code
// to BALAJIapps/threadpulse but failed to call render_create_service (it
// instead tried render_deploy with the slug as service_id, which the safety
// guard correctly rejected). This script does the deploy step directly using
// the same Render API call the platform's renderCreateService function uses.
//
// Usage: npx tsx --env-file=.env.local src/scripts/deploy-threadpulse-direct.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, dashboardLinks } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getCompanyDatabase } from '@/lib/services/neon.service';
import { provisionSubdomain } from '@/lib/services/domain.service';
import { randomBytes } from 'crypto';

const RENDER_API = 'https://api.render.com/v1';
const SLUG = 'threadpulse';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

void (async () => {
  // ── 1. Load company ──────────────────────────────────────────────────
  const [company] = await db.select().from(companies).where(eq(companies.slug, SLUG)).limit(1);
  if (!company) throw new Error(`Company "${SLUG}" not found`);
  console.log(`Company: ${company.name} (id=${company.id}, repo=${company.github_repo})`);

  if (company.render_service_id) {
    console.log(`⚠ render_service_id already set: ${company.render_service_id}. Aborting to avoid duplicate.`);
    process.exit(0);
  }
  if (!company.github_repo) throw new Error('No github_repo on company');

  // ── 2. Get DATABASE_URL ──────────────────────────────────────────────
  const dbInfo = await getCompanyDatabase(company.id);
  if (!dbInfo?.connectionUri) throw new Error('No Neon connection URI for this company');
  console.log(`Neon DB: ${dbInfo.host}`);

  // ── 3. Build env vars (matches render.yaml in repo) ──────────────────
  const sessionSecret = randomBytes(32).toString('hex');
  const envVars = [
    { key: 'DATABASE_URL',   value: dbInfo.connectionUri },
    { key: 'SESSION_SECRET', value: sessionSecret },
    { key: 'NODE_ENV',       value: 'production' },
    { key: 'PORT',           value: '10000' },
    { key: 'STRIPE_LINK',    value: 'https://buy.stripe.com/placeholder' },
  ];

  // ── 4. Create the Render web service ─────────────────────────────────
  const ownerId = process.env.RENDER_OWNER_ID;
  if (!ownerId) throw new Error('RENDER_OWNER_ID missing');
  const apiKey = process.env.RENDER_API_KEY!;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const baseBody = {
    type: 'web_service',
    name: SLUG,
    ownerId,
    repo: `https://github.com/${company.github_repo}`,
    branch: 'main',
    autoDeploy: 'yes',
  };
  // Build a body and POST it. Try modern field name (`runtime`) first, fall
  // back to legacy (`env`). Render renamed the field in late 2024.
  type RenderResp = {
    service?: { id?: string; dashboardUrl?: string; serviceDetails?: { url?: string } };
    id?: string; message?: string;
  };
  async function postCreate(serviceDetails: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: RenderResp }> {
    const r = await fetch(`${RENDER_API}/services`, {
      method: 'POST', headers, body: JSON.stringify({ ...baseBody, serviceDetails }),
    });
    const d = await r.json().catch(() => ({})) as RenderResp;
    return { ok: r.ok, status: r.status, data: d };
  }

  const modernDetails = {
    runtime: 'node',
    plan: 'free',
    envVars,
    envSpecificDetails: {
      buildCommand: 'npm install',
      startCommand: 'node server.js',
    },
  };
  const legacyDetails = {
    env: 'node',
    plan: 'free',
    buildCommand: 'npm install',
    startCommand: 'node server.js',
    envVars,
  };

  console.log(`\nPOST ${RENDER_API}/services (modern shape: runtime + envSpecificDetails) ...`);
  let attempt = await postCreate(modernDetails);
  // On 429, back off and retry the SAME shape — don't burn another rate slot
  // on the legacy shape unless the modern one returned a real schema error.
  let backoffs = 0;
  while (!attempt.ok && attempt.status === 429 && backoffs < 6) {
    const wait = 30_000 * (1 + backoffs); // 30s, 60s, 90s, 120s, 150s, 180s
    console.log(`  HTTP 429 rate limit — backing off ${wait / 1000}s before retry ${backoffs + 1}/6`);
    await sleep(wait);
    attempt = await postCreate(modernDetails);
    backoffs++;
  }
  if (!attempt.ok && attempt.status !== 429) {
    console.log(`  HTTP ${attempt.status}: ${attempt.data.message ?? '?'}`);
    console.log(`  Falling back to legacy shape (env + flat buildCommand/startCommand) ...`);
    attempt = await postCreate(legacyDetails);
  }
  if (!attempt.ok) {
    console.error(`Render service creation failed: HTTP ${attempt.status}`);
    console.error('Body:', JSON.stringify(attempt.data, null, 2));
    process.exit(1);
  }
  const data = attempt.data;

  const serviceId = data.service?.id ?? data.id;
  if (!serviceId) {
    console.error('No service ID in response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  const dashboardUrl = data.service?.dashboardUrl ?? '?';
  const serviceUrl = data.service?.serviceDetails?.url ?? '?';
  console.log(`✓ Render service created: ${serviceId}`);
  console.log(`  Dashboard: ${dashboardUrl}`);
  console.log(`  URL:       ${serviceUrl}`);

  // ── 5. Save service ID to company ────────────────────────────────────
  await db.update(companies)
    .set({ render_service_id: serviceId, hosting_state: 'live' })
    .where(eq(companies.id, company.id));
  console.log(`✓ company.render_service_id saved`);

  // ── 6. Attach baljia.app subdomain ───────────────────────────────────
  try {
    const dom = await provisionSubdomain(company.id, SLUG, serviceId);
    if (dom) console.log(`✓ subdomain attached: https://${dom.domain} (${dom.status})`);
    else     console.log(`  subdomain attachment skipped (domain service not configured)`);
  } catch (e) {
    console.warn(`  ⚠ subdomain attach failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 7. Poll deploy status ────────────────────────────────────────────
  console.log(`\nPolling deploy status (max 10 min)...`);
  const deadline = Date.now() + 10 * 60 * 1000;
  let live = false;
  while (Date.now() < deadline) {
    await sleep(20_000);
    const r = await fetch(`${RENDER_API}/services/${serviceId}/deploys?limit=1`, { headers });
    if (!r.ok) { console.log(`  poll: HTTP ${r.status}`); continue; }
    const arr = await r.json() as Array<{ deploy: { id: string; status: string } }>;
    const dep = arr[0]?.deploy;
    if (!dep) { console.log(`  poll: no deploys yet`); continue; }
    console.log(`  deploy ${dep.id} status=${dep.status} (+${Math.round((Date.now() - (deadline - 600_000)) / 1000)}s)`);
    if (dep.status === 'live') { live = true; break; }
    if (['build_failed','update_failed','canceled','deactivated','pre_deploy_failed'].includes(dep.status)) {
      console.error(`  ⚠ deploy failed: ${dep.status}`);
      process.exit(1);
    }
  }
  if (!live) { console.error('Timed out waiting for deploy to go live'); process.exit(1); }

  // ── 8. Health-check via Render-assigned URL ──────────────────────────
  const svcRes = await fetch(`${RENDER_API}/services/${serviceId}`, { headers });
  const svcData = await svcRes.json() as { service?: { serviceDetails?: { url?: string } }; serviceDetails?: { url?: string } };
  const liveUrl = svcData.service?.serviceDetails?.url ?? svcData.serviceDetails?.url ?? '';
  if (!liveUrl) { console.error('No URL on service'); process.exit(1); }
  console.log(`\nLive URL: ${liveUrl}`);

  console.log(`\nHealth checks:`);
  for (const path of ['/', '/register', '/login', '/api/health']) {
    try {
      const hr = await fetch(`${liveUrl}${path}`, { signal: AbortSignal.timeout(15_000) });
      console.log(`  ${path.padEnd(15)} → HTTP ${hr.status}`);
    } catch (e) {
      console.log(`  ${path.padEnd(15)} → error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 9. Add dashboard link ────────────────────────────────────────────
  await db.insert(dashboardLinks).values({
    company_id: company.id,
    label: 'Live app',
    url: liveUrl,
    kind: 'live_app',
  });
  console.log(`\n✓ dashboard link added`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  DEPLOYED`);
  console.log(`  Render URL:    ${liveUrl}`);
  console.log(`  baljia.app:    https://${SLUG}.baljia.app  (DNS may take ~30s)`);
  console.log(`  Dashboard:     http://localhost:3000/dashboard/${company.id}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
