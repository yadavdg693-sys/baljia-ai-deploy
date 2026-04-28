// Cloudflare Deploy Service — the Engineering agent's deploy target for
// founder apps hosted at *.baljia.app on Cloudflare Workers + R2.
//
// This service replaces the Render-specific deploy path in
// landing-deploy.service.ts and the engineering.tools.ts Render tools for
// founder-app deploys. The platform itself stays on Render (see ADR-002).
//
// Required env:
//   CLOUDFLARE_API_TOKEN       — scoped: Workers Scripts Write, Workers Routes, DNS
//   CLOUDFLARE_ACCOUNT_ID      — target CF account for Workers API
//   CLOUDFLARE_ZONE_ID_APP     — zone ID for baljia.app
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
//                              — R2 credentials for landing HTML uploads (already wired)
//
// Idempotency contract: every function here is safe to call twice. Uploads
// overwrite, routes de-duplicate by pattern, secrets replace.
//
// No top-level env reads. All reads happen inside functions so this module
// imports cleanly in environments where CF env isn't set (scripts, CI).

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createLogger } from '@/lib/logger';

const log = createLogger('CFDeploy');
const CF_API = 'https://api.cloudflare.com/client/v4';

// All outbound fetches get a timeout so a hanging CF API call can't stall the
// Engineering worker up to the 4hr watchdog. 30s is generous for CF's APIs
// which typically respond in <1s.
const CF_FETCH_TIMEOUT_MS = 30_000;
// Live-verify fetches an attacker-influenceable URL (LLM-generated HTML) so use
// a stricter timeout + bounded body to prevent SSRF-ish stalls and memory blowup.
const VERIFY_FETCH_TIMEOUT_MS = 15_000;
const VERIFY_MAX_BODY_BYTES = 64 * 1024; // 64 KB is plenty for a landing-page verify snippet

function cfFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(CF_FETCH_TIMEOUT_MS) });
}

// ══════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════

export function isCloudflareDeployConfigured(): boolean {
  return !!(
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_ZONE_ID_APP &&
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

function cfApiHeaders(): Record<string, string> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function cfAccountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) throw new Error('CLOUDFLARE_ACCOUNT_ID not configured');
  return id;
}

function cfZoneIdApp(): string {
  const id = process.env.CLOUDFLARE_ZONE_ID_APP;
  if (!id) throw new Error('CLOUDFLARE_ZONE_ID_APP not configured');
  return id;
}

// ══════════════════════════════════════════════
// R2 CLIENT — separate from storage.service.ts because founder-app deploys
// need DETERMINISTIC keys (subdomain-based), not random nanoid keys.
// ══════════════════════════════════════════════

let r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (r2Client) return r2Client;
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }
  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return r2Client;
}

function getR2Bucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error('R2_BUCKET_NAME not configured');
  return bucket;
}

/** Deterministic R2 key for a founder-app landing page. */
export function landingHtmlKey(subdomain: string): string {
  return `founder-apps/${subdomain}/index.html`;
}

// ══════════════════════════════════════════════
// TIER 1 — LANDING HTML VIA R2
// The wildcard Worker serves these by reading R2 with key derived from Host.
// ══════════════════════════════════════════════

export interface UploadLandingParams {
  subdomain: string;
  html: string;
}

export interface UploadLandingResult {
  key: string;
  url: string;          // https://{subdomain}.baljia.app
  bucketUrl: string;    // direct R2 URL (for debugging)
}

export async function uploadLandingHtml(params: UploadLandingParams): Promise<UploadLandingResult | null> {
  const { subdomain, html } = params;
  if (!isCloudflareDeployConfigured()) {
    log.warn('CF deploy not configured — landing upload skipped', { subdomain });
    return null;
  }

  try {
    const client = getR2Client();
    const key = landingHtmlKey(subdomain);
    const body = Buffer.from(html, 'utf-8');

    await client.send(new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
      Body: body,
      ContentType: 'text/html; charset=utf-8',
      Metadata: {
        'subdomain': subdomain,
        'tier': '1',
        'uploaded-at': new Date().toISOString(),
      },
    }));

    log.info('Landing HTML uploaded to R2', { subdomain, key, bytes: body.byteLength });
    return {
      key,
      url: `https://${subdomain}.baljia.app`,
      bucketUrl: `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`,
    };
  } catch (error) {
    log.error('Landing HTML upload failed', { subdomain }, error);
    return null;
  }
}

