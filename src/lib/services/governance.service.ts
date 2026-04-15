// Governance Service — Hybrid task evaluation
// Tags derived from REAL 30-day task data + Knowledge Graph v2
//
// Source:
//   Founder's actual 30-day task list (Day 1-30, ~80-95 credits)
//   Domain 2.4: Per-agent capabilities
//   Domain 5.2: Task fields (tag is VARCHAR(50) free-text)
//   Domain 7.4: Credit bands (1 credit per task regardless of complexity)
//   Domain 12.4: Governance system (execution_mode, verification_level)
//   Domain 5.4: 4-hour max per task, 1 credit deducted at start_task

import Anthropic from '@anthropic-ai/sdk';
import type { GovernanceDecision, ExecutionMode, VerificationLevel, PermissionSnapshot, CreditQuote } from '@/types';
import * as creditService from './credit.service';
import { callAnthropicWithTimeout, callGeminiWithTimeout } from '@/lib/llm-safety';
import { isAnthropicAvailable } from '@/lib/llm-provider';
import { createLogger } from '@/lib/logger';
import { db, failureFingerprints } from '@/lib/db';
import { eq, and, gte, sql } from 'drizzle-orm';

const log = createLogger('Governance');

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = 'gemini-2.5-flash';

// ══════════════════════════════════════════════════════════════════
// EXECUTION MODE CLASSIFICATION
//
// deterministic: No AI reasoning. Direct file edits, config, CLI.
// template_plus_params: Standard pattern + customize. Pages, forms, templates.
// full_agent: Needs reasoning, diagnosis, design, multi-step decisions.
// ══════════════════════════════════════════════════════════════════

// deterministic: trivial changes that don't need reasoning
const DETERMINISTIC_TAGS = new Set([
  'css',                 // Day 1-3: "CSS: adjust hero section spacing, font sizes, colors" = direct edits
  'seo',                 // Day 3: "Add favicon, OG image, meta tags" = paste config
  'seo-meta',            // alias for seo
  'domain',              // Day 1: "Custom domain + DNS setup" = DNS config
  'tracking',            // Day 14-21: "Google Analytics / Plausible tracking setup" = paste snippet
  'favicon',             // Day 3: "Add favicon, OG image, meta tags"
  'deploy',              // deployment = run command
  'config',              // configuration changes
  'copy',                // Day 1-7: "copy" in credit bands — text changes
]);

// template_plus_params: known pattern, customize with project details
const TEMPLATE_TAGS = new Set([
  'landing-page',        // Day 1: "Landing page build from scratch (hero, features, CTA, footer)" — standard template
  'auth',                // Day 1: "Auth system: signup + login + logout" — standard auth pattern
  'billing',             // Day 7-14: "Billing page with Stripe portal" — Stripe template
  'payment',             // alias for billing
  'settings',            // Day 7-14: "User settings page (name, email, password change)"
  'legal',               // Day 14+: "Privacy Policy page", "Terms of Service page" — legal templates
  'pricing-page',        // Day 14+: "Pricing page with tier comparison"
  'about-page',          // Day 14+: "About page (mission, story, team)"
  'changelog',           // Day 14+: "Changelog / What's new page"
  'faq',                 // Day 14+: "FAQ / Help center page"
  'contact-form',        // Day 14+: "Contact form / support page"
  'feedback',            // Day 14+: "In-app feedback widget"
  'error-page',          // Day 3: "404 page"
  'email-template',      // Day 14+: "Branded HTML email template (base layout)"
  'email-reply',         // Support agent: email replies — template response
  'webhook',             // Day 14-21: "Webhook receiver for external lead sources" — standard pattern
  'csv-export',          // Day 14-21: "CSV export for prospect lists"
  'csv-import',          // Day 21-30: "Prospect import from CSV"
  'api',                 // Day 2: "API: prospect CRUD endpoints" — standard REST pattern
  'crud',                // simple create/read/update/delete
  'notification',        // Day 7-14: "Notification system (in-app toasts + email alerts)"
  'form',                // form components — standard pattern
  'cron',                // cron/scheduled job — standard setup
  'blog-post',           // Day 3+: "First blog post" (x6-8 in 30 days) — content template
]);

