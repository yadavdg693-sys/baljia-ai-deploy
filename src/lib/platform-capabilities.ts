// Platform Capabilities — single source of truth for what Baljia can build/do
// Used by: onboarding (idea generation), CEO agent (transparency), governance (feasibility)
//
// Keep this in sync with actual agent capabilities. If a new integration is added
// (e.g. Instagram posting, mobile app builds), update here.
//
// CF Workers facts verified 2026-04-24 against:
//   https://developers.cloudflare.com/workers/platform/limits/
//   https://developers.cloudflare.com/workers/runtime-apis/nodejs/
//   https://developers.cloudflare.com/workers/frameworks/

export const PLATFORM_CAPABILITIES = {
  build: [
    'Static landing pages (Cloudflare R2, wildcard Worker serves from 300+ edges)',
    'Full-stack web apps on Cloudflare Workers + Neon Postgres (nodejs_compat)',
    'APIs, webhooks, SSR pages, auth flows (JWT/magic-link/OAuth)',
    'Dashboards, admin panels, internal tools',
    'Scheduled jobs (Cloudflare Cron Triggers — up to 15 min CPU on hourly+ crons)',
    'Stripe payments — subscriptions, one-time, Stripe Connect payouts',
    'Database schemas, migrations, read-only queries (Neon HTTP driver)',
    'SEO: meta tags, structured data, sitemaps',
    'Subdomain hosting at {company}.baljia.app (per-founder Worker route)',
    'Optional custom domain attach (founder brings their own)',
  ],
  browser: [
    'Navigate any website, click, fill forms, extract data',
    'Create accounts on platforms, post on forums',
    'Scrape competitor sites, test the company app',
    'Take screenshots for verification',
  ],
  research: [
    'Web research, competitive analysis, market intelligence',
    'Industry trends, customer persona development',
  ],
  email: [
    'Company inbox ({company}@baljia.app)',
    'Cold outreach with email finding/verification (Hunter.io)',
    'Transactional and support emails (Postmark)',
  ],
  twitter: [
    'Post tweets, schedule tweets',
    'Read company tweet history',
  ],
  meta_ads: [
    'AI-generated video ads (Fal.ai / Sora 2)',
    'Full campaign management on Facebook + Instagram',
    'Budget optimization, creative refresh',
  ],
  data: [
    'SQL queries against company database',
    'Business intelligence and metrics reports',
    'Schema inspection and optimization',
  ],
  cold_outreach: [
    'Find professional emails (Hunter.io)',
    'Verify emails before sending',
    'Personalized outreach sequences',
  ],
} as const;

// CF Workers runtime specifics — the agent must respect these when writing code.
export const WORKERS_RUNTIME = {
  // Hard limits (Paid plan)
  cpu_http_request_ms: 30_000,          // 30 sec per HTTP request
  cpu_cron_lte_1h_ms: 30_000,           // 30 sec for crons running <1h cadence
  cpu_cron_gte_1h_ms: 15 * 60 * 1000,   // 15 min for crons running ≥1h cadence
  memory_mb: 128,
  bundle_gzip_mb: 10,                    // 3 MB on Free
  subrequests_per_invocation: 10_000,
  request_body_mb: 100,
  env_vars_max: 128,
  env_var_size_kb: 5,

  // Frameworks verified supported on Workers
  supported_frameworks: [
    'Hono (RECOMMENDED default for APIs + web apps)',
    'Next.js (via @opennextjs/cloudflare adapter)',
    'SvelteKit (via adapter-cloudflare)',
    'Astro (via @astrojs/cloudflare)',
    'Nuxt (via Nitro Cloudflare preset)',
    'React Router / ex-Remix (first-class support)',
    'itty-router (lightweight alternative to Hono)',
    'Vanilla fetch handlers (no framework)',
  ],
  unsupported_frameworks: [
    'Express — needs http.createServer().listen(port), Workers have no port model',
    'Koa, Fastify, Nest.js — same reason',
  ],

  // Node.js compat status per API (nodejs_compat flag set by default)
  nodejs_fully_supported: ['fs', 'net', 'crypto', 'http', 'https', 'buffer', 'stream', 'url', 'path', 'process', 'events', 'async_hooks'],
  nodejs_partial_or_broken: ['tls (partial)', 'child_process (stubbed, non-functional)'],

  // Recommended database drivers
  supported_db_drivers: [
    '@neondatabase/serverless (HTTP — PRIMARY for founder apps, Neon is pre-provisioned)',
    '@upstash/redis (HTTP)',
    'drizzle-orm (works with Neon HTTP driver)',
  ],
  unsupported_db_drivers: [
    'pg (TCP — use @neondatabase/serverless HTTP driver instead)',
    'mongoose / MongoDB native driver (TCP)',
    'ioredis (TCP — use @upstash/redis HTTP)',
  ],
} as const;

