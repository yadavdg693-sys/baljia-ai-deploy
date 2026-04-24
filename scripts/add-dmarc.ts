// Add DMARC records for all Baljia zones.
// Monitoring mode (p=none) on active senders — just collects alignment reports
// via RUA. Zero risk of blocking legitimate mail. Upgrade to p=quarantine /
// p=reject after 2-4 weeks of clean RUA reports.
// baljia.org gets p=reject since it should never send mail (anti-spoof defense).

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const ZONES: Array<{ name: string; id: string; policy: 'none' | 'reject' }> = [
  { name: 'baljia.ai',  id: '0d4d1043757a4be6621936e55b5404f0', policy: 'none' },
  { name: 'baljia.app', id: '6d2a0810a2addc8a639241936a4bf5d0', policy: 'none' },
  { name: 'baljia.org', id: 'e5e805391cad0bc92e2ff59aae56b424', policy: 'reject' },
];

const RUA_EMAIL = 'yadavdg4@gmail.com';  // aggregate reports destination

function buildDmarcValue(policy: 'none' | 'reject'): string {
  return `v=DMARC1; p=${policy}; rua=mailto:${RUA_EMAIL}; ruf=mailto:${RUA_EMAIL}; fo=1; adkim=r; aspf=r; pct=100`;
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN not set');

  for (const zone of ZONES) {
    const dmarcName = `_dmarc.${zone.name}`;
    const dmarcValue = buildDmarcValue(zone.policy);

    // Check if a DMARC record already exists
    const listRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?type=TXT&name=${encodeURIComponent(dmarcName)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const listJson = (await listRes.json()) as { result: Array<{ id: string; content: string }> };
    const existing = listJson.result.find((r) => r.content.includes('v=DMARC1'));

    if (existing) {
      console.log(`[${zone.name}] DMARC already exists:`);
      console.log(`  ${existing.content}`);
      console.log(`  (skipping — delete first if you want to replace)`);
      continue;
    }

    // Create the record
    const createRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'TXT',
          name: dmarcName,
          content: dmarcValue,
          ttl: 3600,
          comment: `DMARC ${zone.policy === 'none' ? 'monitoring' : 'enforcement (no sending expected)'} — added by ADR-002 wrap-up`,
        }),
      },
    );
    const json = (await createRes.json()) as {
      success: boolean;
      result?: { id: string; name: string; content: string };
      errors?: Array<{ message: string }>;
    };
    if (!json.success) {
      console.error(`[${zone.name}] FAIL:`, json.errors);
      continue;
    }
    console.log(`[${zone.name}] ✅ DMARC added (policy=${zone.policy}):`);
    console.log(`  record id: ${json.result?.id}`);
    console.log(`  value: ${dmarcValue}`);
  }

  console.log('\nNext steps:');
  console.log(`  1. Wait 5-10 minutes for DNS propagation`);
  console.log(`  2. Check with: nslookup -type=TXT _dmarc.baljia.ai 8.8.8.8`);
  console.log(`  3. Expect RUA aggregate reports at ${RUA_EMAIL} within 24h (from Gmail, Yahoo, etc.)`);
  console.log(`  4. After 2-4 weeks of clean reports, upgrade baljia.ai + baljia.app to p=quarantine, then p=reject`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