// full_agent: needs reasoning, design decisions, diagnosis, complex logic
const FULL_AGENT_TAGS = new Set([
  // Bug fixes require diagnosis — Day 1+: "Bug fix: auth flow edge cases" (3-5 per week)
  'bug-fix',
  'fix',

  // Complex features: Day 2+
  'onboarding',          // Day 2: "Onboarding wizard" — complexity 5
  'dashboard',           // Day 2: "Main dashboard layout", Day 7: "campaign overview" — complexity 6
  'reporting',           // Day 14-21: "Reporting page: weekly summary of pipeline" — complexity 5
  'admin',               // Day 14+: "Admin dashboard: total users, signups" — complexity 5

  // Automation & intelligence: Day 21-30
  'automation',          // Day 21-30: "Multi-step outreach automation" — complexity 7
  'lead-scoring',        // Day 21-30: "Lead scoring system" — complexity 6
  'multi-user',          // Day 21-30: "Team/multi-user access" — complexity 6
  'activity-log',        // Day 21-30: "Activity log (audit trail)" — complexity 4

  // Data integration features
  'enrichment',          // Day 21+: "Prospect enrichment (auto-pull LinkedIn/company data)" — complexity 6
  'email-tracking',      // Day 21+: "Email bounce/open/click tracking" — complexity 6
  'duplicate-detection', // Day 21+: "Duplicate prospect detection" — complexity 3
  'custom-fields',       // Day 21+: "Prospect tagging / custom fields" — complexity 4

  // Integrations: Day 14-21
  'calendar',            // Day 14-21: "Calendar integration for meeting booking" — complexity 5
  'integration',         // Day 21-30: "Integration: connect user's Gmail" — complexity 5

  // Optimization & testing
  'a-b-test',            // Day 21-30: "A/B test landing page headline" — complexity 4
  'performance',         // Day 21-30: "Performance optimization (slow queries, caching)" — complexity 4
  'referral',            // Day 14+: "Referral system" — complexity 5

  // Security (requires analysis, not just config)
  'security',            // Day 14+: "Rate limiting", "XSS protection" — complexity 3
  'database',            // Day 1: "Database schema v1" — schema design = modeling decisions

  // UX patterns (decisions about which states to handle)
  'ux',                  // Day 14+: empty states, loading skeletons, confirm dialogs — complexity 2-3

  // Research agent tasks
  'research',            // Day 3: "Research: top 10 competitors to Qontakt" — complexity 3
  'market-analysis',     // onboarding: Market Research Report
  'competitor',          // Day 14+: competitor analysis, pricing comparison
  'trend',               // trend analysis

  // Browser agent tasks
  'scrape',              // Day 7-14: "Browser: scrape 20 SaaS companies" — complexity 3
  'browse',              // general browsing
  'product-hunt',        // Day 14+: "Product Hunt launch prep" — complexity 4
  'verify-site',         // site verification
  'account-setup',       // account creation on external sites
  'screenshot',          // screenshot capture
  'form-fill',           // external form filling

  // Data agent tasks
  'analytics',           // Day 21+: "Campaign analytics (open rate, reply rate)" — complexity 5
  'sql',                 // SQL queries
  'metrics',             // metrics collection
  'report',              // report generation

  // Content (needs creative reasoning, not just templates)
  'video-script',        // Day 14+: "Product demo video script" — complexity 4
  'win-back-email',      // Day 21+: "We miss you" win-back email" — complexity 3

  // Twitter agent tasks
  'tweet',               // Day 2: "First tweet" — 1/day recurring
  'social',              // social content

  // Meta Ads agent tasks
  'meta-ads',            // Day 14-21: "Meta Ads setup ($10/day campaign)" — complexity 3
  'facebook-ads',
  'instagram-ads',
  'ad-campaign',
  'ad-creative',         // Day 21-30: "Ad creative refresh (new video ad)" — complexity 4
  'audience-strategy',   // Day 14-21: "audience strategy for Meta Ads targeting" — complexity 3

  // Cold Outreach agent tasks
  'outreach',            // outbound sequences
  'cold-email',          // cold email batches
  'lead-gen',            // lead generation
  'prospecting',         // prospect sourcing

  // Large builds
  'mvp',                 // Domain 7.4: "full MVP app" — 8-15+ credits
  'feature',             // Domain 7.4: "moderate feature" — 2-3 credits
  'complex-feature',     // Domain 7.4: "complex multi-API" — 8-15+ credits
  'redesign',            // Domain 7.4: "redesign" — 2-3 credits
  'client-portal',       // Domain 7.4: "client portal" — 4-6 credits
  'onboarding-flow',     // Domain 7.4: "multi-step onboarding" — 4-6 credits
  'full-crud',           // Domain 7.4: "full CRUD" — 4-6 credits
  'rebrand',             // Domain 7.4: "full rebrand" — 8-15+ credits

  // Offboarding
  'offboarding',         // Day 21+: "Cancel subscription flow with feedback survey" — complexity 4
  'gdpr',                // Day 14+: "GDPR data export/delete" — complexity 4
]);

// ══════════════════════════════════════════════════════════════════
// VERIFICATION LEVEL CLASSIFICATION
// Source: Domain 12.1 "Five verification levels"
// ══════════════════════════════════════════════════════════════════

