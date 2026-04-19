// Landing Deploy Service — pushes the generated landing page to GitHub
// and deploys it as a Render static site at {slug}.baljia.app.
//
// Called from the onboarding pipeline AFTER generate_landing_page and BEFORE
// send_welcome_email, so the welcome email's "Company website" link is live.
//
// Required env: GITHUB_TOKEN, GITHUB_ORG, RENDER_API_KEY, RENDER_OWNER_ID
// Optional env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID_APP (for subdomain swap)
//
// Idempotent: if the company already has a render_service_id, this is a no-op.

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { provisionSubdomain } from '@/lib/services/domain.service';
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

export function isLandingDeployConfigured(): boolean {
  return !!(
    process.env.GITHUB_TOKEN &&
    process.env.RENDER_API_KEY &&
    process.env.RENDER_OWNER_ID
  );
}

interface DeployParams {
  companyId: string;
  slug: string;
  companyName: string;
  landingHtml: string;
}

interface DeployResult {
  repo: string;
  serviceId: string;
  url: string;
}

export async function deployLandingPage(params: DeployParams): Promise<DeployResult | null> {
  const { companyId, slug, companyName, landingHtml } = params;

  if (!isLandingDeployConfigured()) {
    log.warn('Landing deploy not configured (missing GITHUB_TOKEN / RENDER_API_KEY / RENDER_OWNER_ID) — skipping', { slug });
    return null;
  }

  // Idempotency: if company already has a Render service, don't redeploy
  const [existing] = await db.select({
    render_service_id: companies.render_service_id,
    github_repo: companies.github_repo,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (existing?.render_service_id) {
    log.info('Landing already deployed — skipping', { companyId, slug, serviceId: existing.render_service_id });
    return {
      repo: existing.github_repo ?? `${githubOrg()}/${slug}-site`,
      serviceId: existing.render_service_id,
      url: `https://${slug}.baljia.app`,
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

  // 2. Push index.html (PUT contents — handles create + update via SHA)
  const pushOk = await pushFile(repoFullName, 'index.html', landingHtml, 'Initial landing page from onboarding');
  if (!pushOk) return null;

  // 3. Push a minimal render.yaml so Render knows this is a static site with no build
  // (also makes the repo self-describing for future engineering-agent edits)
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

  // 4. Create Render static site service pointing at the repo
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
      buildCommand: ':',          // POSIX no-op — pure static HTML, no build step
      staticPublishPath: './',    // serve index.html from repo root
    }),
  });

  if (!serviceRes.ok) {
    const err = (await serviceRes.json().catch(() => ({}))) as { message?: string };
    log.error('Render service creation failed', { repoName, status: serviceRes.status, error: err.message });
    return null;
  }

  const serviceData = (await serviceRes.json()) as {
    service?: { id?: string };
    id?: string;
  };
  const serviceId = serviceData.service?.id ?? serviceData.id;
  if (!serviceId) {
    log.error('Render returned no service ID', { repoName });
    return null;
  }

  // 5. Save IDs to company record
  await db.update(companies)
    .set({ github_repo: repoFullName, render_service_id: serviceId })
    .where(eq(companies.id, companyId));

  // 6. Re-attach subdomain: swap parking CNAME → real Render service
  // provisionSubdomain handles the DNS replace + Render custom-domain add
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

  log.info('Landing page deployed', { companyId, slug, repo: repoFullName, serviceId, url });
  return { repo: repoFullName, serviceId, url };
}

// ──────────────────────────────────────────────
// Internal: push a file to GitHub (create or update via SHA)
// ──────────────────────────────────────────────

async function pushFile(repoFullName: string, path: string, content: string, message: string): Promise<boolean> {
  const headers = githubHeaders();

  // Get SHA if file exists (needed for update)
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
