// Domain & Subdomain Service — migrated to Drizzle + Neon
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('Domain');
const RENDER_API = 'https://api.render.com/v1';
const CF_API = 'https://api.cloudflare.com/client/v4';

export function isDomainServiceConfigured(): boolean {
  return !!(process.env.RENDER_API_KEY && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID_APP);
}

async function renderAddCustomDomain(serviceId: string, domain: string): Promise<{ id: string; verificationStatus: string } | null> {
  const token = process.env.RENDER_API_KEY;
  if (!token) return null;
  try {
    const response = await fetch(`${RENDER_API}/services/${serviceId}/custom-domains`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: domain }),
    });
    if (!response.ok) { log.error('Render custom domain failed', { serviceId, domain }); return null; }
    const data = await response.json() as { id?: string; customDomain?: { id: string; verificationStatus: string } };
    const result = data.customDomain ?? data;
    return { id: (result as { id: string }).id, verificationStatus: (result as { verificationStatus: string }).verificationStatus ?? 'pending' };
  } catch (error) { log.error('Render domain attach error', { serviceId, domain }, error); return null; }
}

async function cloudflareCreateDNS(subdomain: string, target: string, type: 'CNAME' | 'MX' | 'TXT' = 'CNAME'): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP;
  if (!token || !zoneId) return false;
  try {
    const body: Record<string, unknown> = { type, name: subdomain, content: target, proxied: type === 'CNAME', ttl: 1 };
    if (type === 'MX') body.priority = 10;
    const response = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json() as { success: boolean; errors?: Array<{ message: string }> };
    if (!result.success) {
      const errMsg = result.errors?.[0]?.message ?? 'Unknown';
      if (errMsg.includes('already exists')) return true;
      log.error('Cloudflare DNS create failed', { subdomain, type, error: errMsg }); return false;
    }
    return true;
  } catch (error) { log.error('Cloudflare DNS error', { subdomain }, error); return false; }
}

/**
 * Replace (delete + create) a DNS record so the content is updated even if the
 * record already exists. cloudflareCreateDNS silently returns true on "already
 * exists" without updating the target — that breaks the parking → real Render
 * swap. Use this when you specifically need the target to be the new value.
 */
