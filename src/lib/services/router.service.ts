// Router Service — Maps task tags to agent IDs
// Derived from actual 30-day task data + Knowledge Graph v2 Domain 2.4

const TAG_ROUTES: Record<string, number> = {
  // ── Engineering (ID: 30) ──
  // Source: Domain 2.4 "Build, fix, deploy, integrate"
  // Day 1-30: landing pages, dashboards, admin panels, auth, Stripe, APIs, webhooks, cron, DB schemas, SEO fixes
  'landing-page': 30,
  'auth': 30,
  'billing': 30,
  'payment': 30,
  'settings': 30,
  'dashboard': 30,
  'admin': 30,
  'api': 30,
  'crud': 30,
  'database': 30,
  'webhook': 30,
  'cron': 30,
  'notification': 30,
  'form': 30,
  'onboarding': 30,
  'onboarding-flow': 30,
  'reporting': 30,
  'bug-fix': 30,
  'fix': 30,
  'css': 30,
  'seo': 30,
  'seo-meta': 30,
  'domain': 30,
  'tracking': 30,
  'favicon': 30,
  'deploy': 30,
  'config': 30,
  'error-page': 30,
  'legal': 30,
  'pricing-page': 30,
  'about-page': 30,
  'changelog': 30,
  'faq': 30,
  'contact-form': 30,
  'feedback': 30,
  'referral': 30,
  'csv-export': 30,
  'csv-import': 30,
  'calendar': 30,
  'integration': 30,
  'multi-user': 30,
  'activity-log': 30,
  'enrichment': 30,
  'email-tracking': 30,
  'duplicate-detection': 30,
  'custom-fields': 30,
  'automation': 30,
  'lead-scoring': 30,
  'security': 30,
  'performance': 30,
  'ux': 30,
  'a-b-test': 30,
  'mvp': 30,
  'feature': 30,
  'complex-feature': 30,
  'redesign': 30,
  'client-portal': 30,
  'full-crud': 30,
  'rebrand': 30,
  'offboarding': 30,
  'gdpr': 30,

  // ── Browser (ID: 42) ──
  // Source: Domain 2.4 "Interactive web execution, credential management"
  // Day 7-14: "scrape 20 SaaS companies", Day 14-21: "research pricing of top 5 competitors"
  'browse': 42,
  'scrape': 42,
  'screenshot': 42,
  'form-fill': 42,
  'verify-site': 42,
  'account-setup': 42,
  'product-hunt': 42,

  // ── Research (ID: 29) ──
  // Source: Domain 2.4 "Web research, synthesis, qualification"
  // Day 3: "Research: top 10 competitors to Qontakt"
  'research': 29,
  'market-analysis': 29,
  'competitor': 29,
  'trend': 29,

  // ── Data (ID: 33) ──
  // Source: Domain 2.4 "SQL, metrics, logs, analysis"
  // Day 21+: "Campaign analytics (open rate, reply rate, meeting rate)"
  'analytics': 33,
  'sql': 33,
  'metrics': 33,
  'dashboard-data': 33,
  'report': 33,

  // ── Support (ID: 32) ──
  // Source: Domain 2.4 "Customer email replies, escalation"
  'support': 32,
  'email-reply': 32,
  'customer': 32,
  'escalation': 32,

  // ── Twitter (ID: 40) ──
  // Source: Domain 2.4 "Compose and post tweets"
  // Day 2: "First tweet: Qontakt is live", recurring daily tweets
  'tweet': 40,
  'social': 40,
  'twitter': 40,

  // ── MetaAds (ID: 41) ──
  // Source: Domain 2.4 "Ad creation, optimization, campaign control"
  // Day 14-21: "Meta Ads setup ($10/day campaign)"
  'meta-ads': 41,
  'facebook-ads': 41,
  'instagram-ads': 41,
  'ad-campaign': 41,
  'ad-creative': 41,
  'audience-strategy': 41,

  // ── ColdOutreach (ID: 54) ──
  // Source: Domain 2.4 "Outbound email, verification, follow-ups"
  'outreach': 54,
  'cold-email': 54,
  'lead-gen': 54,
  'prospecting': 54,

  // ── Content → Engineering (no dedicated content agent yet) ──
  // Source: Domain 11.1 "Growth/Content agents — routing categories but no dedicated agents"
  'blog-post': 30,
  'copy': 30,
  'email-template': 30,
  'video-script': 30,
  'win-back-email': 30,
};

const DEFAULT_AGENT_ID = 30; // Engineering

/**
 * Route a task tag to the appropriate agent ID.
 * Exact match first, then substring fallback.
 */
export function routeTask(tag: string): number {
  const normalized = tag.toLowerCase().trim();

  // Exact match
  if (TAG_ROUTES[normalized] !== undefined) {
    return TAG_ROUTES[normalized];
  }

  // Substring match — check if any known tag is contained in the input
  for (const [knownTag, agentId] of Object.entries(TAG_ROUTES)) {
    if (normalized.includes(knownTag) || knownTag.includes(normalized)) {
      return agentId;
    }
  }

  return DEFAULT_AGENT_ID;
}

/**
 * Get the agent name for display.
 * Source: Domain 2.1 "Agent Catalog (9 Total)"
 */
export function getAgentName(agentId: number): string {
  const names: Record<number, string> = {
    0: 'CEO',
    29: 'Research',
    30: 'Engineering',
    32: 'Support',
    33: 'Data',
    40: 'Twitter',
    41: 'MetaAds',
    42: 'Browser',
    54: 'ColdOutreach',
  };
  return names[agentId] ?? 'Engineering';
}
