// End-to-end test on threadpulse:
//   1. Tear down the existing Render service (so agent must create a fresh one)
//   2. Clear render_service_id, custom_domain, subdomain on company
//   3. Delete the threadpulse.baljia.app CF DNS record
//   4. Upload a sample R2 landing for threadpulse so we can verify the
//      symmetric R2 cleanup actually fires when engineering deploys
//   5. Reset the REDSHIP-CLONE engineering task to 'todo'
//   6. Launch the task and watch the agent go end-to-end (skills → push code →
//      render_create_service [patched body shape] → render_deploy → check_url_health
//      → provisionSubdomain [DNS-only CNAME + R2 cleanup] → add_dashboard_link)
//   7. After completion, verify https://threadpulse.baljia.app reaches Render
//
// This validates every fix applied today.
//
// Usage: npx tsx --env-file=.env.local src/scripts/reset-and-relaunch-threadpulse.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies, tasks } from '@/lib/db';
import { eq, and, like } from 'drizzle-orm';
import { launchTask } from '@/lib/agents/worker-launcher';
import { uploadLandingHtml, landingHtmlExists } from '@/lib/services/cf-deploy.service';

const RENDER_API = 'https://api.render.com/v1';
const CF_API = 'https://api.cloudflare.com/client/v4';
const SLUG = 'threadpulse';
const FQDN = `${SLUG}.baljia.app`;

async function deleteRenderService(serviceId: string): Promise<void> {
  const r = await fetch(`${RENDER_API}/services/${serviceId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` },
  });
  if (!r.ok && r.status !== 404) {
    console.warn(`  ⚠ Render service delete returned HTTP ${r.status}`);
  } else {
    console.log(`  ✓ Render service ${serviceId} deleted`);
  }
}

async function deleteCfDns(fqdn: string): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN!;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
  const list = await fetch(`${CF_API}/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const lj = await list.json() as { result?: Array<{ id: string; type: string; content: string }> };
  for (const r of lj.result ?? []) {
    await fetch(`${CF_API}/zones/${zoneId}/dns_records/${r.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`  ✓ deleted DNS ${r.type} ${fqdn} → ${r.content}`);
  }
  if ((lj.result ?? []).length === 0) console.log(`  (no DNS records for ${fqdn} to delete)`);
}

async function probe(label: string, url: string): Promise<{ status: number; renderServer: boolean; baljiaTier: string | null }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'manual' });
    const h = Object.fromEntries(r.headers.entries());
    return {
      status: r.status,
      renderServer: !!h['x-render-origin-server'],
      baljiaTier: h['x-baljia-tier'] ?? null,
    };
  } catch (e) {
    console.log(`  ${label} threw: ${e instanceof Error ? e.message : String(e)}`);
    return { status: 0, renderServer: false, baljiaTier: null };
  }
}

