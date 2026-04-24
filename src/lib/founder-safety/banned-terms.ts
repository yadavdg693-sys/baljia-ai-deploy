// Banned-terms registry — the single source of truth for words/phrases that
// must NEVER appear in founder-visible DB fields.
//
// DESIGN PRINCIPLE: the banlist must NOT create new problems.
//
// Bare product names (Cloudflare, Neon, Postgres, Render, Express) are
// DELIBERATELY EXCLUDED from the default ban list — they appear constantly
// in legitimate market research, founder input, and competitor descriptions.
// Redacting them creates WORSE content than the original leak.
//
// We only ban phrases that almost-certainly indicate *Baljia's own
// implementation* leaking through. Examples:
//   - "Cloudflare Worker" / "hosted on Cloudflare"   — Baljia-specific usage
//   - "Neon DB ready" / "Neon database is"            — provisioning context
//   - "Express.js server" / "Express backend"          — stack description
//
// Not banned anywhere (legitimate in competitor lists):
//   - bare "Cloudflare" (CDN + security company)
//   - bare "Neon" (serverless Postgres provider — real competitor)
//   - bare "Postgres" / "PostgreSQL"
//   - bare "Render" (verb OR Render.com company)
//   - bare "Express" (verb OR Express.js framework name)
//   - bare "R2" (common bucket/product name)
//   - "serverless function" / "edge runtime" (generic industry terms)
//   - "GitHub repo" (founders legitimately say "check our repo")
//
// Founder-visible fields:
//   - documents.content, documents.title
//   - memory_layers.content (layer 1 — fed to CEO every chat turn)
//   - tasks.title, tasks.description, tasks.suggestion_reasoning
//   - platform_events.payload (onboarding activity stream)
//   - email_threads.body
//   - chat_sessions.messages
//
// Three categories:
//   - INFRA:    implementation-specific phrases only.
//   - INTERNAL: spec/architecture terminology — no legitimate use.
//   - VENDOR:   third-party services; excluded by default, opt-in via
//               includeVendors (some callers want to catch these too).
//
// Matching rules:
//   - `\s+` in the pattern matches one-or-more whitespace chars
//   - Word boundaries wrap each pattern so substrings inside other words
//     don't match ("expressly" doesn't trigger "Express")
//   - Case-sensitive unless the flag says otherwise

export interface BannedTerm {
  /** The phrase to match. Whitespace matches `\s+`. */
  pattern: string;
  /** Case-sensitive match? Default false. */
  caseSensitive?: boolean;
  /** Short label used in violation reports. */
  label: string;
  /** Which category — used by test filtering and by the sanitizer's
   *  per-category strictness controls. */
  category: 'infra' | 'internal' | 'vendor';
}

// ─────────────────────────────────────────────────────────────
// INFRA — implementation-leak PHRASES only, not bare product names.
// Every entry here is something that should essentially never appear in
// legitimate founder-facing content.
// ─────────────────────────────────────────────────────────────
const INFRA_TERMS: BannedTerm[] = [
  // Cloudflare Worker context only
  { pattern: 'Cloudflare Worker',  category: 'infra', label: 'Cloudflare Worker' },
  { pattern: 'Cloudflare Workers', category: 'infra', label: 'Cloudflare Workers' },
  { pattern: 'hosted on Cloudflare', category: 'infra', label: 'hosted on Cloudflare' },
  { pattern: 'Workers Paid',       category: 'infra', label: 'Workers Paid plan' },
  // Neon provisioning context
  { pattern: 'Neon DB',            category: 'infra', label: 'Neon DB' },
  { pattern: 'Neon database',      category: 'infra', label: 'Neon database' },
  { pattern: 'Neon Postgres',      category: 'infra', label: 'Neon Postgres' },
  // Render.com provisioning context
  { pattern: 'Render service',     category: 'infra', label: 'Render service' },
  { pattern: 'Render deploy',      category: 'infra', label: 'Render deploy' },
  { pattern: 'hosted on Render',   category: 'infra', label: 'hosted on Render' },
  // Express.js framework references (narrow — "Express framework" is too
  // generic and appears in legitimate competitor descriptions)
  { pattern: 'Express.js',         category: 'infra', label: 'Express.js' },
  { pattern: 'Express server',     category: 'infra', label: 'Express server' },
  { pattern: 'Express backend',    category: 'infra', label: 'Express backend' },
  // Build/tooling names that have no legitimate non-Baljia use
  { pattern: 'nodejs_compat',      category: 'infra', label: 'nodejs_compat' },
  { pattern: 'wrangler',           category: 'infra', label: 'wrangler' },
  { pattern: 'drizzle-orm',        category: 'infra', label: 'drizzle-orm' },
  { pattern: '@opennextjs',        category: 'infra', label: '@opennextjs' },
];

// ─────────────────────────────────────────────────────────────
// INTERNAL — spec/architecture terminology. No legitimate use; safe to ban.
// ─────────────────────────────────────────────────────────────
const INTERNAL_TERMS: BannedTerm[] = [
  { pattern: 'worker agent',       category: 'internal', label: 'worker agent' },
  { pattern: 'worker_lane',        category: 'internal', label: 'worker_lane' },
  { pattern: 'worker lane',        category: 'internal', label: 'worker lane' },
  { pattern: 'execution_mode',     category: 'internal', label: 'execution_mode' },
  { pattern: 'verification_level', category: 'internal', label: 'verification_level' },
  { pattern: 'ContextPacket',      category: 'internal', label: 'ContextPacket', caseSensitive: true },
  { pattern: 'PermissionSnapshot', category: 'internal', label: 'PermissionSnapshot', caseSensitive: true },
  { pattern: 'compiled briefing',  category: 'internal', label: 'compiled briefing' },
  { pattern: 'Engineering agent',  category: 'internal', label: 'Engineering agent', caseSensitive: true },
  { pattern: 'Research agent',     category: 'internal', label: 'Research agent', caseSensitive: true },
  { pattern: 'Outreach agent',     category: 'internal', label: 'Outreach agent', caseSensitive: true },
  { pattern: 'Browser agent',      category: 'internal', label: 'Browser agent', caseSensitive: true },
  { pattern: 'CEO framework',      category: 'internal', label: 'CEO framework' },
  { pattern: 'WORKER-VOICED',      category: 'internal', label: 'WORKER-VOICED', caseSensitive: true },
];

// ─────────────────────────────────────────────────────────────
// VENDOR — third-party service names. Excluded by default; opt-in via
// `includeVendors`. These often appear legitimately in competitor lists.
// ─────────────────────────────────────────────────────────────
const VENDOR_TERMS: BannedTerm[] = [
  { pattern: 'Hunter.io',          category: 'vendor', label: 'Hunter.io' },
  { pattern: 'Browserbase',        category: 'vendor', label: 'Browserbase' },
  { pattern: 'Tavily',             category: 'vendor', label: 'Tavily', caseSensitive: true },
  { pattern: 'Postmark',           category: 'vendor', label: 'Postmark', caseSensitive: true },
  { pattern: 'OpenRouter',         category: 'vendor', label: 'OpenRouter', caseSensitive: true },
];

export const ALL_BANNED_TERMS: BannedTerm[] = [
  ...INFRA_TERMS,
  ...INTERNAL_TERMS,
  ...VENDOR_TERMS,
];

/** Default strict set — infra + internal only. Vendors are opt-in. */
export const STRICT_BANNED_TERMS: BannedTerm[] = [
  ...INFRA_TERMS,
  ...INTERNAL_TERMS,
];
