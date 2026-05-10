// List all custom domains attached across all Render services in this account.
void (async () => {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) { console.error('RENDER_API_KEY missing'); process.exit(1); }
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };

  const sr = await fetch('https://api.render.com/v1/services?limit=50', { headers });
  const services = await sr.json() as Array<{ service: { id: string; name: string; type: string } }>;
  console.log(`Found ${services.length} services. Checking custom domains for each...\n`);

  for (const s of services) {
    const svc = s.service;
    if (svc.type !== 'web_service') continue;
    const dr = await fetch(`https://api.render.com/v1/services/${svc.id}/custom-domains?limit=10`, { headers });
    if (!dr.ok) continue;
    const domains = await dr.json() as Array<{ customDomain: { id: string; name: string; verificationStatus: string; createdAt: string } }>;
    if (domains.length === 0) continue;
    console.log(`${svc.name} (${svc.id}):`);
    for (const d of domains) {
      console.log(`  ${d.customDomain.id}  ${d.customDomain.name}  status=${d.customDomain.verificationStatus}  created=${d.customDomain.createdAt}`);
    }
  }
  process.exit(0);
})();