void (async () => {
  const t0 = Date.now();
  console.log(`\n══════════════════════════════════════════════════`);
  console.log(`  THREADPULSE — RESET AND RELAUNCH (E2E)`);
  console.log(`══════════════════════════════════════════════════\n`);

  // ── 1. Load company ──────────────────────────────────────────────────
  const [c] = await db.select().from(companies).where(eq(companies.slug, SLUG));
  if (!c) throw new Error('threadpulse not found');
  console.log(`Company: ${c.name} (id=${c.id})`);
  console.log(`  github_repo:       ${c.github_repo ?? '-'}`);
  console.log(`  render_service_id: ${c.render_service_id ?? '-'}`);
  console.log(`  subdomain:         ${c.subdomain ?? '-'}`);

  // ── 2. Tear down Render service ──────────────────────────────────────
  if (c.render_service_id) {
    console.log(`\nTearing down existing Render service ...`);
    await deleteRenderService(c.render_service_id);
  }

  // ── 3. Delete CF DNS record ──────────────────────────────────────────
  console.log(`\nDeleting CF DNS record for ${FQDN} ...`);
  await deleteCfDns(FQDN);

  // ── 4. Upload a placeholder R2 landing so cleanup is observable ──────
  // We want to prove the symmetric handoff cleanup fires. Onboarding's
  // landing-gen failed for threadpulse so R2 is empty — upload a dummy.
  const placeholderHtml = `<!DOCTYPE html><html><head><title>Threadpulse landing</title></head><body><h1>Onboarding placeholder</h1><p>This R2 object should be deleted when engineering deploys.</p></body></html>`;
  const upload = await uploadLandingHtml({ subdomain: SLUG, html: placeholderHtml });
  console.log(`\nUploaded placeholder R2 landing: ${upload?.key ?? '(failed)'}`);
  const existsBefore = await landingHtmlExists(SLUG);
  console.log(`  R2 has founder-apps/${SLUG}/index.html: ${existsBefore}`);

  // ── 5. Clear company state and reset engineering task ────────────────
  await db.update(companies).set({
    render_service_id: null,
    custom_domain:     null,
    subdomain:         null,
    hosting_state:     'pending' as const,
  }).where(eq(companies.id, c.id));
  console.log(`\n✓ Cleared render_service_id / custom_domain / subdomain on company`);

  const [eng] = await db.select().from(tasks).where(and(
    eq(tasks.company_id, c.id),
    like(tasks.title, 'REDSHIP-CLONE: Build%'),
  )).limit(1);
  if (!eng) throw new Error('REDSHIP-CLONE engineering task not found');

  await db.update(tasks).set({
    status:                 'todo',
    started_at:             null,
    completed_at:           null,
    failure_class:          null,
    turn_count:             0,
    actual_credits_charged: 0,
    repair_attempt_count:   0,
    updated_at:             new Date(),
  }).where(eq(tasks.id, eng.id));
  console.log(`✓ Engineering task ${eng.id.slice(0, 8)}… reset to 'todo'\n`);

  // ── 6. Launch engineering task ───────────────────────────────────────
  console.log(`▶ Launching engineering task at +${Math.round((Date.now() - t0) / 1000)}s ...`);
  const result = await launchTask(eng.id, { subscriptionFunded: true });
  console.log(`\n◀ Engineering finished after ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`  status = ${result.status}`);
  console.log(`  turns  = ${result.turn_count}`);

  // ── 7. Verify final state ────────────────────────────────────────────
  const [c2] = await db.select().from(companies).where(eq(companies.id, c.id));
  console.log(`\nPost-deploy company state:`);
  console.log(`  render_service_id: ${c2?.render_service_id ?? '-'}`);
  console.log(`  custom_domain:     ${c2?.custom_domain ?? '-'}`);
  console.log(`  subdomain:         ${c2?.subdomain ?? '-'}`);

  const existsAfter = await landingHtmlExists(SLUG);
  console.log(`\nR2 cleanup check:`);
  console.log(`  founder-apps/${SLUG}/index.html exists: ${existsAfter} ${existsAfter ? '⚠ NOT cleaned up' : '✓ cleaned up'}`);

  console.log(`\nLive endpoint probes (waiting 20s for DNS) ...`);
  await new Promise(r => setTimeout(r, 20_000));
  const baljia = await probe('baljia', `https://${FQDN}/`);
  console.log(`  https://${FQDN}/   HTTP ${baljia.status}  render-served=${baljia.renderServer}  cf-worker-served=${!!baljia.baljiaTier}`);

  if (c2?.render_service_id) {
    const renderHostRes = await fetch(`${RENDER_API}/services/${c2.render_service_id}`, {
      headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' },
    });
    if (renderHostRes.ok) {
      const j = await renderHostRes.json() as { service?: { serviceDetails?: { url?: string } }; serviceDetails?: { url?: string } };
      const renderUrl = j.service?.serviceDetails?.url ?? j.serviceDetails?.url ?? '';
      if (renderUrl) {
        const direct = await probe('render-direct', renderUrl);
        console.log(`  ${renderUrl}/   HTTP ${direct.status}  render-served=${direct.renderServer}`);
      }
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const success = baljia.status === 200 && baljia.renderServer && !baljia.baljiaTier && !existsAfter;
  console.log(`  E2E TEST: ${success ? 'PASS ✅' : 'PARTIAL — check above'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(success ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