// deterministic: run automated tests or check deployment status
const DETERMINISTIC_VERIFY_TAGS = new Set([
  'api',                 // run API endpoint tests
  'crud',                // test CRUD operations
  'database',            // verify schema migration
  'webhook',             // test webhook endpoint
  'cron',                // verify cron schedule
  'sql',                 // verify query results
  'deploy',              // check deployment status
  'config',              // verify config applied
  'csv-export',          // verify file generated
  'csv-import',          // verify data imported
  'security',            // run security tests (rate limit, XSS)
  'billing',             // test Stripe flow
  'payment',             // test payment flow
  'tracking',            // verify tracking fires
  'email-tracking',      // verify tracking pixels
  'performance',         // run perf benchmarks
  'duplicate-detection', // run dedup tests
]);

// browser_flow: screenshot and visual check
const BROWSER_VERIFY_TAGS = new Set([
  'landing-page',        // screenshot the page
  'auth',                // test login/signup flow visually
  'settings',            // verify settings page renders
  'dashboard',           // visual QA of dashboard
  'admin',               // visual QA of admin panel
  'onboarding',          // walk through wizard visually
  'reporting',           // verify report layout
  'pricing-page',        // verify pricing page renders
  'about-page',          // verify about page renders
  'changelog',           // verify changelog renders
  'faq',                 // verify FAQ renders
  'contact-form',        // verify form renders
  'feedback',            // verify widget renders
  'error-page',          // verify 404 page
  'form',                // verify form renders
  'notification',        // verify toasts appear
  'ux',                  // verify empty states, skeletons
  'legal',               // verify legal pages render
  'referral',            // verify referral page
  'calendar',            // verify booking UI
  'a-b-test',            // verify variant renders
  'multi-user',          // verify team management UI
  'activity-log',        // verify audit log UI
  'custom-fields',       // verify custom field UI
  'client-portal',       // verify portal UI
  'onboarding-flow',     // verify onboarding steps
  'redesign',            // visual comparison before/after
  'rebrand',             // visual identity check
  'offboarding',         // verify cancel flow
  'css',                 // visual check of styling changes
  'seo',                 // verify meta/OG renders correctly
  'seo-meta',            // same as seo
  'favicon',             // verify favicon shows
  'domain',              // verify domain resolves
  'feature',             // verify feature works visually
  'complex-feature',     // visual + functional check
  'mvp',                 // visual QA of the MVP
  'full-crud',           // verify CRUD UI
  'bug-fix',             // verify fix visually
  'fix',                 // verify fix visually
  'enrichment',          // verify enrichment displays
  'product-hunt',        // verify PH listing draft
  'automation',          // verify sequence builder UI
  'lead-scoring',        // verify scoring UI
  'gdpr',                // verify data export/delete flow
]);

// quality_review: read and evaluate content quality
const QUALITY_VERIFY_TAGS = new Set([
  'tweet',               // Day 2: tweet quality check
  'social',              // social content quality
  'outreach',            // Cold Outreach email quality
  'cold-email',          // email content quality
  'email-reply',         // Support reply quality
  'email-template',      // email layout/content quality
  'copy',                // copywriting quality
  'lead-gen',            // lead quality check
  'prospecting',         // prospect quality
  'blog-post',           // blog post quality (Day 3+: very frequent)
  'video-script',        // script quality
  'win-back-email',      // retention email quality
  'audience-strategy',   // targeting strategy quality
]);

// none: output IS the result (research, data, reports)
const NO_VERIFY_TAGS = new Set([
  'research',            // Research output = report
  'market-analysis',     // Market Research Report
  'competitor',          // Competitive analysis = report
  'trend',               // Trend analysis = report
  'analytics',           // Data analysis = report
  'metrics',             // Metrics = data
  'report',              // Report = output is the deliverable
]);

// ══════════════════════════════════════════════════════════════════
// SPLIT DETECTION
// Source: Domain 12.4 "Hard split rules"
// "Split by deliverable boundaries (landing page / auth / dashboard / payments),
//  NOT implementation fragments (DB setup / API only / UI only)"
// Source: Domain 5.4 "4-hour max per task"
// ══════════════════════════════════════════════════════════════════

const SPLIT_SIGNALS = [
  /\band\b.*\band\b/i,                       // "X and Y and Z" — multiple features
  /frontend.*backend|backend.*frontend/i,     // Mixed work types
  /\d+\s*(pages?|screens?|endpoints?)/i,      // Multiple deliverables
  /additionally|also.*also|plus.*plus/i,      // Additive language
  /landing.page.*auth|auth.*landing.page/i,   // Mixed deliverables
  /dashboard.*payment|payment.*dashboard/i,   // Mixed deliverables
  /build.*and.*deploy.*and/i,                 // Triple-and chains
  /signup.*login.*dashboard/i,                // 3+ screens bundled
  /admin.*panel.*and.*user.*settings/i,       // admin + settings = 2 tasks
];

