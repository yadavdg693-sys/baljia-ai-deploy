// One-shot: delete the unverified genesis-advertising-hen6.baljia.app custom
// domain so the Render Hobby tier 2-domain cap has a free slot.
//
// USER-APPROVED. Specifically targets the stale static-site domain.

const SERVICE_ID = 'srv-d7tjgrreo5us73bf0if0';        // genesis-advertising-hen6 (static_site)
const CUSTOM_DOMAIN_ID = 'cdm-d7tjgsjeo5us73bf0j5g';  // genesis-advertising-hen6.baljia.app (unverified)

void (async () => {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) { console.error('RENDER_API_KEY missing'); process.exit(1); }

  console.log(`Deleting custom domain ${CUSTOM_DOMAIN_ID} from service ${SERVICE_ID}...`);
  const r = await fetch(
    `https://api.render.com/v1/services/${SERVICE_ID}/custom-domains/${CUSTOM_DOMAIN_ID}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    },
  );

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error(`HTTP ${r.status}: ${body}`);
    process.exit(1);
  }

  console.log(`✓ Deleted (HTTP ${r.status})`);

  // Confirm by re-listing
  console.log(`\nRemaining custom domains across all services:`);
  const sr = await fetch('https://api.render.com/v1/services?limit=50', {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const services = await sr.json() as Array<{ service: { id: string; name: string; type: string } }>;
  let total = 0;
  for (const s of services) {
    const dr = await fetch(
      `https://api.render.com/v1/services/${s.service.id}/custom-domains?limit=10`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } },
    );
    if (!dr.ok) continue;
    const domains = await dr.json() as Array<{ customDomain: { name: string; verificationStatus: string } }>;
    for (const d of domains) {
      console.log(`  ${s.service.name}: ${d.customDomain.name} (${d.customDomain.verificationStatus})`);
      total++;
    }
  }
  console.log(`\nTotal: ${total} / 2 (Hobby tier cap)`);
  process.exit(0);
})();
