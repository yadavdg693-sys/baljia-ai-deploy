// Platform Capabilities — single source of truth for what Baljia can build/do.
//
// TWO AUDIENCES, CAREFULLY SEPARATED:
//
// 1. FOUNDER-FACING (PLATFORM_CAPABILITIES, getCapabilityConstraint,
//    getPlatformCapabilitiesPrompt) — used in onboarding (refine_idea,
//    invent_idea, market_research, mission, starter tasks) and CEO chat.
//    MUST NOT mention implementation details (Cloudflare Workers, Hono, Neon,
//    Postgres, specific drivers). Founders care about WHAT can be built, not
//    HOW it's hosted. Leaking "Cloudflare Worker" into the refined idea
//    contaminates market research, mission, and landing copy downstream.
//
// 2. ENGINEERING-INTERNAL (WORKERS_RUNTIME, getEngineeringStackPrompt) — used
//    by the Engineering agent's system prompt only, when writing code.
//    Contains the full technical stack (Hono, Neon HTTP, Workers limits,
//    supported frameworks, nodejs_compat matrix). Never injected into
//    founder-visible content.

// ──────────────────────────────────────────────
// FOUNDER-FACING CAPABILITIES (neutral language)
// ──────────────────────────────────────────────

export const PLATFORM_CAPABILITIES = {
  build: [
    'Landing pages with live subdomain ({company}.baljia.app) at the edge',
    'Full-stack web apps with a dedicated database per company',
    'APIs, webhooks, server-rendered pages, auth flows (magic link, OAuth, password)',
    'Dashboards, admin panels, internal tools',
    'Scheduled jobs (hourly, daily, weekly)',
    'Stripe payments — subscriptions, one-time charges, Stripe Connect payouts',
    'Database schemas, migrations, read-only queries',
    'SEO: meta tags, structured data, sitemaps',
    'Optional custom domain (founder brings their own)',
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
    'Cold outreach with email finding/verification',
    'Transactional and support emails',
  ],
  twitter: [
    'Post tweets, schedule tweets',
    'Read company tweet history',
  ],
  meta_ads: [
    'AI-generated video ads',
    'Full campaign management on Facebook + Instagram',
    'Budget optimization, creative refresh',
  ],
  data: [
    'SQL queries against company database',
    'Business intelligence and metrics reports',
    'Schema inspection and optimization',
  ],
  cold_outreach: [
    'Find professional emails',
    'Verify emails before sending',
    'Personalized outreach sequences',
  ],
} as const;

export const PLATFORM_LIMITATIONS = [
  'No native mobile apps (iOS/Android) — web apps only (PWAs are fine)',
  'No browser extensions or desktop apps',
  'No Instagram, LinkedIn, or TikTok posting (only Twitter)',
  'No hardware or IoT integration',
  'No connecting to existing external codebases',
  'No generic third-party API connectors unless explicitly supported',
  'No real-time video/audio streaming apps',
  'No long-running server processes — request handlers must complete within 30 seconds',
] as const;

/** Founder-safe capabilities summary for CEO prompts + onboarding. Neutral language. */
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

/** Ultra-compact founder-safe constraint for idea-shaping prompts (refine_idea, invent_idea).
 *  NEVER mentions infrastructure (Cloudflare, Hono, Neon, specific drivers) because whatever
 *  you put here ends up in the refined_idea string which seeds market research and downstream
 *  outputs the founder reads. Keep it product-shaped. */
export function getCapabilityConstraint(): string {
  return `IMPORTANT: The idea MUST be buildable as a web app. Baljia can build: full-stack web apps with a database, APIs, webhooks, dashboards, scheduled jobs, Stripe payments (subscriptions/one-time/Connect), browser automation (scraping/form-filling), web research, email outreach, Twitter posting, Meta ads. Baljia CANNOT build: mobile apps, browser extensions, desktop apps, hardware/IoT, real-time video/audio streaming, apps requiring Instagram/LinkedIn/TikTok APIs, or long-running server processes (request handlers capped at 30 seconds). Frame the idea around the PRODUCT and its customers — do NOT name infrastructure (hosting provider, frameworks, databases).`;
}

// ──────────────────────────────────────────────
// ENGINEERING-INTERNAL STACK (for Engineering agent code-writing prompts only)
// ──────────────────────────────────────────────

/** CF Workers runtime specifics — technical constraints the Engineering agent
 *  must respect when writing code. This is NEVER surfaced to founders. */
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

  nodejs_fully_supported: ['fs', 'net', 'crypto', 'http', 'https', 'buffer', 'stream', 'url', 'path', 'process', 'events', 'async_hooks'],
  nodejs_partial_or_broken: ['tls (partial)', 'child_process (stubbed, non-functional)'],

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

/** Full technical stack guidance for the Engineering agent only.
 *  Injected into the Engineering agent's system prompt via agent-factory.ts.
 *  NEVER used in onboarding or CEO prompts — founder outputs stay
 *  infrastructure-agnostic. */
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
export default app;
\`\`\`

When bundling for cf_deploy_app: the script_content string should be the FULL bundled JS
(all imports inlined). You cannot import from node_modules at runtime — everything must
be in the single script.`;
}
