void (async () => {
  const headers = { Authorization: 'Bearer ' + process.env.RENDER_API_KEY, Accept: 'application/json' };
  const sr = await fetch('https://api.render.com/v1/services?limit=50', { headers });
  const services = await sr.json() as Array<{ service: { id: string; name: string; type: string } }>;
  for (const s of services) {
    const svc = s.service;
    process.stdout.write(`${svc.name} (${svc.id}, ${svc.type}): `);
    const dr = await fetch(`https://api.render.com/v1/services/${svc.id}/custom-domains?limit=10`, { headers });
    if (!dr.ok) { console.log(`HTTP ${dr.status}`); continue; }
    const domains = await dr.json() as Array<{ customDomain: { id: string; name: string; verificationStatus: string } }>;
    if (domains.length === 0) { console.log('no domains'); continue; }
    console.log(`${domains.length} domain(s)`);
    for (const d of domains) {
      console.log(`  ${d.customDomain.id}  ${d.customDomain.name}  status=${d.customDomain.verificationStatus}`);
    }
  }
  process.exit(0);
})();
