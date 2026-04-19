// Platform Capabilities — single source of truth for what Baljia can build/do
// Used by: onboarding (idea generation), CEO agent (transparency), governance (feasibility)
//
// Keep this in sync with actual agent capabilities. If a new integration is added
// (e.g. Instagram posting, mobile app builds), update here.

export const PLATFORM_CAPABILITIES = {
  build: [
    'Full-stack web apps (Express + Postgres + Render hosting)',
    'Landing pages, dashboards, admin panels, auth flows',
    'API endpoints, webhooks, cron jobs',
    'Stripe payments (subscriptions, one-time, connect payouts)',
    'Database schemas, migrations, queries',
    'SEO optimization, meta tags, structured data',
    'Subdomain hosting ({company}.baljia.app)',
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
    'AI-generated video ads (Sora 2)',
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

export const PLATFORM_LIMITATIONS = [
  'No native mobile apps (iOS/Android) — web apps only',
  'No browser extensions or desktop apps',
  'No Instagram, LinkedIn, or TikTok posting (only Twitter)',
  'No hardware or IoT integration',
  'No connecting to existing external codebases',
  'No generic third-party API connectors unless explicitly supported',
  'No real-time video/audio streaming apps',
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

// Ultra-compact version for strategy prompt (minimize tokens)
export function getCapabilityConstraint(): string {
  return `IMPORTANT: The idea MUST be buildable as a web app with these tools: Express+Postgres backend, Stripe payments, email outreach, Twitter posting, Meta ads, browser automation (scraping/form-filling), web research. We CANNOT build: mobile apps, browser extensions, desktop apps, hardware, or apps requiring Instagram/LinkedIn/TikTok APIs.`;
}