function detectSplit(title: string, description: string): boolean {
  const combined = `${title} ${description}`;
  return SPLIT_SIGNALS.some((pattern) => pattern.test(combined));
}

// ══════════════════════════════════════════════════════════════════
// PREREQUISITE CHECK
// Source: Domain 5.2 executability_type: "needs_new_connection"
// Source: Domain 2.4 Agent capabilities + OAuth requirements
// ══════════════════════════════════════════════════════════════════

const OAUTH_REQUIRED_TAGS = new Set([
  // Twitter: "higher volume requires founder-owned connected Twitter/X account via OAuth"
  'twitter',
  'social',
  // Meta Ads: "Facebook + Instagram placements via platform Meta ad account"
  'meta-ads',
  'facebook-ads',
  'instagram-ads',
  'ad-campaign',
  'ad-creative',
  'audience-strategy',
]);

function checkPrerequisites(tag: string): string | null {
  const normalized = tag.toLowerCase().trim();
  if (OAUTH_REQUIRED_TAGS.has(normalized)) {
    return `This task requires an OAuth connection for "${normalized}". Connect your account in Settings before running.`;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// REFUND POLICY
// Source: Domain 5.4 "Failed tasks consume credit — no auto-refund"
// Source: Domain 7.2 "Ad spend — completely separate from credits"
// ══════════════════════════════════════════════════════════════════

const NO_REFUND_TAGS = new Set([
  // Meta Ads: real external ad spend — cannot refund
  'meta-ads', 'facebook-ads', 'instagram-ads', 'ad-campaign', 'ad-creative', 'audience-strategy',
]);

const MANUAL_REVIEW_TAGS = new Set([
  // Browser: external site interactions have side effects
  'account-setup', 'form-fill', 'product-hunt',
  // Cold Outreach: emails already sent
  'outreach', 'cold-email', 'lead-gen', 'prospecting',
  // Support: replies already sent
  'email-reply',
  // Tweet: already posted
  'tweet', 'social',
]);

function classifyRefundPolicy(tag: string): 'auto_eligible' | 'manual_review' | 'no_refund' {
  const normalized = tag.toLowerCase().trim();
  if (NO_REFUND_TAGS.has(normalized)) return 'no_refund';
  if (MANUAL_REVIEW_TAGS.has(normalized)) return 'manual_review';
  // Spec: "Failed tasks consume credit (no auto-refund)". Default to manual_review
  // so refunds require explicit human decision rather than happening silently.
  return 'manual_review';
}

// ══════════════════════════════════════════════════════════════════
// KNOWN TAGS — union of ALL classification tables
// If a tag is here → deterministic classification (0ms, free)
// If not → LLM fallback via Haiku (~$0.001)
// ══════════════════════════════════════════════════════════════════

const ALL_KNOWN_TAGS = new Set([
  // DETERMINISTIC execution
  'css', 'seo', 'seo-meta', 'domain', 'tracking', 'favicon', 'deploy', 'config', 'copy',
  // TEMPLATE execution
  'landing-page', 'auth', 'billing', 'payment', 'settings', 'legal', 'pricing-page',
  'about-page', 'changelog', 'faq', 'contact-form', 'feedback', 'error-page',
  'email-template', 'email-reply', 'webhook', 'csv-export', 'csv-import',
  'api', 'crud', 'notification', 'form', 'cron', 'blog-post',
  // FULL_AGENT execution
  'bug-fix', 'fix', 'onboarding', 'dashboard', 'reporting', 'admin',
  'automation', 'lead-scoring', 'multi-user', 'activity-log',
  'enrichment', 'email-tracking', 'duplicate-detection', 'custom-fields',
  'calendar', 'integration', 'a-b-test', 'performance', 'referral',
  'security', 'database', 'ux', 'offboarding', 'gdpr',
  'research', 'market-analysis', 'competitor', 'trend',
  'scrape', 'browse', 'product-hunt', 'verify-site', 'account-setup', 'screenshot', 'form-fill',
  'analytics', 'sql', 'metrics', 'report', 'dashboard-data',
  'video-script', 'win-back-email',
  'tweet', 'social', 'twitter',
  'meta-ads', 'facebook-ads', 'instagram-ads', 'ad-campaign', 'ad-creative', 'audience-strategy',
  'outreach', 'cold-email', 'lead-gen', 'prospecting',
  'mvp', 'feature', 'complex-feature', 'redesign', 'client-portal',
  'onboarding-flow', 'full-crud', 'rebrand',
  'support', 'customer', 'escalation',
]);

function isKnownTag(tag: string): boolean {
  return ALL_KNOWN_TAGS.has(tag.toLowerCase().trim());
}

// ── Deterministic classifiers ──

function classifyExecutionMode(tag: string): ExecutionMode | null {
  const normalized = tag.toLowerCase().trim();
  if (DETERMINISTIC_TAGS.has(normalized)) return 'deterministic';
  if (TEMPLATE_TAGS.has(normalized)) return 'template_plus_params';
  if (FULL_AGENT_TAGS.has(normalized)) return 'full_agent';
  return null;
}

function classifyVerificationLevel(tag: string): VerificationLevel | null {
  const normalized = tag.toLowerCase().trim();
  if (NO_VERIFY_TAGS.has(normalized)) return 'none';
  if (DETERMINISTIC_VERIFY_TAGS.has(normalized)) return 'deterministic';
  if (QUALITY_VERIFY_TAGS.has(normalized)) return 'quality_review';
  if (BROWSER_VERIFY_TAGS.has(normalized)) return 'browser_flow';
  return null;
}

// ══════════════════════════════════════════════════════════════════
// LLM FALLBACK (Haiku)
// Only fires for tags NOT in ALL_KNOWN_TAGS
// ══════════════════════════════════════════════════════════════════

interface LLMClassification {
  execution_mode: ExecutionMode;
  verification_level: VerificationLevel;
  refund_policy: 'auto_eligible' | 'manual_review' | 'no_refund';
  reasoning: string;
}

async function classifyWithLLM(input: {
  title: string;
  description: string;
  tag: string;
}): Promise<LLMClassification> {
  // Use Haiku if Anthropic key available, otherwise Gemini
  if (isAnthropicAvailable()) {
    try {
      return await classifyWithHaiku(input);
    } catch (haikuError) {
      log.warn('Haiku classification failed, trying Gemini');
    }
  }

  try {
    return await classifyWithGemini(input);
  } catch (geminiError) {
    log.error('All classifiers failed, using defaults', {}, geminiError);
    return SAFE_DEFAULTS;
  }
}

const SAFE_DEFAULTS: LLMClassification = {
  execution_mode: 'full_agent',
  verification_level: 'none',
  refund_policy: 'manual_review',
  reasoning: 'Could not classify — using safe defaults (full agent, no auto-verify, manual refund review).',
};

const CLASSIFIER_SYSTEM_PROMPT = `You classify tasks for Baljia AI. Respond ONLY with valid JSON, no markdown.

9 agents: Engineering (#30 — builds, fixes, deploys), Browser (#42 — web scraping, form fills, screenshots),
Research (#29 — market/competitor analysis), Data (#33 — SQL, analytics, reports),
Support (#32 — email replies, escalation), Twitter (#40 — tweets, social),
MetaAds (#41 — ad campaigns), ColdOutreach (#54 — outbound email, lead gen).

Typical 30-day tasks include: bug fixes, CSS tweaks, landing pages, auth, dashboards,
API endpoints, billing/Stripe, admin panels, blog posts, SEO, email templates,
onboarding wizards, reporting pages, lead scoring, A/B tests, CSV import/export,
calendar integrations, referral systems, competitor research, prospect scraping,
ad campaign setup, cold outreach sequences, tweets.

execution_mode: "deterministic" (config, CSS, SEO, deploy), "template_plus_params" (pages, forms, APIs, templates), "full_agent" (features, bugs, research, integrations, automation)
verification_level: "none" (research/reports), "deterministic" (APIs, DB, payments — run tests), "browser_flow" (UI — screenshot), "quality_review" (content — read it)
refund_policy: "manual_review" (default — failed tasks consume credit, refund needs human review), "auto_eligible" (only for pure infra errors where nothing ran), "no_refund" (ad spend, sent emails, external actions)`;

function buildClassifierPrompt(input: { tag: string; title: string; description: string }): string {
  return `Classify: Tag="${input.tag}" Title="${input.title}" Description="${input.description}"
JSON: {"execution_mode":"...","verification_level":"...","refund_policy":"...","reasoning":"one sentence"}`;
}

function validateClassification(parsed: LLMClassification): LLMClassification {
  const validModes: ExecutionMode[] = ['deterministic', 'template_plus_params', 'full_agent'];
  const validVerify: VerificationLevel[] = ['none', 'deterministic', 'browser_flow', 'quality_review', 'hybrid'];
  const validRefund = ['auto_eligible', 'manual_review', 'no_refund'];

  return {
    execution_mode: validModes.includes(parsed.execution_mode) ? parsed.execution_mode : 'full_agent',
    verification_level: validVerify.includes(parsed.verification_level) ? parsed.verification_level : 'none',
    refund_policy: validRefund.includes(parsed.refund_policy) ? parsed.refund_policy as LLMClassification['refund_policy'] : 'manual_review',
    reasoning: parsed.reasoning ?? 'Classified by AI',
  };
}

// ── Haiku (Primary classifier) ──

async function classifyWithHaiku(input: {
  title: string;
  description: string;
  tag: string;
}): Promise<LLMClassification> {
  const anthropic = new Anthropic();

  // G-LLM-001: 30s timeout for classification (quick call)
  const response = await callAnthropicWithTimeout(
    anthropic,
    {
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildClassifierPrompt(input) }],
    },
    { timeoutMs: 30000, label: 'governance_classify_haiku' }
  ) as Anthropic.Message;

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(text) as LLMClassification;
  return validateClassification(parsed);
}