export const PLATFORM_LIMITATIONS = [
  'No native mobile apps (iOS/Android) — web apps only (PWAs are fine)',
  'No browser extensions or desktop apps',
  'No Instagram, LinkedIn, or TikTok posting (only Twitter)',
  'No hardware or IoT integration',
  'No connecting to existing external codebases',
  'No generic third-party API connectors unless explicitly supported',
  'No real-time video/audio streaming apps (no WebRTC infra)',
  'No long-running server processes — HTTP requests hard-capped at 30 sec CPU',
  'No Express/Koa/Fastify/Nest.js — use Hono instead (Workers have no port binding)',
  'No TCP-based DB drivers — use HTTP drivers (@neondatabase/serverless, @upstash/redis)',
] as const;

// Compact text version for LLM prompts (token-efficient)
export function getPlatformCapabilitiesPrompt(): string {
  const canDo = Object.entries(PLATFORM_CAPABILITIES)
    .map(([category, items]) => `**${category.replace(/_/g, ' ')}:** ${items.join('; ')}`)
    .join('\n');

  const cantDo = PLATFORM_LIMITATIONS.join('; ');

  return `## Worker Agent Capabilities (what founder tasks can accomplish)
These are NOT your direct tools. These are what worker agents can do when you CREATE A TASK for the founder. You dispatch work to these agents — you do not have their tools yourself.

${canDo}

## Limitations (what we CANNOT build)
${cantDo}`;
}

// Technical stack guidance for the Engineering agent (full detail, used when
// the agent is actually writing code vs when CEO is scoping a task)
export function getEngineeringStackPrompt(): string {
  const r = WORKERS_RUNTIME;
  return `## Runtime constraints (Cloudflare Workers — read before writing code)

**Hard limits:**
- CPU per HTTP request: ${r.cpu_http_request_ms / 1000}s (NOT 15 min — that's cron-only)
- Memory per isolate: ${r.memory_mb} MB
- Bundle size: ${r.bundle_gzip_mb} MB gzipped (Paid plan)
- Subrequests per invocation: ${r.subrequests_per_invocation.toLocaleString()}
- Request body: ${r.request_body_mb} MB max

**Recommended framework stack:**
${r.supported_frameworks.map(f => `- ${f}`).join('\n')}

**Do NOT use (won't run on Workers):**
${r.unsupported_frameworks.map(f => `- ${f}`).join('\n')}

**Database drivers — USE:**
${r.supported_db_drivers.map(d => `- ${d}`).join('\n')}

**Database drivers — DO NOT USE:**
${r.unsupported_db_drivers.map(d => `- ${d}`).join('\n')}

**Node.js compat:** nodejs_compat flag is ENABLED by default for cf_deploy_app.
Fully working: ${r.nodejs_fully_supported.join(', ')}
Partial/broken: ${r.nodejs_partial_or_broken.join(', ')}

**Default app template for a Tier 2/3 build:**
\`\`\`js
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

const app = new Hono();

app.get('/api/hello', (c) => c.json({ ok: true }));

app.post('/api/things', async (c) => {
  const sql = neon(c.env.NEON_URL);
  const body = await c.req.json();
  const [row] = await sql\`INSERT INTO things (name) VALUES (\${body.name}) RETURNING *\`;
  return c.json(row);
});

export default app;  // Hono exports a fetch-compatible handler as default
\`\`\`

When bundling for cf_deploy_app: the script_content string should be the FULL bundled JS
(all imports inlined via esbuild or equivalent). You cannot import from node_modules at
runtime — everything must be in the single script.`;
}

// Ultra-compact version for strategy prompt (minimize tokens)
export function getCapabilityConstraint(): string {
  return `IMPORTANT: The idea MUST be buildable as a Cloudflare Worker web app with these tools: Hono + Neon Postgres (HTTP driver), Stripe payments, email outreach, Twitter posting, Meta ads, browser automation (scraping/form-filling), web research. We CANNOT build: mobile apps, browser extensions, desktop apps, hardware, Express/Koa apps (Workers have no port binding — use Hono), long-running server processes (>30s CPU per HTTP request), or apps requiring Instagram/LinkedIn/TikTok APIs.`;
}
