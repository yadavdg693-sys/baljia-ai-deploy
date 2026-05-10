// Domain & Subdomain Service — migrated to Drizzle + Neon
import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import { deleteLandingHtml } from '@/lib/services/cf-deploy.service';

const log = createLogger('Domain');
const RENDER_API = 'https://api.render.com/v1';
const CF_API = 'https://api.cloudflare.com/client/v4';

export function isDomainServiceConfigured(): boolean {
  return !!(process.env.RENDER_API_KEY && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID_APP);
}

/**
 * Look up the actual onrender.com hostname Render assigned to this service.
 * Render appends a unique suffix (e.g. "threadpulse-wdpq.onrender.com"), so
 * the slug-based pattern "<slug>.onrender.com" is wrong and would 503.
 *
 * Used as the CNAME target for the company's baljia.app subdomain.
 */
async function getRenderServiceHostname(serviceId: string): Promise<string | null> {
  const token = process.env.RENDER_API_KEY;
  if (!token) return null;
  try {
    const r = await fetch(`${RENDER_API}/services/${serviceId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json() as { service?: { serviceDetails?: { url?: string } }; serviceDetails?: { url?: string } };
    const url = data.service?.serviceDetails?.url ?? data.serviceDetails?.url ?? '';
    if (!url) return null;
    return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  } catch (error) {
    log.error('Render service lookup error', { serviceId }, error);
    return null;
  }
}

/**
 * Free up one Render custom domain slot when the Hobby tier 2-domain cap is
 * hit. Strategy: prefer the safest deletion candidate.
 *
 * Priority order (highest = delete first):
 *   1. Unverified custom domains (verification failed/pending — likely stale)
 *   2. Domains attached to suspended services
 *   3. Domains attached to companies whose lifecycle is NOT trial/full active
 *
 * If none of the above apply, return null and let the caller surface the
 * quota error to the operator. Never delete the verified production domains
 * of active companies without explicit operator action.
 *
 * Returns the freed-up domain name (for logging) or null if nothing safe to
 * delete.
 */
async function freeUpRenderCustomDomainSlot(): Promise<string | null> {
  const token = process.env.RENDER_API_KEY;
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  try {
    const sr = await fetch(`${RENDER_API}/services?limit=50`, { headers });
    if (!sr.ok) return null;
    const services = await sr.json() as Array<{ service: { id: string; name: string; type: string; suspended?: string } }>;

    // Collect all custom domains with their service context.
    const allDomains: Array<{
      svcId: string; svcName: string; svcType: string; suspended: boolean;
      domainId: string; domainName: string; verificationStatus: string;
    }> = [];

    for (const s of services) {
      const svc = s.service;
      const dr = await fetch(`${RENDER_API}/services/${svc.id}/custom-domains?limit=10`, { headers });
      if (!dr.ok) continue;
      const domains = await dr.json() as Array<{ customDomain: { id: string; name: string; verificationStatus: string } }>;
      for (const d of domains) {
        allDomains.push({
          svcId: svc.id, svcName: svc.name, svcType: svc.type,
          suspended: svc.suspended === 'suspended',
          domainId: d.customDomain.id, domainName: d.customDomain.name,
          verificationStatus: d.customDomain.verificationStatus ?? 'unknown',
        });
      }
    }

    // Cross-reference with companies table to filter by lifecycle.
    let inactiveSlugs = new Set<string>();
    try {
      const allCompanies = await db.select({ slug: companies.slug, lifecycle: companies.lifecycle })
        .from(companies);
      for (const c of allCompanies) {
        if (c.slug && c.lifecycle && !['trial_active', 'full_active'].includes(c.lifecycle)) {
          inactiveSlugs.add(c.slug);
        }
      }
    } catch { /* non-blocking — fall back to verification-only check */ }

    // Pick deletion candidate by priority.
    const tier1 = allDomains.find((d) => d.verificationStatus !== 'verified');
    const tier2 = allDomains.find((d) => d.suspended);
    const tier3 = allDomains.find((d) => {
      const slug = d.domainName.split('.')[0];
      return inactiveSlugs.has(slug);
    });
    const candidate = tier1 ?? tier2 ?? tier3;

    if (!candidate) {
      log.warn('Render custom domain quota hit; no safe deletion candidate found', {
        totalDomains: allDomains.length,
        verifiedCount: allDomains.filter((d) => d.verificationStatus === 'verified').length,
      });
      return null;
    }

    log.info('Auto-freeing Render custom domain slot', {
      tier: tier1 ? 'unverified' : tier2 ? 'suspended-service' : 'inactive-company',
      domain: candidate.domainName,
      svc: candidate.svcName,
      verificationStatus: candidate.verificationStatus,
    });

    const dr = await fetch(`${RENDER_API}/services/${candidate.svcId}/custom-domains/${candidate.domainId}`, {
      method: 'DELETE', headers,
    });
    if (!dr.ok) {
      log.error('Failed to delete custom domain for slot recovery', { domain: candidate.domainName, status: dr.status });
      return null;
    }
    return candidate.domainName;
  } catch (err) {
    log.error('freeUpRenderCustomDomainSlot threw', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function renderAddCustomDomain(serviceId: string, domain: string, retryAfterCleanup = true): Promise<{ id: string; verificationStatus: string } | null> {
  const token = process.env.RENDER_API_KEY;
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  try {
    const response = await fetch(`${RENDER_API}/services/${serviceId}/custom-domains`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: domain }),
    });
    if (response.ok) {
      const data = await response.json() as { id?: string; customDomain?: { id: string; verificationStatus: string } };
      const result = data.customDomain ?? data;
      return { id: (result as { id: string }).id, verificationStatus: (result as { verificationStatus: string }).verificationStatus ?? 'pending' };
    }

    // Idempotency: Render returns 4xx (typically 422 with "name is already in use")
    // when the domain is already attached to this service. Fetch the existing one
    // instead of failing — re-running provisionSubdomain on a recovered company
    // shouldn't be a hard error.
    if (response.status === 409 || response.status === 422 || response.status === 400) {
      const errBody = await response.text().catch(() => '');
      const looksAlreadyAttached = /already (in use|exists|attached)/i.test(errBody);
      if (looksAlreadyAttached) {
        const listRes = await fetch(`${RENDER_API}/services/${serviceId}/custom-domains?limit=50`, { headers });
        if (listRes.ok) {
          const listData = await listRes.json() as Array<{ customDomain: { id: string; name: string; verificationStatus: string } }>;
          const existing = listData.find((x) => x.customDomain?.name === domain);
          if (existing) {
            log.info('Render custom domain already attached — reusing existing', { serviceId, domain, customDomainId: existing.customDomain.id });
            return { id: existing.customDomain.id, verificationStatus: existing.customDomain.verificationStatus ?? 'pending' };
          }
        }
      }

      // Hobby tier 2-domain quota: try to auto-free a slot, then retry once.
      const isQuotaError = /Hobby Tier is limited|custom domains?/i.test(errBody);
      if (isQuotaError && retryAfterCleanup) {
        log.warn('Render custom domain quota hit; attempting auto-cleanup', { serviceId, domain });
        const freed = await freeUpRenderCustomDomainSlot();
        if (freed) {
          log.info('Slot freed; retrying attach', { freed, domain });
          return renderAddCustomDomain(serviceId, domain, false); // retryAfterCleanup=false to prevent loop
        }
        log.error('Render custom domain quota hit; no safe slot to free', { serviceId, domain });
      }

      log.error('Render custom domain failed', { serviceId, domain, status: response.status, body: errBody.slice(0, 200) });
      return null;
    }

    log.error('Render custom domain failed', { serviceId, domain, status: response.status });
    return null;
  } catch (error) { log.error('Render domain attach error', { serviceId, domain }, error); return null; }
}

async function cloudflareCreateDNS(
  subdomain: string,
  target: string,
  type: 'CNAME' | 'MX' | 'TXT' = 'CNAME',
  proxied: boolean | undefined = undefined, // undefined → default by type (CNAME proxied, others not)
): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP;
  if (!token || !zoneId) return false;
  try {
    const proxiedFlag = proxied !== undefined ? proxied : type === 'CNAME';
    const body: Record<string, unknown> = { type, name: subdomain, content: target, proxied: proxiedFlag, ttl: 1 };
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
async function cloudflareReplaceDNS(
  subdomain: string,
  target: string,
  type: 'CNAME' | 'MX' | 'TXT' = 'CNAME',
  proxied: boolean | undefined = undefined,
): Promise<boolean> {
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
    const listResult = await listRes.json() as { success: boolean; result?: Array<{ id: string; content: string; proxied?: boolean }> };
    const existing = listResult.success ? (listResult.result ?? []) : [];

    // A record is "fully correct" only when both content AND proxied flag
    // match. The skip-if-content-matches version of this loop missed proxy
    // flips, so e.g. a parking CNAME proxied:true would never be re-pointed
    // to a Render service with proxied:false.
    const wantProxied = proxied !== undefined ? proxied : type === 'CNAME';

    // 2. Delete every matching record that doesn't already match BOTH fields
    for (const record of existing) {
      if (record.content === target && record.proxied === wantProxied) continue;
      await fetch(`${CF_API}/zones/${zoneId}/dns_records/${record.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      log.info('Cloudflare DNS record deleted (will recreate)', {
        subdomain: fqdn,
        oldTarget: record.content,
        oldProxied: record.proxied,
        newTarget: target,
        newProxied: wantProxied,
      });
    }

    // 3. If there was already a fully-correct record (content + proxied), done.
    if (existing.some((r) => r.content === target && r.proxied === wantProxied)) return true;
  } catch (err) {
    log.warn('Cloudflare DNS list/delete failed — falling back to create', {
      subdomain: fqdn,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Create the new record (forward proxied flag so callers can opt out
  // of the wildcard-worker interception for Render-served subdomains).
  return cloudflareCreateDNS(subdomain, target, type, proxied);
}

/**
 * Wildcard-aware subdomain provisioner for Cloudflare Workers deploys (ADR-002).
 *
 * Unlike `provisionSubdomain` (which creates per-company DNS records pointing
 * at a specific Render service), this function assumes a single wildcard
 * `*.baljia.app` CNAME is already configured on the baljia.app zone and
 * pointed at the founder-app Worker. Per-founder routing happens inside the
 * Worker by reading the Host header.
 *
 * This function therefore just writes the subdomain to the company record.
 * No CF API calls are required per-founder.
 *
 * Prerequisites (one-time, done out-of-band):
 *   1. CNAME `*.baljia.app` → founder-app Worker (e.g. baljia-founder-apps.workers.dev)
 *   2. Worker route `*.baljia.app/*` → founder-app-worker script
 *   3. R2 bucket exists with founder-apps/ prefix
 *
 * Idempotent: safe to call twice with the same slug.
 */
export async function provisionWildcardSubdomain(
  companyId: string,
  slug: string,
): Promise<{ domain: string; status: 'wildcard' } | null> {
  const domain = `${slug}.baljia.app`;
  try {
    await db
      .update(companies)
      .set({ subdomain: slug, custom_domain: domain })
      .where(eq(companies.id, companyId));
    log.info('Wildcard subdomain provisioned', { companyId, domain });
    return { domain, status: 'wildcard' };
  } catch (error) {
    log.error('Wildcard subdomain provisioning failed', { companyId, slug }, error);
    return null;
  }
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

  // The CNAME must target the actual Render-assigned hostname (e.g.
  // "threadpulse-wdpq.onrender.com"), NOT the slug-based pattern
  // "<slug>.onrender.com" — Render appends a unique suffix per service and
  // the slug-only hostname returns 503.
  const renderHostname = await getRenderServiceHostname(renderServiceId);
  if (!renderHostname) {
    log.error('Could not resolve Render hostname for service', { renderServiceId });
    return null;
  }

  // Use REPLACE not CREATE — at this point a parking CNAME may already exist
  // from the initial onboarding pass, and CREATE would silently no-op without
  // repointing it to the new Render service.
  //
  // proxied:false (DNS-only / "gray cloud") — bypasses the *.baljia.app
  // wildcard worker route so traffic actually reaches Render. Onboarding's
  // landing pages stay on the proxied/CF path; engineering-deployed apps
  // take the direct DNS-to-Render path. (Architectural intent: CF for
  // onboarding-generated content, Render for engineering-agent deployments.)
  await cloudflareReplaceDNS(slug, renderHostname, 'CNAME', false);
  const renderDomain = await renderAddCustomDomain(renderServiceId, domain);
  if (!renderDomain) { log.error('Failed to attach domain on Render', { domain }); return null; }

  // Symmetric handoff: now that Render is serving this subdomain, the old
  // CF/R2 onboarding landing is unreachable (DNS-only CNAME bypasses the
  // wildcard worker). Delete the R2 object so we don't carry stale state.
  // Non-blocking — a failed cleanup must not fail the deploy.
  try {
    const removed = await deleteLandingHtml(slug);
    if (removed) log.info('Onboarding landing removed from R2 (engineering deploy took over)', { slug });
  } catch (err) {
    log.warn('R2 landing cleanup failed (non-blocking)', { slug, err: err instanceof Error ? err.message : String(err) });
  }

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
