// Trial → Paid migration: lift founder's app from CF Worker to Render web service.
//
// Flow (~3-5 min total):
//   1. cf_read_app_source       → fetch live Worker JS from CF
//   2. buildRenderScaffold      → wrap CF Worker into Node http server (3 files)
//   3. pushFilesToGitHub        → commit to founder's BALAJIapps/<slug> repo
//   4. createRenderService      → spin up Render web service from repo
//   5. waitForRenderHealthy     → poll the Render URL until 200
//   6. swapDnsToRender          → point <slug>.baljia.app at Render
//   7. tearDownCfWorker         → delete CF Worker + route (only after Render verified)
//   8. update companies row     → record render_service_id, hosting_state, etc.
//
// Atomic invariant: CF Worker stays live until Render confirmed responding. Worst
// case is a brief overlap (both serving for 1-2 min during DNS cutover) — never
// downtime.
//
// Failures are recoverable — each step is idempotent and logged. If step N fails,
// caller can retry from step N (the orchestrator reads current state and skips
// completed steps).

import { db, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  getWorkerScriptSource,
  deleteWorkerScript,
  deleteWorkerRoute,
} from './cf-deploy.service';
import { provisionCompanyRepo } from './github.service';
import { createLogger } from './../logger';

const log = createLogger('TrialPaidMigration');
const GITHUB_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';
const CF_API = 'https://api.cloudflare.com/client/v4';

