// Check what was actually pushed to BALAJIapps/threadpulse
// and inspect any Render services that exist for this token.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

const GITHUB_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';

void (async () => {
  const ghToken = process.env.GITHUB_TOKEN!;
  const ghOrg  = process.env.GITHUB_ORG!;
  const rendKey = process.env.RENDER_API_KEY!;

  console.log('───── GitHub repo BALAJIapps/threadpulse ─────');
  const treeRes = await fetch(`${GITHUB_API}/repos/${ghOrg}/threadpulse/contents/`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!treeRes.ok) { console.log('  ⚠ repo fetch failed:', treeRes.status, treeRes.statusText); }
  else {
    const tree = await treeRes.json() as Array<{ name: string; type: string; size?: number }>;
    console.log(`  ${tree.length} top-level entries:`);
    for (const e of tree) console.log(`    [${e.type}] ${e.name}${e.size ? ` (${e.size}b)` : ''}`);
  }

  console.log('\n───── Render services owned by this account ─────');
  const svcRes = await fetch(`${RENDER_API}/services?limit=50`, {
    headers: { Authorization: `Bearer ${rendKey}` },
  });
  if (!svcRes.ok) { console.log('  ⚠ render fetch failed:', svcRes.status, svcRes.statusText); }
  else {
    const wrapped = await svcRes.json() as Array<{ service: { id: string; name: string; serviceDetails?: { url?: string } } }>;
    const services = wrapped.map(w => w.service);
    const matches = services.filter(s => /thread|redship|baljia/i.test(s.name));
    console.log(`  total services: ${services.length}`);
    console.log(`  matching threadpulse/redship/baljia (${matches.length}):`);
    for (const s of matches) console.log(`    ${s.id} | ${s.name} | url=${s.serviceDetails?.url ?? '-'}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
