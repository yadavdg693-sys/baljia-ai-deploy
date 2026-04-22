// One-command platform deployment.
// - Creates Render web service for the Baljia platform (starter plan, oregon).
// - Copies all secret env vars from .env.local.
// - Adds Cloudflare DNS records: baljia.app apex CNAME + *.baljia.app wildcard CNAME.
// - Adds custom domains in Render (baljia.app + *.baljia.app).
//
// Run: npx tsx --env-file=.env.local scripts/deploy-platform.ts
//
// Idempotent-ish: checks for existing service/records by name before creating.

import { readFileSync } from 'node:fs';

const RENDER_API = 'https://api.render.com/v1';
const CF_API = 'https://api.cloudflare.com/client/v4';

const REPO_URL = 'https://github.com/yadavdg693-sys/Balaji';
const BRANCH = 'main';
const SERVICE_NAME = 'baljia-ai';
const OWNER_ID = 'tea-d7evv31o3t8c73c9sc1g';
const REGION = 'oregon';
const PLAN = 'starter';
const APP_DOMAIN = 'baljia.app';
const APP_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID_APP!;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const RENDER_KEY = process.env.RENDER_API_KEY!;

// Env vars to pass through from .env.local → Render. Read from file at deploy time.
// render.yaml has `sync: false` for secrets + value for non-secrets; we mirror
// both here, pulling values from .env.local for sync:false items.
const ENV_KEYS: Array<{ key: string; staticValue?: string }> = [
  { key: 'NODE_ENV', staticValue: 'production' },
  { key: 'NEXT_PUBLIC_APP_DOMAIN', staticValue: APP_DOMAIN },
  { key: 'NEXT_PUBLIC_APP_URL', staticValue: `https://${APP_DOMAIN}` },
  { key: 'GITHUB_ORG', staticValue: 'BALAJIapps' },
  { key: 'BALJIA_AUTH_FROM_EMAIL', staticValue: 'system@baljia.ai' },
  // Secrets — pulled from .env.local
  { key: 'DATABASE_URL' },
  { key: 'AUTH_SECRET' },
  { key: 'GOOGLE_CLIENT_ID' },
  { key: 'GOOGLE_CLIENT_SECRET' },
  { key: 'ANTHROPIC_API_KEY' },
  { key: 'OPENAI_API_KEY' },
  { key: 'POSTMARK_SERVER_TOKEN' },
  { key: 'POSTMARK_ACCOUNT_TOKEN' },
  { key: 'STRIPE_SECRET_KEY' },
  { key: 'STRIPE_WEBHOOK_SECRET' },
  { key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' },
  { key: 'UPSTASH_REDIS_REST_URL' },
  { key: 'UPSTASH_REDIS_REST_TOKEN' },
  { key: 'TAVILY_API_KEY' },
  { key: 'TAVILY_API_KEYS' },
  { key: 'CRON_SECRET' },
  { key: 'ADMIN_EMAILS' },
  { key: 'NEON_API_KEY' },
  { key: 'CLOUDFLARE_API_TOKEN' },
  { key: 'CLOUDFLARE_ACCOUNT_ID' },
  { key: 'CLOUDFLARE_ZONE_ID_APP' },
  { key: 'RENDER_API_KEY' },
  { key: 'GITHUB_TOKEN' },
  { key: 'ENCRYPTION_KEY' },
  { key: 'BROWSERBASE_API_KEY' },
  { key: 'BROWSERBASE_PROJECT_ID' },
  { key: 'IPINFO_TOKEN' },
  { key: 'IPSTACK_API_KEY' },
  { key: 'LATEDEV_API_KEY' },
  { key: 'HUNTER_API_KEY' },
  { key: 'SENTRY_DSN' },
];

function parseEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, 'utf8');
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function renderApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${RENDER_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${RENDER_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Render ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) as T : (undefined as T);
}