function workerScriptName(subdomain: string): string {
  return `baljia-app-${subdomain}`;
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function renderHeaders(): Record<string, string> {
  const token = process.env.RENDER_API_KEY;
  if (!token) throw new Error('RENDER_API_KEY not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

// ══════════════════════════════════════════════
// 1. SCAFFOLD — Worker → Node-runnable server
// ══════════════════════════════════════════════

export interface RenderScaffold {
  'worker.js': string;
  'server.js': string;
  'package.json': string;
  'README.md': string;
  '.gitignore': string;
}

/**
 * Wrap a CF Worker (export default { fetch }) into a Node http server.
 * The wrapper translates Node http.IncomingMessage → fetch Request, calls
 * the Worker's fetch handler, and writes the Response back to Node's
 * http.ServerResponse. No CF-specific runtime needed.
 *
 * Assumes the legacy Worker uses the raw-fetch Neon pattern (no
 * @neondatabase/serverless import). If a future archived Worker imports npm
 * deps, this scaffold needs to detect them and add package.json dependencies.
 */
export function buildRenderScaffold(params: {
  workerSource: string;
  subdomain: string;
  companyId: string;
}): RenderScaffold {
  const { workerSource, subdomain, companyId } = params;

  const serverJs = `// Auto-generated bridge: runs a Cloudflare Worker on Node http.
// Translates Node Request → fetch Request, calls export default.fetch,
// writes Response back as Node http response. No external dependencies.

import http from 'node:http';
import workerModule from './worker.js';

const port = Number(process.env.PORT) || 3000;

const env = {
  NEON_URL: process.env.NEON_URL,
  COMPANY_ID: process.env.COMPANY_ID,
  COMPANY_SUBDOMAIN: process.env.COMPANY_SUBDOMAIN,
  PLATFORM_API_BASE: process.env.PLATFORM_API_BASE || 'https://baljia.ai',
  // Any additional secrets are read from process.env.<NAME> at request time
  // by the Worker — we don't need to enumerate them here.
};

const server = http.createServer(async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || 'localhost';
    const url = \`\${protocol}://\${host}\${req.url || '/'}\`;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(', '));
      else if (typeof v === 'string') headers.set(k, v);
    }

    let body;
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (chunks.length > 0) body = Buffer.concat(chunks);
    }

    const fetchReq = new Request(url, { method: req.method, headers, body });
    const fetchRes = await workerModule.fetch(fetchReq, env, {});

    res.statusCode = fetchRes.status;
    fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
    const arr = await fetchRes.arrayBuffer();
    res.end(Buffer.from(arr));
  } catch (err) {
    console.error('handler error', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: err && err.message || 'internal error' }));
  }
});

server.listen(port, () => {
  console.log(\`Worker-on-Node listening on \${port}\`);
});
`;

  const packageJson = JSON.stringify({
    name: `baljia-app-${subdomain}`,
    version: '1.0.0',
    type: 'module',
    main: 'server.js',
    scripts: {
      start: 'node server.js',
    },
    engines: { node: '>=20' },
  }, null, 2);

  const readme = `# ${subdomain}.baljia.app

Migrated from Cloudflare Workers to Render on $(date).

Originally deployed via Baljia AI's engineering agent during the trial period.
Migrated to Render after subscription conversion (company \`${companyId}\`).

## Files

- \`worker.js\` — Cloudflare Worker module (the original deployed code)
- \`server.js\` — Node http server that runs the Worker (auto-generated bridge)
- \`package.json\` — Node package config

## Deploy

This repo is connected to a Render web service that auto-deploys on push to \`main\`.
Future modifications: edit \`worker.js\`, push, Render redeploys.

## Environment

Set these in Render dashboard:
- \`NEON_URL\` — your Neon DB connection string
- \`COMPANY_ID\` — your Baljia company UUID
- \`COMPANY_SUBDOMAIN\` — \`${subdomain}\`
- \`PLATFORM_API_BASE\` — \`https://baljia.ai\`
`;

  const gitignore = `node_modules/
.env
.env.local
*.log
`;

  return {
    'worker.js': workerSource,
    'server.js': serverJs,
    'package.json': packageJson,
    'README.md': readme,
    '.gitignore': gitignore,
  };
}

// ══════════════════════════════════════════════
// 2. PUSH — write scaffold files to GitHub repo
// ══════════════════════════════════════════════

async function pushFileToRepo(repo: string, path: string, content: string, message: string): Promise<boolean> {
  // GitHub PUT /repos/{owner}/{repo}/contents/{path} — auto-creates or updates
  const url = `${GITHUB_API}/repos/${repo}/contents/${path}`;
  const headers = githubHeaders();

  // Get current SHA if file exists (required for update)
  let sha: string | undefined;
  try {
    const existing = await fetch(`${url}?ref=main`, { headers });
    if (existing.ok) {
      const data = await existing.json() as { sha?: string };
      sha = data.sha;
    }
  } catch { /* file likely doesn't exist; proceed without sha */ }

  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch: 'main',
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    log.warn('GitHub push failed', { repo, path, status: res.status, body: text.slice(0, 300) });
    return false;
  }
  return true;
}

export async function pushScaffoldToRepo(repo: string, scaffold: RenderScaffold, commitMessage: string): Promise<{ success: boolean; pushed: string[]; failed: string[] }> {
  const pushed: string[] = [];
  const failed: string[] = [];
  for (const [path, content] of Object.entries(scaffold)) {
    const ok = await pushFileToRepo(repo, path, content, commitMessage);
    if (ok) pushed.push(path);
    else failed.push(path);
  }
  return { success: failed.length === 0, pushed, failed };
}

// ══════════════════════════════════════════════
// 3. RENDER — create web service from the repo
// ══════════════════════════════════════════════

export interface RenderServiceParams {
  repo: string;          // "BALAJIapps/<slug>"
  serviceName: string;   // "baljia-app-<slug>"
  envVars: Record<string, string>;
  region?: string;       // default "oregon"
}

export interface RenderServiceResult {
  serviceId: string;
  serviceUrl: string;    // The .onrender.com URL
  dashboardUrl: string;
}

export async function createRenderServiceFromRepo(params: RenderServiceParams): Promise<RenderServiceResult | null> {
  const ownerId = process.env.RENDER_OWNER_ID;
  if (!ownerId) {
    log.error('RENDER_OWNER_ID not configured — required for service creation');
    return null;
  }

  const repoUrl = `https://github.com/${params.repo}`;
  const region = params.region ?? 'oregon';

  const body = {
    type: 'web_service',
    name: params.serviceName,
    ownerId,
    repo: repoUrl,
    branch: 'main',
    autoDeploy: 'yes',
    serviceDetails: {
      runtime: 'node',
      env: 'node',
      region,
      plan: 'starter',  // $7/mo
      buildCommand: 'npm install',
      startCommand: 'npm start',
      envSpecificDetails: {
        buildCommand: 'npm install',
        startCommand: 'npm start',
      },
    },
    envVars: Object.entries(params.envVars).map(([key, value]) => ({ key, value })),
  };

  try {
    const res = await fetch(`${RENDER_API}/services`, {
      method: 'POST',
      headers: renderHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.error('Render create service failed', { status: res.status, body: text.slice(0, 500) });
      return null;
    }
    const data = await res.json() as { service?: { id?: string; serviceDetails?: { url?: string }; dashboardUrl?: string } };
    if (!data.service?.id) {
      log.error('Render create returned no service id', { data });
      return null;
    }
    return {
      serviceId: data.service.id,
      serviceUrl: data.service.serviceDetails?.url ?? `https://${params.serviceName}.onrender.com`,
      dashboardUrl: data.service.dashboardUrl ?? `https://dashboard.render.com/web/${data.service.id}`,
    };
  } catch (err) {
    log.error('Render create service error', {}, err);
    return null;
  }
}

// ══════════════════════════════════════════════
// 4. HEALTH WAIT — poll until Render serves 200
// ══════════════════════════════════════════════

export async function waitForRenderHealthy(url: string, timeoutMs = 240_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200) {
        log.info('Render service healthy', { url, attempts });
        return true;
      }
      if (attempts % 6 === 0) log.info('Still waiting for Render', { url, status: res.status, attempts });
    } catch (err) {
      // Connection refused / DNS not ready / building — keep waiting
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  log.warn('Render service did not become healthy', { url, attempts });
  return false;
}

// ══════════════════════════════════════════════
// 5. DNS SWAP — point <slug>.baljia.app at Render
// ══════════════════════════════════════════════

/**
 * Swap the CF DNS record for <slug>.baljia.app from CF Worker route to a
 * CNAME pointing at the Render service.
 *
 * Why CNAME and not the existing wildcard route: CF Worker routes are matched
 * BEFORE DNS-level routing if they exist. We need to delete the per-subdomain
 * Worker route, then create a CNAME (proxied) → Render's hostname.
 */
async function deleteRenderService(serviceId: string): Promise<boolean> {
  try {
    const res = await fetch(`${RENDER_API}/services/${serviceId}`, {
      method: 'DELETE',
      headers: renderHeaders(),
    });

    if (res.ok || res.status === 404) {
      log.info('Render service deleted or already absent', { serviceId, status: res.status });
      return true;
    }

    const body = await res.text().catch(() => '');
    log.warn('Render service delete failed', { serviceId, status: res.status, body: body.slice(0, 500) });
    return false;
  } catch (err) {
    log.warn('Render service delete threw', { serviceId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function swapDnsToRender(params: {
  subdomain: string;
  renderHostname: string;  // e.g. "baljia-app-foo.onrender.com"
}): Promise<{ success: boolean; recordId?: string }> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !apiToken) {
    log.error('CF DNS env not configured for swap');
    return { success: false };
  }

  const fullName = `${params.subdomain}.baljia.app`;
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };

  try {
    // Look for existing record at this name (could be wildcard catch-all)
    const listRes = await fetch(`${CF_API}/zones/${zoneId}/dns_records?name=${encodeURIComponent(fullName)}`, { headers });
    const listData = await listRes.json() as { result?: Array<{ id: string; type: string }> };
    const existing = listData.result?.[0];

    const recordBody = {
      type: 'CNAME',
      name: fullName,
      content: params.renderHostname,
      ttl: 60,        // low TTL for fast cutover
      proxied: true,  // keeps the CF edge benefits
    };

    let recordId: string | undefined;
    if (existing) {
      // Update existing
      const updateRes = await fetch(`${CF_API}/zones/${zoneId}/dns_records/${existing.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(recordBody),
      });
      if (!updateRes.ok) {
        const t = await updateRes.text().catch(() => '');
        log.error('CF DNS update failed', { fullName, status: updateRes.status, body: t.slice(0, 300) });
        return { success: false };
      }
      recordId = existing.id;
    } else {
      // Create new
      const createRes = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
        method: 'POST',
        headers,
        body: JSON.stringify(recordBody),
      });
      if (!createRes.ok) {
        const t = await createRes.text().catch(() => '');
        log.error('CF DNS create failed', { fullName, status: createRes.status, body: t.slice(0, 300) });
        return { success: false };
      }
      const data = await createRes.json() as { result?: { id: string } };
      recordId = data.result?.id;
    }

    log.info('CF DNS swapped to Render', { fullName, target: params.renderHostname, recordId });
    return { success: true, recordId };
  } catch (err) {
    log.error('CF DNS swap error', {}, err);
    return { success: false };
  }
}

// ══════════════════════════════════════════════
// 6. ORCHESTRATOR
// ══════════════════════════════════════════════

export interface MigrationResult {
  success: boolean;
  step?: string;          // Which step failed (if any)
  reason?: string;
  artifacts?: {
    githubRepo?: string;
    renderServiceId?: string;
    renderUrl?: string;
    finalUrl?: string;
  };
}

/**
 * Lift founder's app from CF Worker → Render web service.
 * Idempotent: each step is recoverable; re-running picks up where it left off.
 */
export async function migrateTrialToPaid(companyId: string): Promise<MigrationResult> {
  log.info('Starting trial→paid migration', { companyId });

  // 0. Load company state
  const [company] = await db
    .select({
      id: companies.id,
      slug: companies.slug,
      github_repo: companies.github_repo,
      neon_connection_string: companies.neon_connection_string,
      render_service_id: companies.render_service_id,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) return { success: false, reason: 'Company not found' };
  if (!company.slug) return { success: false, reason: 'Company has no slug' };
  if (company.render_service_id) {
    log.info('Migration already complete (render_service_id set)', { companyId, renderServiceId: company.render_service_id });
    return { success: true, artifacts: { renderServiceId: company.render_service_id } };
  }

  const subdomain = company.slug;

  // 1. Read current Worker source from CF
  const cfSource = await getWorkerScriptSource(workerScriptName(subdomain));
  if (!cfSource) {
    return { success: false, step: 'cf_read_app_source', reason: `No CF Worker found for ${subdomain}. Nothing to migrate.` };
  }
  log.info('Read CF Worker source', { companyId, bytes: cfSource.bytes });

  // 2. Build Render scaffold
  const scaffold = buildRenderScaffold({
    workerSource: cfSource.source,
    subdomain,
    companyId,
  });

  // 3. Ensure GitHub repo exists
  let repoFullName = company.github_repo;
  if (!repoFullName) {
    const repo = await provisionCompanyRepo(companyId, subdomain);
    if (!repo?.full_name) {
      return { success: false, step: 'provision_repo', reason: 'Failed to create GitHub repo' };
    }
    repoFullName = repo.full_name;
    await db.update(companies).set({ github_repo: repoFullName }).where(eq(companies.id, companyId));
  }

  // 4. Push scaffold to repo
  const push = await pushScaffoldToRepo(repoFullName, scaffold,
    `Trial→Paid migration: convert CF Worker to Node http server\n\nOriginal Worker source preserved verbatim in worker.js. server.js is an auto-generated bridge that runs the Worker on Node.`);
  if (!push.success) {
    return { success: false, step: 'github_push', reason: `Failed to push: ${push.failed.join(', ')}` };
  }
  log.info('Pushed scaffold to GitHub', { repo: repoFullName, files: push.pushed });

  // 5. Create Render service
  const envVars: Record<string, string> = {
    NEON_URL: company.neon_connection_string ?? '',
    COMPANY_ID: companyId,
    COMPANY_SUBDOMAIN: subdomain,
    PLATFORM_API_BASE: 'https://baljia.ai',
  };
  const renderService = await createRenderServiceFromRepo({
    repo: repoFullName,
    serviceName: `baljia-app-${subdomain}`,
    envVars,
  });
  if (!renderService) {
    return { success: false, step: 'render_create', reason: 'Failed to create Render service' };
  }
  await db.update(companies).set({ render_service_id: renderService.serviceId }).where(eq(companies.id, companyId));
  log.info('Render service created', { companyId, serviceId: renderService.serviceId, url: renderService.serviceUrl });

  // 6. Wait for Render to be healthy
  const healthy = await waitForRenderHealthy(renderService.serviceUrl, 240_000);
  if (!healthy) {
    return {
      success: false,
      step: 'render_health',
      reason: `Render service did not respond at ${renderService.serviceUrl} within 4 min`,
      artifacts: { githubRepo: repoFullName, renderServiceId: renderService.serviceId, renderUrl: renderService.serviceUrl },
    };
  }

  // 7. Swap DNS — CF still serving the Worker until this point
  // Extract hostname from serviceUrl (https://name.onrender.com → name.onrender.com)
  const renderHostname = new URL(renderService.serviceUrl).hostname;
  const dnsSwap = await swapDnsToRender({ subdomain, renderHostname });
  if (!dnsSwap.success) {
    return {
      success: false,
      step: 'dns_swap',
      reason: 'DNS swap failed — Render is healthy, CF Worker still live; manual DNS fix needed',
      artifacts: { githubRepo: repoFullName, renderServiceId: renderService.serviceId, renderUrl: renderService.serviceUrl },
    };
  }

  // 8. Tear down CF Worker — only after Render is confirmed serving
  // First get the route id for cleanup
  try {
    const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN!;
    const listRes = await fetch(`${CF_API}/zones/${zoneId}/workers/routes`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const listData = await listRes.json() as { result?: Array<{ id: string; script: string }> };
    const route = listData.result?.find((r) => r.script === workerScriptName(subdomain));
    if (route) {
      await deleteWorkerRoute(route.id);
      log.info('CF route deleted', { companyId, routeId: route.id });
    }
  } catch (err) {
    log.warn('CF route cleanup failed (non-fatal)', { companyId, error: err instanceof Error ? err.message : String(err) });
  }

  try {
    await deleteWorkerScript(workerScriptName(subdomain));
    log.info('CF Worker script deleted', { companyId, scriptName: workerScriptName(subdomain) });
  } catch (err) {
    log.warn('CF Worker delete failed (non-fatal)', { companyId, error: err instanceof Error ? err.message : String(err) });
  }

  // 9. Update company state
  await db.update(companies).set({
    hosting_state: 'live',
    custom_domain: `${subdomain}.baljia.app`,
  }).where(eq(companies.id, companyId));

  log.info('Migration complete', {
    companyId,
    githubRepo: repoFullName,
    renderServiceId: renderService.serviceId,
    finalUrl: `https://${subdomain}.baljia.app`,
  });

  return {
    success: true,
    artifacts: {
      githubRepo: repoFullName,
      renderServiceId: renderService.serviceId,
      renderUrl: renderService.serviceUrl,
      finalUrl: `https://${subdomain}.baljia.app`,
    },
  };
}

// ══════════════════════════════════════════════
// PHASE 3 — TRIAL EXPIRY ARCHIVAL
// Trial ended without conversion. The current founder-app runtime is Render,
// so expiry tears down the Render service and preserves the GitHub repo. The
// old CF Worker cleanup remains only as a legacy fallback for pre-Render apps.
// ══════════════════════════════════════════════

export interface ArchiveResult {
  success: boolean;
  reason?: string;
  artifacts?: {
    githubRepo?: string;
    renderServiceId?: string;
    bytesArchived?: number;
  };
}

/**
 * Archive a trial-expired company's live app.
 * Idempotent: safe to retry. Render is the current app runtime; CF Worker
 * archival only exists for older trial apps created before the Render switch.
 *
 * Trust signal for non-converters: their code is preserved at github.com/
 * BALAJIapps/{slug}, recoverable any time. They lose the live URL but
 * not the work.
 */
export async function archiveExpiredTrialApp(companyId: string): Promise<ArchiveResult> {
  log.info('Archiving expired trial app', { companyId });

  const [company] = await db
    .select({
      id: companies.id,
      slug: companies.slug,
      github_repo: companies.github_repo,
      render_service_id: companies.render_service_id,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) return { success: false, reason: 'Company not found' };
  if (!company.slug) return { success: false, reason: 'Company has no slug' };

  const subdomain = company.slug;

  // Current path: trial apps run on Render from the company GitHub repo.
  // On expiry, delete the Render service to stop cost and mark hosting
  // suspended. The repo remains intact, so the founder's code is preserved.
  if (company.render_service_id) {
    const deleted = await deleteRenderService(company.render_service_id);
    if (!deleted) {
      return {
        success: false,
        reason: `Failed to delete Render service ${company.render_service_id}`,
        artifacts: {
          githubRepo: company.github_repo ?? undefined,
          renderServiceId: company.render_service_id,
        },
      };
    }

    await db.update(companies).set({
      render_service_id: null,
      hosting_state: 'suspended',
    }).where(eq(companies.id, companyId));

    log.info('Render trial service archived', {
      companyId,
      repo: company.github_repo,
      renderServiceId: company.render_service_id,
    });

    return {
      success: true,
      artifacts: {
        githubRepo: company.github_repo ?? undefined,
        renderServiceId: company.render_service_id,
      },
    };
  }

  // Legacy fallback: read current Worker source. If no Worker exists, still
  // mark hosting suspended so expired companies do not remain "live" forever.
  const cfSource = await getWorkerScriptSource(workerScriptName(subdomain));
  if (!cfSource) {
    log.info('No CF Worker to archive', { companyId, subdomain });
    await db.update(companies).set({ hosting_state: 'suspended' }).where(eq(companies.id, companyId));
    return { success: true, artifacts: {} };
  }

  // 2. Ensure GitHub repo exists
  let repoFullName = company.github_repo;
  if (!repoFullName) {
    const repo = await provisionCompanyRepo(companyId, subdomain);
    if (!repo?.full_name) {
      return { success: false, reason: 'Failed to create GitHub repo for archival' };
    }
    repoFullName = repo.full_name;
    await db.update(companies).set({ github_repo: repoFullName }).where(eq(companies.id, companyId));
  }

  // 3. Push worker.js + a README explaining the archive
  const today = new Date().toISOString().split('T')[0];
  const archiveReadme = `# ${subdomain} (archived ${today})

This repository contains the Cloudflare Worker code that powered
${subdomain}.baljia.app during your Baljia trial.

The trial period ended without subscription. The live app was taken down,
but your code is preserved here verbatim.

## Recover

Subscribe to Baljia anytime — we'll redeploy this code for you in minutes.
Or clone this repo and deploy it elsewhere (Cloudflare Workers, Render,
Vercel, your own server) — it's standard ES-module Worker code.

## Files

- \`worker.js\` — the Cloudflare Worker source as it was running on day ${today}
`;

  const workerPushOk = await pushFileToRepo(
    repoFullName,
    'worker.js',
    cfSource.source,
    `Trial expired ${today} — code preserved (final commit before takedown)`,
  );
  const readmePushOk = await pushFileToRepo(
    repoFullName,
    'README.md',
    archiveReadme,
    `Trial expired ${today} — archive notice`,
  );
  if (!workerPushOk || !readmePushOk) {
    return { success: false, reason: 'Failed to push archive to GitHub', artifacts: { githubRepo: repoFullName } };
  }
  log.info('Archive pushed to GitHub', { companyId, repo: repoFullName, bytes: cfSource.bytes });

  // 4. Tear down CF Worker + route
  try {
    const zoneId = process.env.CLOUDFLARE_ZONE_ID_APP!;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN!;
    const listRes = await fetch(`${CF_API}/zones/${zoneId}/workers/routes`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const listData = await listRes.json() as { result?: Array<{ id: string; script: string }> };
    const route = listData.result?.find((r) => r.script === workerScriptName(subdomain));
    if (route) {
      await deleteWorkerRoute(route.id);
      log.info('CF route deleted', { companyId, routeId: route.id });
    }
  } catch (err) {
    log.warn('CF route cleanup failed during archive (non-fatal)', { companyId, error: err instanceof Error ? err.message : String(err) });
  }

  try {
    await deleteWorkerScript(workerScriptName(subdomain));
    log.info('CF Worker deleted on archive', { companyId, scriptName: workerScriptName(subdomain) });
  } catch (err) {
    log.warn('CF Worker delete failed during archive (non-fatal)', { companyId, error: err instanceof Error ? err.message : String(err) });
  }

  // 5. Update company state — hosting_state archived, app no longer live
  await db.update(companies).set({
    hosting_state: 'suspended',  // 'archived' isn't a hosting_state enum value; suspended is closest
  }).where(eq(companies.id, companyId));

  log.info('Archive complete', { companyId, repo: repoFullName });
  return {
    success: true,
    artifacts: {
      githubRepo: repoFullName,
      bytesArchived: cfSource.bytes,
    },
  };
}