export async function landingHtmlExists(subdomain: string): Promise<boolean> {
  if (!isCloudflareDeployConfigured()) return false;
  try {
    const client = getR2Client();
    await client.send(new HeadObjectCommand({
      Bucket: getR2Bucket(),
      Key: landingHtmlKey(subdomain),
    }));
    return true;
  } catch {
    return false;
  }
}

export async function getLandingHtml(subdomain: string): Promise<string | null> {
  if (!isCloudflareDeployConfigured()) return null;
  try {
    const client = getR2Client();
    const response = await client.send(new GetObjectCommand({
      Bucket: getR2Bucket(),
      Key: landingHtmlKey(subdomain),
    }));
    if (!response.Body) return null;
    const chunks: Uint8Array[] = [];
    // @ts-expect-error — Body is an async-iterable Readable stream
    for await (const chunk of response.Body) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf-8');
  } catch (error) {
    log.error('Landing HTML fetch failed', { subdomain }, error);
    return null;
  }
}

export async function deleteLandingHtml(subdomain: string): Promise<boolean> {
  if (!isCloudflareDeployConfigured()) return false;
  try {
    const client = getR2Client();
    await client.send(new DeleteObjectCommand({
      Bucket: getR2Bucket(),
      Key: landingHtmlKey(subdomain),
    }));
    log.info('Landing HTML deleted from R2', { subdomain });
    return true;
  } catch (error) {
    log.error('Landing HTML delete failed', { subdomain }, error);
    return false;
  }
}

// ══════════════════════════════════════════════
// TIER 2/3 — WORKER SCRIPT UPLOAD
// For founders who need custom code (Shape 2 per ADR-002 §System Design).
// Shape 1 (wildcard Worker) uses the template deployed once out-of-band; these
// functions only run for Shape 2 per-founder deploys.
// ══════════════════════════════════════════════

export interface WorkerBinding {
  type: 'plain_text' | 'secret_text' | 'kv_namespace' | 'r2_bucket' | 'd1_database' | 'service' | 'durable_object_namespace';
  name: string;
  /** For plain_text / secret_text */
  text?: string;
  /** For kv_namespace / r2_bucket / d1_database */
  namespace_id?: string;
  bucket_name?: string;
  database_id?: string;
  /** For service */
  service?: string;
  environment?: string;
  /** For durable_object_namespace */
  class_name?: string;
  script_name?: string;
}

export interface DeployWorkerParams {
  scriptName: string;
  /** ES module source. Must export default { fetch, scheduled? }. */
  scriptContent: string;
  bindings?: WorkerBinding[];
  /** Compatibility date — matches wrangler.toml default */
  compatibilityDate?: string;
  compatibilityFlags?: string[];
}

export interface DeployWorkerResult {
  scriptName: string;
  etag: string;
  deployedAt: string;
}