async function cfApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  const body = await res.json() as { success?: boolean; errors?: Array<{ code: number; message: string }>; result?: T };
  if (!res.ok || body.success === false) {
    throw new Error(`Cloudflare ${init.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result as T;
}

async function findExistingService(): Promise<{ id: string; hostname: string } | null> {
  type ServiceResp = Array<{ service: { id: string; name: string; serviceDetails?: { url?: string } } }>;
  const list = await renderApi<ServiceResp>('/services?limit=50');
  const hit = list.find((s) => s.service.name === SERVICE_NAME);
  if (!hit) return null;
  const details = await renderApi<{ service: { id: string; serviceDetails?: { url?: string } } }>(`/services/${hit.service.id}`);
  const url = details.service.serviceDetails?.url ?? '';
  const hostname = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return { id: hit.service.id, hostname };
}

async function createService(envVars: Array<{ key: string; value: string }>): Promise<{ id: string; hostname: string }> {
  const body = {
    type: 'web_service',
    name: SERVICE_NAME,
    ownerId: OWNER_ID,
    repo: REPO_URL,
    branch: BRANCH,
    autoDeploy: 'yes',
    rootDir: '',
    envVars,
    serviceDetails: {
      env: 'node',
      plan: PLAN,
      region: REGION,
      buildCommand: 'npm install && npm run build',
      startCommand: 'npm start',
      healthCheckPath: '/api/health',
      numInstances: 1,
      envSpecificDetails: {
        buildCommand: 'npm install && npm run build',
        startCommand: 'npm start',
      },
    },
  };
  const result = await renderApi<{ service: { id: string; serviceDetails?: { url?: string } } }>('/services', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const url = result.service.serviceDetails?.url ?? '';
  return {
    id: result.service.id,
    hostname: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
}

async function ensureDnsRecord(name: string, targetHostname: string, proxied = true): Promise<void> {
  // Look up existing record by name
  const existing = await cfApi<Array<{ id: string; name: string; type: string; content: string }>>(
    `/zones/${APP_ZONE_ID}/dns_records?name=${encodeURIComponent(name === '@' ? APP_DOMAIN : `${name}.${APP_DOMAIN}`)}`,
  );
  if (existing.length > 0) {
    const rec = existing[0];
    if (rec.type === 'CNAME' && rec.content === targetHostname) {
      console.log(`  [CF] ${rec.name} already points to ${targetHostname}`);
      return;
    }
    // Update
    await cfApi(`/zones/${APP_ZONE_ID}/dns_records/${rec.id}`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'CNAME', name, content: targetHostname, proxied, ttl: 1 }),
    });
    console.log(`  [CF] updated ${rec.name} → CNAME ${targetHostname} (proxied=${proxied})`);
    return;
  }
  // Create
  await cfApi(`/zones/${APP_ZONE_ID}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'CNAME', name, content: targetHostname, proxied, ttl: 1 }),
  });
  console.log(`  [CF] created ${name === '@' ? APP_DOMAIN : `${name}.${APP_DOMAIN}`} → CNAME ${targetHostname} (proxied=${proxied})`);
}

async function addCustomDomain(serviceId: string, domain: string): Promise<void> {
  try {
    await renderApi(`/services/${serviceId}/custom-domains`, {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
    });
    console.log(`  [Render] added custom domain: ${domain}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already') || msg.includes('exists') || msg.includes('409')) {
      console.log(`  [Render] ${domain} already attached`);
    } else {
      console.log(`  [Render] failed to attach ${domain}: ${msg.slice(0, 200)}`);
    }
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  Baljia platform deployment');
  console.log('════════════════════════════════════════════════════════════════════');

  // 1. Gather env vars from .env.local
  const dotenv = parseEnvFile('.env.local');
  const envVars: Array<{ key: string; value: string }> = [];
  const missing: string[] = [];
  for (const { key, staticValue } of ENV_KEYS) {
    const value = staticValue ?? dotenv[key];
    if (value === undefined || value === '') {
      if (!staticValue) missing.push(key);
      continue;
    }
    envVars.push({ key, value });
  }
  console.log(`\n[1/4] Collected ${envVars.length} env vars (${missing.length} optional missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''})`);

  // 2. Create or find Render service
  console.log('\n[2/4] Render web service');
  let service = await findExistingService();
  if (service) {
    console.log(`  existing service: ${service.id} @ ${service.hostname}`);
  } else {
    console.log('  creating new service...');
    service = await createService(envVars);
    console.log(`  created: ${service.id} @ ${service.hostname}`);
  }

  if (!service.hostname) {
    console.log('  ⚠️  service created but hostname not assigned yet — wait 30s then re-run to continue DNS setup');
    process.exit(0);
  }

  // 3. Cloudflare DNS for baljia.app
  console.log(`\n[3/4] Cloudflare DNS records on ${APP_DOMAIN}`);
  await ensureDnsRecord('@', service.hostname, true);        // baljia.app apex
  await ensureDnsRecord('*', service.hostname, true);        // *.baljia.app wildcard

  // 4. Custom domains on Render
  console.log('\n[4/4] Render custom domains');
  await addCustomDomain(service.id, APP_DOMAIN);
  await addCustomDomain(service.id, `*.${APP_DOMAIN}`);

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log(`✅ Deployment wired. Platform: https://${APP_DOMAIN}/ (DNS propagation ~5-30 min)`);
  console.log(`   Render URL (direct): https://${service.hostname}/`);
  console.log(`   Verify: curl https://${APP_DOMAIN}/api/health`);
  console.log('════════════════════════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('\n❌ deploy failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
