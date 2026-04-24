// Banned-terms registry — the single source of truth for words/phrases that
// must NEVER appear in founder-visible DB fields.
//
// Founder-visible fields are:
//   - documents.content, documents.title
//   - memory_layers.content (layer 1 especially — fed to CEO every chat turn)
//   - tasks.title, tasks.description, tasks.suggestion_reasoning
//   - platform_events.payload (the onboarding activity stream)
//   - email_threads.body (outbound founder emails)
//   - chat_sessions.messages
//
// Three categories:
//   - INFRA:    hosting providers, frameworks, databases, drivers. Implementation
//               detail founders don't need to see and that changes over time.
//   - INTERNAL: spec/architecture terminology (execution_mode, governance,
//               worker_lane, etc.) that's meant to stay hidden behind the
//               CEO agent's translation layer.
//   - VENDOR:   named third-party services we integrate with. Some of these
//               are legitimate competitor references (e.g. "Postmark" in a
//               market-research competitor list is fine) — soft mode warns
//               but doesn't strip. Strict mode flags them.
//
// Matching rules:
//   - Each entry has an explicit case-sensitivity flag. Avoids false positives
//     on common English words ("render the page" vs "Render service").
//   - Each entry uses word boundaries (\b) to avoid matching inside other
//     words ("expressly" shouldn't trigger "Express").

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
// INFRA — framework + hosting + database terms
// ─────────────────────────────────────────────────────────────
const INFRA_TERMS: BannedTerm[] = [
  { pattern: 'Cloudflare',        category: 'infra', label: 'Cloudflare' },
  { pattern: 'Cloudflare Worker', category: 'infra', label: 'Cloudflare Worker' },
  { pattern: 'Cloudflare Workers',category: 'infra', label: 'Cloudflare Workers' },
  { pattern: 'Workers Paid',      category: 'infra', label: 'Workers Paid plan' },
  { pattern: 'Hono',              category: 'infra', label: 'Hono', caseSensitive: true },
  { pattern: 'Neon',              category: 'infra', label: 'Neon', caseSensitive: true },
  { pattern: 'Neon DB',           category: 'infra', label: 'Neon DB' },
  { pattern: 'Neon database',     category: 'infra', label: 'Neon database' },
  { pattern: 'Postgres',          category: 'infra', label: 'Postgres' },
  { pattern: 'PostgreSQL',        category: 'infra', label: 'PostgreSQL' },
  { pattern: 'Render service',    category: 'infra', label: 'Render service' },
  { pattern: 'Render deploy',     category: 'infra', label: 'Render deploy' },
  { pattern: 'hosted on Render',  category: 'infra', label: 'hosted on Render' },
  { pattern: 'Express.js',        category: 'infra', label: 'Express.js' },
  { pattern: 'Express server',    category: 'infra', label: 'Express server' },
  { pattern: 'Express backend',   category: 'infra', label: 'Express backend' },
  { pattern: 'Express framework', category: 'infra', label: 'Express framework' },
  { pattern: 'nodejs_compat',     category: 'infra', label: 'nodejs_compat' },
  { pattern: 'wrangler',          category: 'infra', label: 'wrangler' },
  { pattern: 'drizzle-orm',       category: 'infra', label: 'drizzle-orm' },
  { pattern: '@opennextjs',       category: 'infra', label: '@opennextjs' },
  { pattern: 'GitHub repo',       category: 'infra', label: 'GitHub repo' },
  { pattern: 'serverless function', category: 'infra', label: 'serverless function' },
  { pattern: 'edge runtime',      category: 'infra', label: 'edge runtime' },
];

// ─────────────────────────────────────────────────────────────
// INTERNAL — spec/architecture terminology
// ─────────────────────────────────────────────────────────────
const INTERNAL_TERMS: BannedTerm[] = [
  { pattern: 'worker agent',      category: 'internal', label: 'worker agent' },
  { pattern: 'worker_lane',       category: 'internal', label: 'worker_lane' },
  { pattern: 'worker lane',       category: 'internal', label: 'worker lane' },
  { pattern: 'execution_mode',    category: 'internal', label: 'execution_mode' },
  { pattern: 'verification_level',category: 'internal', label: 'verification_level' },
  { pattern: 'ContextPacket',     category: 'internal', label: 'ContextPacket', caseSensitive: true },
  { pattern: 'PermissionSnapshot',category: 'internal', label: 'PermissionSnapshot', caseSensitive: true },
  { pattern: 'MCP server',        category: 'internal', label: 'MCP server' },
  { pattern: 'tool mount',        category: 'internal', label: 'tool mount' },
  { pattern: 'compiled briefing', category: 'internal', label: 'compiled briefing' },
  { pattern: 'Engineering agent', category: 'internal', label: 'Engineering agent', caseSensitive: true },
  { pattern: 'Research agent',    category: 'internal', label: 'Research agent', caseSensitive: true },
  { pattern: 'Outreach agent',    category: 'internal', label: 'Outreach agent', caseSensitive: true },
  { pattern: 'Browser agent',     category: 'internal', label: 'Browser agent', caseSensitive: true },
  { pattern: 'CEO framework',     category: 'internal', label: 'CEO framework' },
  { pattern: 'WORKER-VOICED',     category: 'internal', label: 'WORKER-VOICED', caseSensitive: true },
];

// ─────────────────────────────────────────────────────────────
// VENDOR — third-party service names
// ─────────────────────────────────────────────────────────────
// In strict mode these all flag. In soft mode only a subset that shows up
// in founder-visible copy by mistake (Hunter.io, Browserbase, Tavily — we
// use these but founders don't need to see them) flag. Postmark / Sora are
// less likely to leak and may show up legitimately in competitor lists.
const VENDOR_TERMS: BannedTerm[] = [
  { pattern: 'Hunter.io',         category: 'vendor', label: 'Hunter.io' },
  { pattern: 'Browserbase',       category: 'vendor', label: 'Browserbase' },
  { pattern: 'Tavily',            category: 'vendor', label: 'Tavily', caseSensitive: true },
  { pattern: 'Postmark',          category: 'vendor', label: 'Postmark', caseSensitive: true },
  { pattern: 'Sora 2',            category: 'vendor', label: 'Sora 2' },
  { pattern: 'OpenRouter',        category: 'vendor', label: 'OpenRouter', caseSensitive: true },
];

export const ALL_BANNED_TERMS: BannedTerm[] = [
  ...INFRA_TERMS,
  ...INTERNAL_TERMS,
  ...VENDOR_TERMS,
];

/** Terms that are always unacceptable in founder-visible fields regardless
 *  of mode — infra and internal terminology should never leak. */
export const STRICT_BANNED_TERMS: BannedTerm[] = [
  ...INFRA_TERMS,
  ...INTERNAL_TERMS,
];