export async function deployWorkerScript(params: DeployWorkerParams): Promise<DeployWorkerResult | null> {
  const { scriptName, scriptContent, bindings = [], compatibilityDate = '2025-03-01', compatibilityFlags = ['nodejs_compat'] } = params;
  if (!isCloudflareDeployConfigured()) {
    log.warn('CF deploy not configured — worker upload skipped', { scriptName });
    return null;
  }

  try {
    // Workers Scripts API uses multipart/form-data:
    //   - Part 'metadata' (JSON) — bindings, compatibility_date, main_module
    //   - Part '<filename>' (JavaScript module) — the script itself
    const metadata = {
      main_module: 'worker.mjs',
      bindings,
      compatibility_date: compatibilityDate,
      compatibility_flags: compatibilityFlags,
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('worker.mjs', new Blob([scriptContent], { type: 'application/javascript+module' }), 'worker.mjs');

    const url = `${CF_API}/accounts/${cfAccountId()}/workers/scripts/${encodeURIComponent(scriptName)}`;
    const response = await cfFetch(url, {
      method: 'PUT',
      headers: cfApiHeaders(), // Do NOT set Content-Type; fetch sets the multipart boundary
      body: form,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.error('CF worker upload failed', { scriptName, status: response.status, body: text.slice(0, 500) });
      return null;
    }

    const data = (await response.json()) as { success: boolean; result?: { etag?: string; created_on?: string; modified_on?: string } };
    if (!data.success) {
      log.error('CF worker upload returned success=false', { scriptName, data });
      return null;
    }

    log.info('CF worker uploaded', { scriptName, etag: data.result?.etag });
    return {
      scriptName,
      etag: data.result?.etag ?? 'unknown',
      deployedAt: data.result?.modified_on ?? data.result?.created_on ?? new Date().toISOString(),
    };
  } catch (error) {
    log.error('CF worker upload error', { scriptName }, error);
    return null;
  }
}

export async function deleteWorkerScript(scriptName: string): Promise<boolean> {
  if (!isCloudflareDeployConfigured()) return false;
  try {
    const url = `${CF_API}/accounts/${cfAccountId()}/workers/scripts/${encodeURIComponent(scriptName)}`;
    const response = await cfFetch(url, { method: 'DELETE', headers: cfApiHeaders() });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.error('CF worker delete failed', { scriptName, status: response.status, body: text.slice(0, 300) });
      return false;
    }
    log.info('CF worker deleted', { scriptName });
    return true;
  } catch (error) {
    log.error('CF worker delete error', { scriptName }, error);
    return false;
  }
}

// ══════════════════════════════════════════════
// WORKER ROUTES
// Wildcard *.baljia.app route is set up ONCE (on first deploy). Per-founder
// deploys in Shape 2 would add additional routes — not needed for Shape 1.
// ══════════════════════════════════════════════

export interface WorkerRouteParams {
  pattern: string;     // e.g. "*.baljia.app/*"
  scriptName: string;
}

export interface WorkerRouteResult {
  id: string;
  pattern: string;
  scriptName: string;
}

export async function addWorkerRoute(params: WorkerRouteParams): Promise<WorkerRouteResult | null> {
  const { pattern, scriptName } = params;
  if (!isCloudflareDeployConfigured()) {
    log.warn('CF deploy not configured — route add skipped', { pattern });
    return null;
  }

  try {
    // First, check if a route already exists with this pattern — idempotent.
    const listUrl = `${CF_API}/zones/${cfZoneIdApp()}/workers/routes`;
    const listRes = await cfFetch(listUrl, { headers: cfApiHeaders() });
    if (listRes.ok) {
      const listData = (await listRes.json()) as {
        success: boolean;
        result?: Array<{ id: string; pattern: string; script: string }>;
      };
      const existing = listData.success ? (listData.result ?? []).find((r) => r.pattern === pattern) : null;
      if (existing) {
        if (existing.script === scriptName) {
          log.info('CF route already exists with correct script', { pattern, scriptName });
          return { id: existing.id, pattern, scriptName };
        }
        // Pattern exists but points at different script — update it
        const updateUrl = `${CF_API}/zones/${cfZoneIdApp()}/workers/routes/${existing.id}`;
        const updateRes = await cfFetch(updateUrl, {
          method: 'PUT',
          headers: { ...cfApiHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ pattern, script: scriptName }),
        });
        if (!updateRes.ok) {
          const text = await updateRes.text().catch(() => '');
          log.error('CF route update failed', { pattern, status: updateRes.status, body: text.slice(0, 300) });
          return null;
        }
        log.info('CF route updated to new script', { pattern, scriptName, oldScript: existing.script });
        return { id: existing.id, pattern, scriptName };
      }
    }

    // Route does not exist — create it
    const createRes = await cfFetch(listUrl, {
      method: 'POST',
      headers: { ...cfApiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, script: scriptName }),
    });
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '');
      log.error('CF route create failed', { pattern, status: createRes.status, body: text.slice(0, 300) });
      return null;
    }
    const data = (await createRes.json()) as { success: boolean; result?: { id: string } };
    if (!data.success || !data.result?.id) {
      log.error('CF route create returned unexpected shape', { pattern, data });
      return null;
    }

    log.info('CF route created', { pattern, scriptName, id: data.result.id });
    return { id: data.result.id, pattern, scriptName };
  } catch (error) {
    log.error('CF route add error', { pattern, scriptName }, error);
    return null;
  }
}

