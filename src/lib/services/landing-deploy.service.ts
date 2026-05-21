// Landing Deploy Service — pushes the generated landing page to the configured
// deploy target and makes it live at {slug}.baljia.app.
//
// Onboarding landing pages use Cloudflare + R2. Founder app engineering tasks
// deploy separately to Render web services.
//
// Called from the onboarding pipeline AFTER generate_landing_page and BEFORE
// send_welcome_email, so the welcome email's "Company website" link is live.
//
// Required env (CF primary):     CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//                                CLOUDFLARE_ZONE_ID_APP, R2_* (see cf-deploy.service)
// Optional dev-only Render fallback: ALLOW_RENDER_LANDING_FALLBACK=true plus
//                                  GITHUB_TOKEN, GITHUB_ORG, RENDER_API_KEY,
//                                  RENDER_OWNER_ID
//
// Idempotent on both paths.

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { provisionSubdomain } from '@/lib/services/domain.service';
import {
  uploadLandingHtml,
  landingHtmlExists,
  isCloudflareDeployConfigured,
} from '@/lib/services/cf-deploy.service';
import { createLogger } from '@/lib/logger';

const log = createLogger('LandingDeploy');
const GITHUB_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function renderHeaders() {
  const token = process.env.RENDER_API_KEY;
  if (!token) throw new Error('RENDER_API_KEY not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function githubOrg(): string {
  return process.env.GITHUB_ORG ?? 'baljia-ai';
}

function isRenderLandingConfigured(): boolean {
  if (process.env.ALLOW_RENDER_LANDING_FALLBACK !== 'true') return false;
  return !!(
    process.env.GITHUB_TOKEN &&
    process.env.RENDER_API_KEY &&
    process.env.RENDER_OWNER_ID
  );
}

/**
 * Returns true if Cloudflare landing deploy is configured, or an explicit
 * dev-only Render fallback is enabled. Production onboarding should use CF/R2.
 */
export function isLandingDeployConfigured(): boolean {
  return isCloudflareDeployConfigured() || isRenderLandingConfigured();
}

/** Returns which deploy target will be used given current env. */
export function getLandingDeployTarget(): 'cloudflare' | 'render' | 'none' {
  if (isCloudflareDeployConfigured()) return 'cloudflare';
  if (isRenderLandingConfigured()) return 'render';
  return 'none';
}

interface DeployParams {
  companyId: string;
  slug: string;
  companyName: string;
  landingHtml: string;
}

export interface DeployResult {
  /** Deploy target used */
  target: 'cloudflare' | 'render';
  /** Public URL of the live landing page */
  url: string;
  /** CF R2 key (when target=cloudflare) */
  r2Key?: string;
  /** GitHub repo full name (when target=render; empty for cloudflare) */
  repo?: string;
  /** Render service ID (when target=render; empty for cloudflare) */
  serviceId?: string;
}

// ══════════════════════════════════════════════
// PUBLIC ENTRY POINT
// ══════════════════════════════════════════════

export async function deployLandingPage(params: DeployParams): Promise<DeployResult | null> {
  const target = getLandingDeployTarget();

  if (target === 'cloudflare') {
    return deployLandingPageCF(params);
  }
  if (target === 'render') {
    log.info('CF not configured — using explicitly enabled Render landing fallback', { slug: params.slug });
    return deployLandingPageRender(params);
  }

  log.warn('Landing deploy not configured (Cloudflare missing, Render fallback disabled) — skipping', { slug: params.slug });
  return null;
}

// ══════════════════════════════════════════════
// CLOUDFLARE PATH (primary, ADR-002)
// ══════════════════════════════════════════════

async function deployLandingPageCF(params: DeployParams): Promise<DeployResult | null> {
  const { companyId, slug, landingHtml } = params;

  // Idempotency: if the R2 asset already exists for this subdomain AND the company
  // record already has this subdomain, treat as a no-op (return existing URL).
  const [existing] = await db
    .select({ subdomain: companies.subdomain })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const alreadyInDb = existing?.subdomain === slug;
  const alreadyOnR2 = await landingHtmlExists(slug);

  if (alreadyInDb && alreadyOnR2) {
    log.info('CF landing already deployed — skipping', { companyId, slug });
    return {
      target: 'cloudflare',
      url: `https://${slug}.baljia.app`,
      r2Key: `founder-apps/${slug}/index.html`,
    };
  }

  // 1. Upload HTML to R2
  const upload = await uploadLandingHtml({ subdomain: slug, html: landingHtml });
  if (!upload) {
    log.error('CF landing upload failed', { companyId, slug });
    return null;
  }

  // 2. Persist subdomain on company record (also flags "deployed" via presence)
  await db
    .update(companies)
    .set({
      subdomain: slug,
      custom_domain: `${slug}.baljia.app`,
    })
    .where(eq(companies.id, companyId));

  log.info('CF landing deployed', {
    companyId,
    slug,
    url: upload.url,
    r2Key: upload.key,
    bytes: landingHtml.length,
  });

  return {
    target: 'cloudflare',
    url: upload.url,
    r2Key: upload.key,
  };
}

// ══════════════════════════════════════════════
// RENDER PATH (legacy fallback — behavior preserved from previous implementation)
// ══════════════════════════════════════════════

async function deployLandingPageRender(params: DeployParams): Promise<DeployResult | null> {
  const { companyId, slug, companyName, landingHtml } = params;

  // Idempotency: if company already has a Render service, don't redeploy
  const [existing] = await db
    .select({
      render_service_id: companies.render_service_id,
      github_repo: companies.github_repo,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (existing?.render_service_id) {
    log.info('Render landing already deployed — skipping', {
      companyId,
      slug,
      serviceId: existing.render_service_id,
    });
    return {
      target: 'render',
      url: `https://${slug}.baljia.app`,
      repo: existing.github_repo ?? `${githubOrg()}/${slug}-site`,
      serviceId: existing.render_service_id,
    };
  }

  const repoName = `${slug}-site`;
  const org = githubOrg();
  const repoFullName = `${org}/${repoName}`;

  // 1. Create GitHub repo (treat 422 "already exists" as success)
  const createRes = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
    method: 'POST',
    headers: githubHeaders(),
    body: JSON.stringify({
      name: repoName,
      description: `Landing page for ${companyName} — built by Baljia AI`,
      private: false,
      auto_init: true,
      gitignore_template: 'Node',
    }),
  });

  if (!createRes.ok && createRes.status !== 422) {
    const err = (await createRes.json().catch(() => ({}))) as { message?: string };
    log.error('GitHub repo creation failed', { repoName, status: createRes.status, error: err.message });
    return null;
  }
  log.info('GitHub repo ready', { repoFullName, status: createRes.status });

  // 2. Push index.html
  const pushOk = await pushFile(repoFullName, 'index.html', landingHtml, 'Initial landing page from onboarding');
  if (!pushOk) return null;

  // 3. Push minimal render.yaml
  const renderYaml = [
    'services:',
    `  - type: web`,
    `    name: ${slug}-landing`,
    `    runtime: static`,
    `    buildCommand: ":"`,
    `    staticPublishPath: ./`,
    '',
  ].join('\n');
  await pushFile(repoFullName, 'render.yaml', renderYaml, 'Add render.yaml for static deploy');

  // 4. Create Render static site service
  const serviceRes = await fetch(`${RENDER_API}/services`, {
    method: 'POST',
    headers: renderHeaders(),
    body: JSON.stringify({
      type: 'static_site',
      name: `${slug}-landing`,
      ownerId: process.env.RENDER_OWNER_ID,
      repo: `https://github.com/${repoFullName}`,
      branch: 'main',
      autoDeploy: 'yes',
      buildCommand: ':',
      staticPublishPath: './',
    }),
  });

  if (!serviceRes.ok) {
    const err = (await serviceRes.json().catch(() => ({}))) as { message?: string };
    log.error('Render service creation failed', { repoName, status: serviceRes.status, error: err.message });
    return null;
  }

  const serviceData = (await serviceRes.json()) as { service?: { id?: string }; id?: string };
  const serviceId = serviceData.service?.id ?? serviceData.id;
  if (!serviceId) {
    log.error('Render returned no service ID', { repoName });
    return null;
  }

  // 5. Save IDs to company record
  await db
    .update(companies)
    .set({ github_repo: repoFullName, render_service_id: serviceId })
    .where(eq(companies.id, companyId));

  // 6. Re-attach subdomain
  let url = `https://${slug}.baljia.app`;
  try {
    const result = await provisionSubdomain(companyId, slug, serviceId);
    if (result?.domain) url = `https://${result.domain}`;
    log.info('Subdomain re-attached to live service', { slug, serviceId, status: result?.status });
  } catch (err) {
    log.warn('Subdomain re-attach failed — DNS may need manual fix', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  log.info('Render landing page deployed', { companyId, slug, repo: repoFullName, serviceId, url });
  return {
    target: 'render',
    url,
    repo: repoFullName,
    serviceId,
  };
}

// ══════════════════════════════════════════════
// Internal: push a file to GitHub (create or update via SHA)
// ══════════════════════════════════════════════

async function pushFile(repoFullName: string, path: string, content: string, message: string): Promise<boolean> {
  const headers = githubHeaders();

  let sha: string | undefined;
  const existingRes = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/contents/${encodeURIComponent(path)}?ref=main`,
    { headers },
  );
  if (existingRes.ok) {
    const existing = (await existingRes.json()) as { sha?: string };
    sha = existing.sha;
  }

  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch: 'main',
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `${GITHUB_API}/repos/${repoFullName}/contents/${encodeURIComponent(path)}`,
    { method: 'PUT', headers, body: JSON.stringify(body) },
  );

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    log.error('GitHub file push failed', { repoFullName, path, error: err.message });
    return false;
  }
  return true;
}