// ── Gemini Flash 3 (Fallback classifier) ──

async function classifyWithGemini(input: {
  title: string;
  description: string;
  tag: string;
}): Promise<LLMClassification> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: CLASSIFIER_SYSTEM_PROMPT,
  });

  // G-LLM-001: 30s timeout for classification
  const result = await callGeminiWithTimeout(
    () => model.generateContent(buildClassifierPrompt(input)),
    { timeoutMs: 30000, label: 'governance_classify_gemini' }
  ) as { response: { text: () => string } };
  const text = result.response.text();
  const parsed = JSON.parse(text) as LLMClassification;
  return validateClassification(parsed);
}

// ══════════════════════════════════════════════════════════════════
// MAIN EVALUATION
// Source: Domain 12.4 "Task Governance System"
// 1 task = 1 credit, deducted at start_task (Domain 5.4)
// 4-hour max per task (Domain 5.4)
// ══════════════════════════════════════════════════════════════════

export async function evaluateTask(input: {
  title: string;
  description: string;
  tag: string;
  companyId: string;
}): Promise<GovernanceDecision> {
  const { title, description, tag, companyId } = input;

  // Step 1: Prerequisites (OAuth checks)
  const blockerReason = checkPrerequisites(tag);
  if (blockerReason) {
    return {
      verdict: 'blocked',
      execution_mode: classifyExecutionMode(tag) ?? 'full_agent',
      estimated_credits: 1,
      verification_level: classifyVerificationLevel(tag) ?? 'none',
      blocker_reason: blockerReason,
      refund_policy: 'no_refund',
      founder_safe_explanation: blockerReason,
    };
  }

  // Step 2: Split detection
  const needsSplit = detectSplit(title, description ?? '');
  if (needsSplit) {
    return {
      verdict: 'split_required',
      execution_mode: classifyExecutionMode(tag) ?? 'full_agent',
      estimated_credits: 1,
      verification_level: classifyVerificationLevel(tag) ?? 'none',
      refund_policy: classifyRefundPolicy(tag),
      founder_safe_explanation:
        'This looks like multiple deliverables bundled together. Each task should be one founder-visible outcome (1 credit each). Want me to suggest how to split it?',
    };
  }

  // Step 3: Credit check
  const balance = await creditService.getBalance(companyId);
  if (balance < 1) {
    return {
      verdict: 'blocked',
      execution_mode: classifyExecutionMode(tag) ?? 'full_agent',
      estimated_credits: 1,
      verification_level: classifyVerificationLevel(tag) ?? 'none',
      blocker_reason: 'Insufficient credits.',
      refund_policy: 'no_refund',
      founder_safe_explanation:
        `You need at least 1 credit but your balance is ${balance}. Planning stays free — only execution pauses. Buy more credits to continue.`,
    };
  }

  // Step 3b: Failure feedback — check if this tag has a pattern of repeated failures.
  // If the same type of task has failed 3+ times (open fingerprints), force full_agent mode
  // and reduce max_turns to encourage a more careful, narrower approach.
  let failureWarning: string | null = null;
  let forceFullAgent = false;
  try {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [tagFailures] = await db
      .select({ count: sql<number>`count(*)` })
      .from(failureFingerprints)
      .where(
        and(
          sql`${failureFingerprints.affected_agents} @> '[]'::jsonb`, // any agent
          eq(failureFingerprints.fix_status, 'open'),
          gte(failureFingerprints.last_seen_at, since30d),
          sql`${failureFingerprints.category} IN ('tool_failure', 'timeout', 'scope')`,
        )
      );

    const openFailures = Number(tagFailures?.count ?? 0);
    if (openFailures >= 3) {
      forceFullAgent = true;
      failureWarning = `⚠️ Similar tasks have failed ${openFailures}× recently. Running in careful full-agent mode.`;
      log.warn('Failure feedback: forcing full_agent mode', { tag, openFailures });
    }
  } catch (err) {
    // Non-blocking: governance should never fail due to fingerprint lookup errors
    log.warn('Failure feedback lookup failed', { tag, error: err instanceof Error ? err.message : 'Unknown' });
  }

  // Step 4: Classification — deterministic or LLM fallback
  let executionMode: ExecutionMode;
  let verificationLevel: VerificationLevel;
  let refundPolicy: 'auto_eligible' | 'manual_review' | 'no_refund';
  let explanation: string;

  if (isKnownTag(tag)) {
    executionMode = forceFullAgent ? 'full_agent' : (classifyExecutionMode(tag) ?? 'full_agent');
    verificationLevel = classifyVerificationLevel(tag) ?? 'none';
    refundPolicy = classifyRefundPolicy(tag);
    const modeLabel = executionMode.replace(/_/g, ' ');
    const verifyLabel = verificationLevel === 'none' ? 'no' : verificationLevel.replace(/_/g, ' ');
    explanation = `1 credit. Runs in ${modeLabel} mode with ${verifyLabel} verification.${
      failureWarning ? `\n\n${failureWarning}` : ''
    }`;
  } else {
    const llmResult = await classifyWithLLM({ title, description, tag });
    executionMode = forceFullAgent ? 'full_agent' : llmResult.execution_mode;
    verificationLevel = llmResult.verification_level;
    refundPolicy = llmResult.refund_policy;
    explanation = `1 credit. ${llmResult.reasoning}${failureWarning ? `\n\n${failureWarning}` : ''}`;
  }

  return {
    verdict: 'approved',
    execution_mode: executionMode,
    estimated_credits: 1,
    verification_level: verificationLevel,
    refund_policy: refundPolicy,
    founder_safe_explanation: explanation,
  };
}