export async function deleteWorkerRoute(routeId: string): Promise<boolean> {
  if (!isCloudflareDeployConfigured()) return false;
  try {
    const url = `${CF_API}/zones/${cfZoneIdApp()}/workers/routes/${routeId}`;
    const response = await cfFetch(url, { method: 'DELETE', headers: cfApiHeaders() });
    if (!response.ok) {
      log.error('CF route delete failed', { routeId, status: response.status });
      return false;
    }
    log.info('CF route deleted', { routeId });
    return true;
  } catch (error) {
    log.error('CF route delete error', { routeId }, error);
    return false;
  }
}

// ══════════════════════════════════════════════
// WORKER SECRETS
// Per-founder secrets (e.g. per-company Neon URL) scoped to a Worker script.
// Only relevant in Shape 2 per-founder deploys.
// ══════════════════════════════════════════════

export interface PutSecretParams {
  scriptName: string;
  key: string;
  value: string;
}

export async function putWorkerSecret(params: PutSecretParams): Promise<boolean> {
  const { scriptName, key, value } = params;
  if (!isCloudflareDeployConfigured()) return false;
  try {
    const url = `${CF_API}/accounts/${cfAccountId()}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`;
    const response = await cfFetch(url, {
      method: 'PUT',
      headers: { ...cfApiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: key, text: value, type: 'secret_text' }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.error('CF secret put failed', { scriptName, key, status: response.status, body: text.slice(0, 300) });
      return false;
    }
    log.info('CF secret put', { scriptName, key });
    return true;
  } catch (error) {
    log.error('CF secret put error', { scriptName, key }, error);
    return false;
  }
}

export async function deleteWorkerSecret(scriptName: string, key: string): Promise<boolean> {
  if (!isCloudflareDeployConfigured()) return false;
  try {
    const url = `${CF_API}/accounts/${cfAccountId()}/workers/scripts/${encodeURIComponent(scriptName)}/secrets/${encodeURIComponent(key)}`;
    const response = await cfFetch(url, { method: 'DELETE', headers: cfApiHeaders() });
    if (!response.ok) {
      log.error('CF secret delete failed', { scriptName, key, status: response.status });
      return false;
    }
    log.info('CF secret deleted', { scriptName, key });
    return true;
  } catch (error) {
    log.error('CF secret delete error', { scriptName, key }, error);
    return false;
  }
}

// ══════════════════════════════════════════════
// DEPLOY INFO (for diagnostics)
// ══════════════════════════════════════════════

export interface WorkerScriptInfo {
  scriptName: string;
  etag: string;
  createdOn: string;
  modifiedOn: string;
  usageModel?: string;
}

export async function getWorkerScriptInfo(scriptName: string): Promise<WorkerScriptInfo | null> {
  if (!isCloudflareDeployConfigured()) return null;
  try {
    const url = `${CF_API}/accounts/${cfAccountId()}/workers/scripts/${encodeURIComponent(scriptName)}`;
    const response = await cfFetch(url, { headers: cfApiHeaders() });
    if (!response.ok) return null;
    const etag = response.headers.get('etag') ?? 'unknown';
    // CF returns the script body here, not metadata. Use /subdomain endpoint for meta.
    // For info purposes we'll just report availability + etag.
    return {
      scriptName,
      etag,
      createdOn: new Date().toISOString(),
      modifiedOn: new Date().toISOString(),
    };
  } catch (error) {
    log.error('CF script info error', { scriptName }, error);
    return null;
  }
}

export interface WorkerScriptSource {
  scriptName: string;
  source: string;        // Full ES-module source code (the actual Worker JS)
  etag: string;
  bytes: number;
}

/**
 * Fetch the deployed Worker source code back from CF.
 *
 * CF's GET /accounts/{id}/workers/scripts/{name} actually returns the script
 * body directly (or a multipart bundle for module Workers). For modification
 * tasks the engineering agent needs to read what's currently running before
 * editing. Without this tool, "fix bug X in my app" forces the agent to
 * regenerate the whole Worker from scratch and risk losing prior customization.
 *
 * Returns null if the script doesn't exist (404) or CF is unreachable.
 */
export async function getWorkerScriptSource(scriptName: string): Promise<WorkerScriptSource | null> {
  if (!isCloudflareDeployConfigured()) return null;
  try {
    const url = `${CF_API}/accounts/${cfAccountId()}/workers/scripts/${encodeURIComponent(scriptName)}`;
    const response = await cfFetch(url, { headers: cfApiHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) {
      log.warn('CF getWorkerScriptSource non-ok', { scriptName, status: response.status });
      return null;
    }

    const etag = response.headers.get('etag') ?? 'unknown';
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    // Module Workers (the shape we deploy via deployWorkerScript) come back as
    // multipart/form-data with 'metadata' + the module file(s). Older service
    // workers return the script body directly. Detect and extract.
    let source = body;
    if (contentType.includes('multipart/form-data')) {
      // Extract the first non-metadata part. The boundary lives in Content-Type.
      const boundaryMatch = /boundary=([^;]+)/.exec(contentType);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1].replace(/^"|"$/g, '');
        const parts = body.split(`--${boundary}`);
        // Find the part whose content-type is JS (skip 'metadata' JSON part).
        const jsPart = parts.find((p) =>
          /content-type:\s*application\/javascript/i.test(p) ||
          /content-disposition:[^\n]*name="?worker\.mjs"?/i.test(p)
        );
        if (jsPart) {
          // Strip leading headers + trailing boundary marker.
          const headerEnd = jsPart.indexOf('\r\n\r\n');
          if (headerEnd >= 0) {
            source = jsPart.slice(headerEnd + 4).replace(/\r\n--\s*$/, '').trim();
          }
        }
      }
    }

    return {
      scriptName,
      source,
      etag,
      bytes: source.length,
    };
  } catch (error) {
    log.error('CF getWorkerScriptSource error', { scriptName }, error);
    return null;
  }
}

