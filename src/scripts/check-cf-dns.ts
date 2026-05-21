// Inspect the actual CF DNS record for threadpulse.baljia.app to see
// if proxied=false took effect.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

void (async () => {
  const token = process.env.CLOUDFLARE_API_TOKEN!;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
  const fqdn = 'threadpulse.baljia.app';

  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json() as { success: boolean; result?: Array<{ id: string; type: string; name: string; content: string; proxied: boolean; ttl: number }>; errors?: Array<{ message: string }> };
  console.log(`HTTP ${r.status}, success=${j.success}`);
  if (!j.success) { console.log('errors:', j.errors); process.exit(1); }
  console.log(`Records for ${fqdn}: ${j.result?.length ?? 0}`);
  for (const rec of j.result ?? []) {
    console.log(`  id=${rec.id}`);
    console.log(`  ${rec.type} ${rec.name} → ${rec.content}`);
    console.log(`  proxied=${rec.proxied}  ttl=${rec.ttl}`);
  }

  // Also list the worker routes on this zone
  console.log(`\nWorker routes on this zone:`);
  const wr = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wj = await wr.json() as { success: boolean; result?: Array<{ id: string; pattern: string; script: string }>; errors?: Array<{ message: string }> };
  if (!wj.success) { console.log('errors:', wj.errors); process.exit(1); }
  for (const route of wj.result ?? []) {
    console.log(`  ${route.pattern} → script "${route.script}"`);
  }
})().catch(e => { console.error(e); process.exit(1); });
