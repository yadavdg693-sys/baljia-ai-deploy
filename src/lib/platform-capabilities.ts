// Platform Capabilities — single source of truth for what Baljia can build/do.
//
// TWO AUDIENCES, CAREFULLY SEPARATED:
//
// 1. FOUNDER-FACING (PLATFORM_CAPABILITIES, getCapabilityConstraint,
//    getPlatformCapabilitiesPrompt) — used in onboarding (Surprise idea generation,
//    invent_idea and starter tasks) and CEO chat.
//    Market research and mission planning should not receive capability context.
//    MUST NOT mention implementation details (hosting provider, framework,
//    database driver, specific services). Founders care about WHAT can be built, not
//    HOW it's hosted. Leaking "Cloudflare Worker" into the refined idea
//    contaminates market research, mission, and landing copy downstream.
//
// 2. ENGINEERING-INTERNAL (RENDER_RUNTIME, getEngineeringStackPrompt) — used
//    by the Engineering agent's system prompt only, when writing code.
//    Contains the deploy/runtime defaults for founder apps. Never injected into
//    founder-visible content.

// ──────────────────────────────────────────────
// FOUNDER-FACING CAPABILITIES (neutral language)
// ──────────────────────────────────────────────

export const PLATFORM_CAPABILITIES = {
  build: [
    'Landing pages with live subdomain ({company}.baljia.app)',
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
  'Individual build tasks must fit inside a 4-hour execution window',
] as const;

/** Capabilities summary for CEO prompts. Includes "you dispatch work to workers"
 *  framing because CEO needs to know these are NOT its own tools. Do not use in
 *  onboarding or founder-visible prompts — the "worker agent" framing leaks into
 *  task `suggestion_reasoning` fields. Use `getCapabilitiesBulletsOnly()` instead. */
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

/** Capability bullets only — no CEO-oriented preamble. Safe to include in
 *  prompts whose output is persisted to founder-visible DB fields (e.g.
 *  onboarding's starter-task prompt, whose output ends up in tasks.description
 *  and tasks.suggestion_reasoning on the dashboard). */
export function getCapabilitiesBulletsOnly(): string {
  const canDo = Object.entries(PLATFORM_CAPABILITIES)
    .map(([category, items]) => `**${category.replace(/_/g, ' ')}:** ${items.join('; ')}`)
    .join('\n');

  const cantDo = PLATFORM_LIMITATIONS.join('; ');

  return `## What the platform can do
${canDo}

## What the platform cannot do
${cantDo}`;
}

/** Ultra-compact founder-safe constraint for idea-shaping prompts (refine_idea, invent_idea).
 *  NEVER mentions infrastructure (Cloudflare, Hono, Neon, specific drivers) because whatever
 *  you put here ends up in the refined_idea string which seeds market research and downstream
 *  outputs the founder reads. Keep it product-shaped. */
export function getCapabilityConstraint(): string {
  return `IMPORTANT: The idea MUST be buildable as a web app. Baljia can build: full-stack web apps with a database, APIs, webhooks, dashboards, scheduled jobs, Stripe payments (subscriptions/one-time/Connect), browser automation (scraping/form-filling), web research, email outreach, Twitter posting, Meta ads. Baljia CANNOT build: mobile apps, browser extensions, desktop apps, hardware/IoT, real-time video/audio streaming, or apps requiring Instagram/LinkedIn/TikTok APIs. The full company may be large, but each initial build task must be executable within a 4-hour agent run. Frame the idea around the PRODUCT and its customers — do NOT name infrastructure (hosting provider, frameworks, databases).`;
}

// ──────────────────────────────────────────────
// ENGINEERING-INTERNAL STACK (for Engineering agent code-writing prompts only)
// ──────────────────────────────────────────────

/** Legacy Cloudflare runtime specifics for onboarding-only deploy helpers.
 *  Engineering founder apps use Render; do not inject this into engineering prompts. */
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
  return `## Runtime defaults (Render founder apps)

Engineering tasks deploy founder apps to Render-backed web services. Cloudflare is reserved for onboarding landing pages.

**Default stack:**
- Node.js web app deployed from the company's GitHub repository
- Neon Postgres for per-company data
- Render free plan for trial services unless a paid plan is explicitly requested
- Environment variables managed through Render service env vars

**First deploy flow:**
1. Create or reuse the company GitHub repo.
2. Push a complete minimal app with clear build and start commands.
3. Provision a Neon database if the app needs persistence.
4. Call render_create_service with plan "free".
5. Verify render_get_deploy_status and check_url_health.

**Update flow:**
1. Read/list the existing GitHub repo.
2. Make the smallest change that satisfies the task.
3. Push/commit to the repo.
4. Call render_deploy on the existing render_service_id.
5. Verify the deployed URL and the feature-specific route or behavior.

Do not use Cloudflare deploy tools for engineering tasks.`;
}