// ══════════════════════════════════════════════
// LOGS — Workers GraphQL Analytics API
// ══════════════════════════════════════════════
//
// Returns per-minute aggregates of worker invocations grouped by HTTP status
// and outcome (ok / exception / exceededCpu / scriptThrew / canceled). This is
// what's available without WebSocket-based Tail sessions and is enough for the
// most common diagnostic question: "is the worker erroring, and at what rate?"
//
// For console.log capture and per-request exception messages, a Tail-based
// follow-up tool is the next step (requires a WebSocket session).

export interface WorkerLogBucket {
  /** ISO-8601 minute boundary, e.g. "2026-04-25T08:30:00Z" */
  minute: string;
  status: number;
  /** ok | exception | exceededCpu | exceededMemory | scriptThrew | canceled | unknown */
  outcome: string;
  requests: number;
  errors: number;
  subrequests: number;
}

export interface GetWorkerLogsParams {
  scriptName: string;
  /** Lookback in minutes (default 60, max 1440 = 24h) */
  sinceMinutes?: number;
  /** Max rows returned (default 100, hard max 500) */
  limit?: number;
}

const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

export async function getWorkerLogs(params: GetWorkerLogsParams): Promise<WorkerLogBucket[] | null> {
  if (!isCloudflareDeployConfigured()) return null;

  const sinceMinutes = Math.max(1, Math.min(params.sinceMinutes ?? 60, 1440));
  const limit = Math.max(1, Math.min(params.limit ?? 100, 500));
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

  const query = `
    query WorkerInvocations($accountTag: String!, $scriptName: String!, $since: Time!, $limit: Int!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            limit: $limit,
            filter: { datetime_geq: $since, scriptName: $scriptName },
            orderBy: [datetimeMinute_DESC]
          ) {
            sum { requests errors subrequests }
            dimensions { datetimeMinute status outcome }
          }
        }
      }
    }
  `;

  try {
    const response = await cfFetch(CF_GRAPHQL, {
      method: 'POST',
      headers: { ...cfApiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { accountTag: cfAccountId(), scriptName: params.scriptName, since, limit },
      }),
    });

    if (!response.ok) {
      log.warn('CF GraphQL non-2xx', { status: response.status, scriptName: params.scriptName });
      return null;
    }

    const json = await response.json() as {
      data?: {
        viewer?: {
          accounts?: Array<{
            workersInvocationsAdaptive?: Array<{
              sum: { requests: number; errors: number; subrequests: number };
              dimensions: { datetimeMinute: string; status: number; outcome: string };
            }>;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      log.warn('CF GraphQL errors', { errors: json.errors.map((e) => e.message), scriptName: params.scriptName });
      return null;
    }

    const rows = json.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];
    return rows.map((r) => ({
      minute: r.dimensions.datetimeMinute,
      status: r.dimensions.status,
      outcome: r.dimensions.outcome,
      requests: r.sum.requests,
      errors: r.sum.errors,
      subrequests: r.sum.subrequests,
    }));
  } catch (error) {
    log.error('CF getWorkerLogs error', { scriptName: params.scriptName }, error);
    return null;
  }
}

/**
 * Reach the live URL and return the HTTP status + body snippet for verification.
 * Useful in the Engineering agent's verifier step post-deploy.
 *
 * Hardening (post-audit):
 *   - 15s timeout (tighter than CF API calls, since we're hitting an
 *     attacker-influenceable URL — the R2 HTML is LLM-generated)
 *   - Bounded body read (64 KB cap) — no `.text()` on unbounded bodies
 *   - `redirect: 'manual'` — never follow redirects, no SSRF to internal hosts
 *   - Subdomain regex re-validation (defense in depth; handlers already validate)
 */
export async function verifyFounderAppLive(subdomain: string): Promise<{ status: number; bodySnippet: string; elapsedMs: number } | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(subdomain)) {
    log.warn('verifyFounderAppLive rejected invalid subdomain', { subdomain });
    return null;
  }
  const url = `https://${subdomain}.baljia.app`;
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'BaljiaDeployVerifier/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(VERIFY_FETCH_TIMEOUT_MS),
    });
    const elapsedMs = Date.now() - start;

    // Bounded body read — never more than VERIFY_MAX_BODY_BYTES. Prevents
    // memory blowup on a huge uploaded HTML and limits slow-drip transfers.
    let bodySnippet = '';
    const reader = response.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            chunks.push(value);
            if (total >= VERIFY_MAX_BODY_BYTES) {
              await reader.cancel().catch(() => undefined);
              break;
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
      }
      bodySnippet = new TextDecoder('utf-8', { fatal: false })
        .decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
        .slice(0, 500);
    }

    return {
      status: response.status,
      bodySnippet,
      elapsedMs,
    };
  } catch (error) {
    log.error('Founder app live verify failed', { subdomain }, error);
    return { status: 0, bodySnippet: (error as Error).message, elapsedMs: Date.now() - start };
  }
}