// ══════════════════════════════════════════════════════════════════
// CREDIT QUOTING (SPEC-CEO-001)
// 5-field structured quote: credits_required, task_split,
// founder_safe_reason, included_scope, blockers.
// CEO calls this BEFORE evaluateTask to present the quote to the founder.
// ══════════════════════════════════════════════════════════════════

/** Suggest how to split a bundled task into individual deliverables */
function suggestSplit(title: string, description: string, tag: string): Array<{ title: string; description: string; tag: string }> {
  const combined = `${title} ${description}`;
  const splits: Array<{ title: string; description: string; tag: string }> = [];

  // Extract deliverables by splitting on "and" conjunctions at sentence level
  const deliverables = combined
    .split(/\b(?:and|plus|additionally|also)\b/i)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  if (deliverables.length >= 2) {
    for (const d of deliverables) {
      // Derive a tag from the content or fall back to original
      const inferredTag = inferTagFromContent(d) ?? tag;
      splits.push({
        title: d.length > 80 ? d.substring(0, 77) + '...' : d,
        description: d,
        tag: inferredTag,
      });
    }
  }

  // If conjunction splitting didn't produce results, try screen/page patterns
  if (splits.length === 0) {
    const screenMatch = combined.match(/(\d+)\s*(pages?|screens?|endpoints?)/i);
    if (screenMatch) {
      const count = Math.min(parseInt(screenMatch[1], 10), 5);
      for (let i = 1; i <= count; i++) {
        splits.push({
          title: `${title} — part ${i}/${count}`,
          description: `Part ${i} of ${count} from: ${description}`,
          tag,
        });
      }
    }
  }

  return splits;
}

