// Re-attach threadpulse.baljia.app with proxied:false (DNS-only) so traffic
// bypasses the *.baljia.app wildcard worker and reaches Render directly.
//
// For Threadpulse specifically the Render domain is already attached, so we
// skip the renderAddCustomDomain step and call CF directly through the
// platform's CF helpers via a one-shot wrapper. This script is the manual
// remediation for an existing company — new companies go through
// provisionSubdomain (which has now been patched to do this correctly).
//
// Usage: npx tsx --env-file=.env.local src/scripts/fix-threadpulse-dns.ts

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

const CF_API = 'https://api.cloudflare.com/client/v4';
const RENDER_API = 'https://api.render.com/v1';
const SLUG = 'threadpulse';

// Inline minimal CF DNS replace that fully respects the proxied flag.
// Mirrors the patched cloudflareReplaceDNS in domain.service.ts but is
// self-contained so we don't have to modify exported surface to test.
async function replaceCNAME(fqdn: string, target: string, proxied: boolean): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN!;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const list = await fetch(`${CF_API}/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(fqdn)}`, { headers });
  const lj = await list.json() as { success: boolean; result?: Array<{ id: string; content: string; proxied: boolean }> };
  const existing = lj.result ?? [];

  for (const r of existing) {
    if (r.content === target && r.proxied === proxied) {
      console.log(`  CNAME already correct: ${fqdn} → ${target} (proxied=${proxied})`);
      return true;
    }
    await fetch(`${CF_API}/zones/${zoneId}/dns_records/${r.id}`, { method: 'DELETE', headers });
    console.log(`  Deleted old CNAME: ${fqdn} → ${r.content} (proxied=${r.proxied})`);
  }

  const create = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
    method: 'POST', headers,
    body: JSON.stringify({ type: 'CNAME', name: fqdn, content: target, proxied, ttl: 1 }),
  });
  const cj = await create.json() as { success: boolean; errors?: Array<{ message: string }> };
  if (!cj.success) {
    console.error(`  Create failed:`, cj.errors);
    return false;
  }
  console.log(`  Created CNAME: ${fqdn} → ${target} (proxied=${proxied})`);
  return true;
}

async function getRenderHostname(serviceId: string): Promise<string | null> {
  const r = await fetch(`${RENDER_API}/services/${serviceId}`, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const d = await r.json() as { service?: { serviceDetails?: { url?: string } }; serviceDetails?: { url?: string } };
  const url = d.service?.serviceDetails?.url ?? d.serviceDetails?.url ?? '';
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '') || null;
}

void (async () => {
  const [c] = await db.select().from(companies).where(eq(companies.slug, SLUG));
  if (!c) throw new Error('Company not found');
  if (!c.render_service_id) throw new Error('No render_service_id');
  console.log(`Company: ${c.slug}, render_service_id=${c.render_service_id}`);

  const renderHostname = await getRenderHostname(c.render_service_id);
  if (!renderHostname) throw new Error('Could not resolve Render hostname for service');
  console.log(`Render hostname: ${renderHostname}`);

  const ok = await replaceCNAME(`${SLUG}.baljia.app`, renderHostname, false);
  if (!ok) process.exit(1);

  console.log(`\nWaiting 20s for DNS propagation, then probing https://${SLUG}.baljia.app/ ...`);
  await new Promise(r => setTimeout(r, 20_000));

  const hr = await fetch(`https://${SLUG}.baljia.app/`, { signal: AbortSignal.timeout(15_000), redirect: 'manual' });
  const headers = Object.fromEntries(hr.headers.entries());
  console.log(`HTTP ${hr.status}`);
  console.log(`  x-baljia-tier:           ${headers['x-baljia-tier'] ?? '(none — ✓ CF worker not intercepting)'}`);
  console.log(`  x-render-origin-server:  ${headers['x-render-origin-server'] ?? '(none)'}`);
  console.log(`  x-powered-by:            ${headers['x-powered-by'] ?? '(none)'}`);
  console.log(`  server:                  ${headers['server'] ?? '(none)'}`);

  if (headers['x-baljia-tier']) {
    console.log(`\n⚠ CF worker still intercepting. DNS may need more time to propagate (try again in 60s).`);
    process.exit(2);
  } else if (headers['x-render-origin-server'] || headers['x-powered-by']) {
    console.log(`\n✓ ${SLUG}.baljia.app now serves the Render-deployed app.`);
    process.exit(0);
  } else {
    console.log(`\n  Inconclusive — Render may still be issuing the cert. Try again in 60-120s.`);
    process.exit(0);
  }
})().catch(e => { console.error(e); process.exit(1); });
