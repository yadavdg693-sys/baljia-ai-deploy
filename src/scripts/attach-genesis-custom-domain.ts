// Attach genesis-advertising.baljia.app to its Render service now that a slot
// is free. Idempotent: skips if already attached.
const SERVICE_ID = 'srv-d8043137uimc73f6r68g';
const DOMAIN = 'genesis-advertising.baljia.app';

void (async () => {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) { console.error('RENDER_API_KEY missing'); process.exit(1); }
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  // Check existing
  const lr = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/custom-domains?limit=10`, { headers });
  const existing = await lr.json() as Array<{ customDomain: { name: string } }>;
  if (existing.some((d) => d.customDomain.name === DOMAIN)) {
    console.log(`✓ Already attached`);
    process.exit(0);
  }

  console.log(`Attaching ${DOMAIN} to ${SERVICE_ID}...`);
  const r = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/custom-domains`, {
    method: 'POST', headers, body: JSON.stringify({ name: DOMAIN }),
  });
  if (!r.ok) { const body = await r.text(); console.error(`HTTP ${r.status}: ${body}`); process.exit(1); }
  console.log(`✓ Attached (HTTP ${r.status})`);

  // Wait briefly + verify
  await new Promise((res) => setTimeout(res, 3000));
  const probe = await fetch(`https://${DOMAIN}/api/health`).catch(() => null);
  console.log(`Probe https://${DOMAIN}/api/health → ${probe ? `HTTP ${probe.status}` : 'no response'}`);
  process.exit(0);
})();