/** Try to infer a tag from free-text content */
function inferTagFromContent(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('landing') || lower.includes('page')) return 'landing-page';
  if (lower.includes('auth') || lower.includes('login') || lower.includes('signup')) return 'auth';
  if (lower.includes('dashboard')) return 'dashboard';
  if (lower.includes('billing') || lower.includes('payment') || lower.includes('stripe')) return 'billing';
  if (lower.includes('deploy')) return 'deploy';
  if (lower.includes('css') || lower.includes('style')) return 'css';
  if (lower.includes('seo') || lower.includes('meta tag')) return 'seo';
  if (lower.includes('api') || lower.includes('endpoint')) return 'api';
  if (lower.includes('database') || lower.includes('schema')) return 'database';
  return null;
}

/** Human-readable scope description for the founder */
function buildScopeDescription(mode: ExecutionMode, tag: string): string {
  const modeLabel = mode === 'deterministic' ? 'Quick change'
    : mode === 'template_plus_params' ? 'Standard build'
    : 'Full development';

  const tagLabel = tag.replace(/[-_]/g, ' ');
  return `${modeLabel}: ${tagLabel}. 1 credit covers the full task including verification.`;
}

/** Founder-safe reason string (never exposes internal details) */
function buildFounderReason(
  credits: number,
  mode: ExecutionMode,
  blockers: string[],
): string {
  if (blockers.length > 0) {
    return `This task can't run right now: ${blockers.join('; ')}`;
  }

  if (credits > 1) {
    return `This looks like ${credits} separate deliverables. Each one costs 1 credit (${credits} total). Want me to split it?`;
  }

  const speed = mode === 'deterministic' ? 'quickly'
    : mode === 'template_plus_params' ? 'using a proven pattern'
    : 'with full attention';
  return `1 credit. I'll handle this ${speed}.`;
}