async function cloudflareReplaceDNS(subdomain: string, target: string, type: 'CNAME' | 'MX' | 'TXT' = 'CNAME'): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP;
  if (!token || !zoneId) return false;

  // 1. Find existing records matching {name, type}
  const fqdn = subdomain.includes('.') ? subdomain : `${subdomain}.baljia.app`;
  try {
    const listRes = await fetch(
      `${CF_API}/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(fqdn)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const listResult = await listRes.json() as { success: boolean; result?: Array<{ id: string; content: string }> };
    const existing = listResult.success ? (listResult.result ?? []) : [];

    // 2. Delete every matching record (handles duplicates from earlier mistakes)
    for (const record of existing) {
      if (record.content === target) continue; // already correct — leave it
      await fetch(`${CF_API}/zones/${zoneId}/dns_records/${record.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      log.info('Cloudflare DNS record deleted (will recreate)', { subdomain: fqdn, oldTarget: record.content });
    }

    // 3. If there was already a correctly-pointed record, we're done
    if (existing.some((r) => r.content === target)) return true;
  } catch (err) {
    log.warn('Cloudflare DNS list/delete failed — falling back to create', {
      subdomain: fqdn,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Create the new record
  return cloudflareCreateDNS(subdomain, target, type);
}

export async function provisionSubdomain(companyId: string, slug: string, renderServiceId: string): Promise<{ domain: string; status: string } | null> {
  if (!isDomainServiceConfigured()) { log.warn('Domain service not configured', { slug }); return null; }
  const domain = `${slug}.baljia.app`;

  // A2 FIX: When renderServiceId is empty, create DNS CNAME pointing to parking page only.
  // Engineering agent re-attaches to Render when it creates the service later.
  if (!renderServiceId) {
    await cloudflareCreateDNS(slug, 'parking.baljia.app');
    await db.update(companies).set({ subdomain: slug, custom_domain: domain }).where(eq(companies.id, companyId));
    log.info('Subdomain provisioned (parking — no Render service yet)', { companyId, domain });
    return { domain, status: 'parking' };
  }

  // Use REPLACE not CREATE — at this point a parking CNAME may already exist
  // from the initial onboarding pass, and CREATE would silently no-op without
  // repointing it to the new Render service.
  await cloudflareReplaceDNS(slug, `${slug}.onrender.com`);
  const renderDomain = await renderAddCustomDomain(renderServiceId, domain);
  if (!renderDomain) { log.error('Failed to attach domain on Render', { domain }); return null; }

  await db.update(companies).set({ subdomain: slug, custom_domain: domain }).where(eq(companies.id, companyId));
  log.info('Subdomain provisioned', { companyId, domain });
  return { domain, status: renderDomain.verificationStatus };
}

export async function getCompanyDomain(companyId: string): Promise<{ subdomain: string | null; customDomain: string | null; websiteUrl: string | null; emailAddress: string | null }> {
  const [data] = await db.select({ subdomain: companies.subdomain, custom_domain: companies.custom_domain }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!data?.subdomain) return { subdomain: null, customDomain: null, websiteUrl: null, emailAddress: null };
  return {
    subdomain: data.subdomain,
    customDomain: data.custom_domain !== `${data.subdomain}.baljia.app` ? data.custom_domain : null,
    websiteUrl: `https://${data.custom_domain ?? `${data.subdomain}.baljia.app`}`,
    emailAddress: `${data.subdomain}@baljia.app`,
  };
}

export async function attachCustomDomain(companyId: string, customDomain: string): Promise<{ domain: string; status: string; dnsInstructions: string } | null> {
  const [company] = await db.select({ render_service_id: companies.render_service_id, slug: companies.slug }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.render_service_id) { log.error('No Render service found', { companyId }); return null; }

  const cleanDomain = customDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/^www\./, '').toLowerCase().trim();
  const renderResult = await renderAddCustomDomain(company.render_service_id, cleanDomain);
  if (!renderResult) return null;

  await renderAddCustomDomain(company.render_service_id, `www.${cleanDomain}`).catch(() => {});
  await db.update(companies).set({ custom_domain: cleanDomain }).where(eq(companies.id, companyId));

  return { domain: cleanDomain, status: renderResult.verificationStatus, dnsInstructions: getDNSInstructions(cleanDomain, company.render_service_id) };
}

function getDNSInstructions(domain: string, renderServiceId: string): string {
  return [`## DNS Setup for ${domain}`, '', 'Add these records at your domain registrar:', '', '| Type  | Name | Value |', '|-------|------|-------|', `| CNAME | @    | \`${renderServiceId}.onrender.com\` |`, `| CNAME | www  | \`${renderServiceId}.onrender.com\` |`, '', '> **Note:** Some DNS providers don\'t allow CNAME on root (@). Use ALIAS/ANAME or Cloudflare.', '', '**After setting DNS records:** SSL auto-provisioned by Render (5-15 minutes).'].join('\n');
}

export async function verifyCustomDomain(companyId: string): Promise<{ domain: string; verified: boolean; sslReady: boolean } | null> {
  const [company] = await db.select({ custom_domain: companies.custom_domain, render_service_id: companies.render_service_id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.custom_domain || !company?.render_service_id) return null;

  const token = process.env.RENDER_API_KEY;
  if (!token) return null;

  try {
    const response = await fetch(`${RENDER_API}/services/${company.render_service_id}/custom-domains`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!response.ok) return null;
    const domains = await response.json() as Array<{ customDomain: { name: string; verificationStatus: string } }>;
    const match = domains.find(d => d.customDomain.name === company.custom_domain);
    if (!match) return null;
    return { domain: company.custom_domain!, verified: match.customDomain.verificationStatus === 'verified', sslReady: match.customDomain.verificationStatus === 'verified' };
  } catch { return null; }
}