/**
 * Structured credit quote for the CEO to present to the founder.
 * Returns the 5-field CreditQuote (SPEC-CEO-001).
 * CEO calls this BEFORE evaluateTask() — it answers "how much will this cost?"
 * without creating or committing to anything.
 */
export async function quoteTask(input: {
  title: string;
  description: string;
  tag: string;
  companyId: string;
}): Promise<CreditQuote> {
  const { title, description, tag, companyId } = input;

  // 1. Split detection
  const needsSplit = detectSplit(title, description ?? '');
  const task_split = needsSplit ? suggestSplit(title, description ?? '', tag) : [];

  // 2. Credits = 1 per task, or N if split
  const credits_required = needsSplit && task_split.length > 1 ? task_split.length : 1;

  // 3. Blockers (prerequisites + balance)
  const blockers: string[] = [];
  const prereq = checkPrerequisites(tag);
  if (prereq) blockers.push(prereq);

  const balance = await creditService.getBalance(companyId);
  if (balance < credits_required) {
    blockers.push(`Need ${credits_required} credit${credits_required > 1 ? 's' : ''}, balance is ${balance}`);
  }

  // 4. Scope
  const mode = classifyExecutionMode(tag) ?? 'full_agent';
  const included_scope = buildScopeDescription(mode, tag);

  // 5. Founder-safe reason
  const founder_safe_reason = buildFounderReason(credits_required, mode, blockers);

  return { credits_required, task_split, founder_safe_reason, included_scope, blockers };
}

// ══════════════════════════════════════════════════════════════════
// PERMISSION SNAPSHOT (SPEC-CTRL-105)
// Run-level permission envelope — what a worker can do during execution.
// Built before dispatch and stored on the execution record.
// ══════════════════════════════════════════════════════════════════

/** Agent ID → tool mount profile (which tool families this agent can use) */
const AGENT_TOOL_PROFILES: Record<number, string[]> = {
  30: ['base', 'engineering'],           // Engineering
  29: ['base', 'research'],              // Research
  33: ['base', 'data'],                  // Data
  32: ['base', 'support'],               // Support
  40: ['base', 'twitter', 'documents'],  // Twitter
  41: ['base', 'meta-ads'],              // Meta Ads
  42: ['base', 'browser', 'email'],      // Browser
  54: ['base', 'outreach', 'documents'], // Cold Outreach
};

/** Tags that involve external side effects — agents should be warned/restricted */
const DANGEROUS_ACTION_TAGS = new Set([
  'meta-ads', 'facebook-ads', 'instagram-ads', 'ad-campaign', 'ad-creative',
  'outreach', 'cold-email', 'lead-gen', 'prospecting',
  'tweet', 'social',
  'account-setup', 'form-fill',
]);

/**
 * Build a PermissionSnapshot for a task execution.
 * Defines the run-level permission envelope: what tools are allowed,
 * risk ceiling, and turn budget.
 */
export function buildPermissionSnapshot(
  task: { execution_mode?: string | null; max_turns: number; tag: string },
  agentId: number,
): PermissionSnapshot {
  const toolProfile = AGENT_TOOL_PROFILES[agentId] ?? ['base'];

  // Derive allowed tool names from profile
  const allowedTools = [...toolProfile];

  // Forbidden actions based on tag risk
  const forbidden: string[] = [];
  if (!DANGEROUS_ACTION_TAGS.has(task.tag.toLowerCase())) {
    // If this isn't a dangerous-action task, forbid external mutations
    forbidden.push('external_write', 'ad_spend', 'send_email_external');
  }

  // Risk ceiling based on execution mode
  const mode = task.execution_mode ?? 'full_agent';
  const riskCeiling: 'low' | 'medium' | 'high' = mode === 'deterministic'
    ? 'low'
    : mode === 'template_plus_params'
      ? 'medium'
      : 'high';

  // Turn budget — deterministic and template modes cap this
  const maxTurns = mode === 'deterministic'
    ? Math.min(task.max_turns, 10)
    : mode === 'template_plus_params'
      ? Math.min(task.max_turns, 30)
      : task.max_turns;

  return {
    tool_mount_profile: toolProfile,
    allowed_tools: allowedTools,
    forbidden_actions: forbidden,
    risk_ceiling: riskCeiling,
    max_turns: maxTurns,
  };
}
