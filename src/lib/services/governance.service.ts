// Governance Service — Runtime gatekeeper only
// CEO handles all founder-facing decisions (scoping, splitting, credit quoting).
// Governance handles: execution mode, verification level, permission snapshot, credit enforcement.
//
// Source:
//   Domain 7.4: Credit bands (1 credit per task regardless of complexity)
//   Domain 12.4: Governance system (execution_mode, verification_level)
//   Domain 5.4: 4-hour max per task, 1 credit deducted at start_task

import Anthropic from '@anthropic-ai/sdk';
import type { ExecutionMode, VerificationLevel, PermissionSnapshot } from '@/types';
import * as creditService from './credit.service';
import { callAnthropicWithTimeout, callGeminiWithTimeout } from '@/lib/llm-safety';
import { isAnthropicAvailable, isOpenAIAvailable, callOpenAI, OPENAI_MODELS, getPreferredProvider } from '@/lib/llm-provider';
import { createLogger } from '@/lib/logger';
import { db, failureFingerprints } from '@/lib/db';
import { and, gte, sql } from 'drizzle-orm';

const log = createLogger('Governance');

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = 'gemini-2.5-flash';

// ══════════════════════════════════════════════════════════════════
// EXECUTION MODE CLASSIFICATION
// deterministic: No AI reasoning. Direct file edits, config, CLI.
// template_plus_params: Standard pattern + customize. Pages, forms, templates.
// full_agent: Needs reasoning, diagnosis, design, multi-step decisions.
// ══════════════════════════════════════════════════════════════════

const DETERMINISTIC_TAGS = new Set([
  'css', 'seo', 'seo-meta', 'domain', 'tracking', 'favicon', 'deploy', 'config', 'copy',
]);

const TEMPLATE_TAGS = new Set([
  'landing-page', 'auth', 'billing', 'payment', 'settings', 'legal', 'pricing-page',
  'about-page', 'changelog', 'faq', 'contact-form', 'feedback', 'error-page',
  'email-template', 'email-reply', 'webhook', 'csv-export', 'csv-import',
  'api', 'crud', 'notification', 'form', 'cron', 'blog-post',
]);

const FULL_AGENT_TAGS = new Set([
  'engineering',
  'bug', 'bug-fix', 'fix', 'onboarding', 'dashboard', 'reporting', 'admin',
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

// ══════════════════════════════════════════════════════════════════
// VERIFICATION LEVEL CLASSIFICATION
// ══════════════════════════════════════════════════════════════════

const DETERMINISTIC_VERIFY_TAGS = new Set([
  'api', 'crud', 'database', 'webhook', 'cron', 'sql', 'deploy', 'config',
  'csv-export', 'csv-import', 'security', 'billing', 'payment', 'tracking',
  'email-tracking', 'performance', 'duplicate-detection',
]);

const BROWSER_VERIFY_TAGS = new Set([
  // Generic engineering — most common production tag for "build/modify a feature".
  // Was missing pre-2026-04-28: caused queryforge campaign-generator (tag='engineering')
  // to fall through classifyVerificationLevel → 'none' → verifyNone passes anything.
  'engineering',
  'landing-page', 'auth', 'settings', 'dashboard', 'admin', 'onboarding',
  'reporting', 'pricing-page', 'about-page', 'changelog', 'faq', 'contact-form',
  'feedback', 'error-page', 'form', 'notification', 'ux', 'legal', 'referral',
  'calendar', 'a-b-test', 'multi-user', 'activity-log', 'custom-fields',
  'client-portal', 'onboarding-flow', 'redesign', 'rebrand', 'offboarding',
  'css', 'seo', 'seo-meta', 'favicon', 'domain', 'feature', 'complex-feature',
  'mvp', 'full-crud', 'bug', 'bug-fix', 'fix', 'enrichment', 'product-hunt',
  'automation', 'lead-scoring', 'gdpr',
]);

const QUALITY_VERIFY_TAGS = new Set([
  'tweet', 'social', 'outreach', 'cold-email', 'email-reply', 'email-template',
  'copy', 'lead-gen', 'prospecting', 'blog-post', 'video-script',
  'win-back-email', 'audience-strategy',
]);

const NO_VERIFY_TAGS = new Set([
  'research', 'market-analysis', 'competitor', 'trend',
  'analytics', 'metrics', 'report',
]);

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
// ALL KNOWN TAGS
// If known → deterministic classification (0ms, free)
// If not → LLM fallback via Haiku (~$0.001)
// ══════════════════════════════════════════════════════════════════

const ALL_KNOWN_TAGS = new Set([
  ...DETERMINISTIC_TAGS, ...TEMPLATE_TAGS, ...FULL_AGENT_TAGS,
]);

function isKnownTag(tag: string): boolean {
  return ALL_KNOWN_TAGS.has(tag.toLowerCase().trim());
}

// ══════════════════════════════════════════════════════════════════
// PREREQUISITE CHECK (OAuth requirements)
// ══════════════════════════════════════════════════════════════════

const OAUTH_REQUIRED_TAGS = new Set([
  'twitter', 'social',
  'meta-ads', 'facebook-ads', 'instagram-ads', 'ad-campaign', 'ad-creative', 'audience-strategy',
]);

export function checkPrerequisites(tag: string): string | null {
  const normalized = tag.toLowerCase().trim();
  if (OAUTH_REQUIRED_TAGS.has(normalized)) {
    return `This task requires an OAuth connection for "${normalized}". Connect your account in Settings before running.`;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// LLM FALLBACK — only for unknown tags
// ══════════════════════════════════════════════════════════════════

interface LLMClassification {
  execution_mode: ExecutionMode;
  verification_level: VerificationLevel;
  reasoning: string;
}

const SAFE_DEFAULTS: LLMClassification = {
  execution_mode: 'full_agent',
  verification_level: 'none',
  reasoning: 'Could not classify — using safe defaults.',
};

const CLASSIFIER_SYSTEM_PROMPT = `You classify tasks for an AI platform. Respond ONLY with valid JSON, no markdown.

execution_mode: "deterministic" (config, CSS, SEO, deploy), "template_plus_params" (pages, forms, APIs, templates), "full_agent" (features, bugs, research, integrations, automation)
verification_level: "none" (research/reports), "deterministic" (APIs, DB, payments), "browser_flow" (UI pages), "quality_review" (content/copy)`;

function buildClassifierPrompt(input: { tag: string; title: string; description: string }): string {
  return `Classify: Tag="${input.tag}" Title="${input.title}" Description="${input.description}"
JSON: {"execution_mode":"...","verification_level":"...","reasoning":"one sentence"}`;
}

function validateClassification(parsed: LLMClassification): LLMClassification {
  const validModes: ExecutionMode[] = ['deterministic', 'template_plus_params', 'full_agent'];
  const validVerify: VerificationLevel[] = ['none', 'deterministic', 'browser_flow', 'quality_review', 'hybrid'];

  return {
    execution_mode: validModes.includes(parsed.execution_mode) ? parsed.execution_mode : 'full_agent',
    verification_level: validVerify.includes(parsed.verification_level) ? parsed.verification_level : 'none',
    reasoning: parsed.reasoning ?? 'Classified by AI',
  };
}

async function classifyWithHaiku(input: { title: string; description: string; tag: string }): Promise<LLMClassification> {
  const { createAnthropicWithOAuthAsync, withClaudeCodeIdentity } = await import('@/lib/anthropic-oauth');
  const { client: anthropic, isOAuth } = await createAnthropicWithOAuthAsync();
  const response = await callAnthropicWithTimeout(
    anthropic,
    {
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: withClaudeCodeIdentity(CLASSIFIER_SYSTEM_PROMPT, isOAuth) as Anthropic.MessageCreateParams['system'],
      messages: [{ role: 'user', content: buildClassifierPrompt(input) }],
    },
    { timeoutMs: 30000, label: 'governance_classify_haiku' }
  ) as Anthropic.Message;

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const parsed = JSON.parse(text) as LLMClassification;
  return validateClassification(parsed);
}

async function classifyWithOpenAI(input: { title: string; description: string; tag: string }): Promise<LLMClassification> {
  const text = await callOpenAI({
    model: OPENAI_MODELS.GPT_5_4,
    systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    userPrompt: buildClassifierPrompt(input),
    maxTokens: 256,
    timeoutMs: 30_000,
    reasoningEffort: 'xhigh',
  });

  const parsed = JSON.parse(text) as LLMClassification;
  return validateClassification(parsed);
}

async function classifyWithGemini(input: { title: string; description: string; tag: string }): Promise<LLMClassification> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: CLASSIFIER_SYSTEM_PROMPT,
  });

  const result = await callGeminiWithTimeout(
    () => model.generateContent(buildClassifierPrompt(input)),
    { timeoutMs: 30000, label: 'governance_classify_gemini' }
  ) as { response: { text: () => string } };
  const text = result.response.text();
  const parsed = JSON.parse(text) as LLMClassification;
  return validateClassification(parsed);
}

async function classifyWithLLM(input: { title: string; description: string; tag: string }): Promise<LLMClassification> {
  type ClassifyFn = typeof classifyWithHaiku;
  const providers: { name: string; available: () => boolean; classify: ClassifyFn }[] = [
    { name: 'openai',    available: isOpenAIAvailable,    classify: classifyWithOpenAI },
    { name: 'anthropic', available: isAnthropicAvailable, classify: classifyWithHaiku },
    { name: 'gemini',    available: () => true,           classify: classifyWithGemini },
  ];

  const preferred = getPreferredProvider();
  const sorted = [
    providers.find(p => p.name === preferred || (p.name === 'anthropic' && preferred === 'anthropic'))!,
    ...providers.filter(p => p !== providers.find(q => q.name === preferred || (q.name === 'anthropic' && preferred === 'anthropic'))),
  ].filter(Boolean);

  for (const p of sorted) {
    if (!p.available()) continue;
    try {
      return await p.classify(input);
    } catch (err) {
      log.warn(`${p.name} classification failed, trying next`, {});
    }
  }

  log.error('All classifiers failed, using defaults');
  return SAFE_DEFAULTS;
}

// ══════════════════════════════════════════════════════════════════
// MAIN EVALUATION — runtime gatekeeper
// Checks credits, classifies mode/verification, checks failure patterns.
// NO founder-facing strings. CEO handles all communication.
// ══════════════════════════════════════════════════════════════════

export interface RuntimeDecision {
  can_execute: boolean;
  execution_mode: ExecutionMode;
  verification_level: VerificationLevel;
  blocker?: string;
  failure_warning?: string;
  credit_warning?: string;
}

export async function evaluateTask(input: {
  title: string;
  description: string;
  tag: string;
  companyId: string;
}): Promise<RuntimeDecision> {
  const { title, description, tag, companyId } = input;

  // Step 1: Credit check (advisory, not blocking — tasks queue at 0 credits)
  const balance = await creditService.getBalance(companyId);
  const creditWarning = balance < 1 ? 'no_credits' : undefined;

  // Step 2: Prerequisites (OAuth)
  const prereq = checkPrerequisites(tag);
  if (prereq) {
    return {
      can_execute: false,
      execution_mode: classifyExecutionMode(tag) ?? 'full_agent',
      verification_level: classifyVerificationLevel(tag) ?? 'none',
      blocker: prereq,
    };
  }

  // Step 3: Failure pattern check — force full_agent if similar tasks keep failing
  let failureWarning: string | undefined;
  let forceFullAgent = false;
  try {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [tagFailures] = await db
      .select({ count: sql<number>`count(*)` })
      .from(failureFingerprints)
      .where(
        and(
          sql`${failureFingerprints.affected_agents} @> '[]'::jsonb`,
          sql`${failureFingerprints.fix_status} = 'open'`,
          gte(failureFingerprints.last_seen_at, since30d),
          sql`${failureFingerprints.category} IN ('tool_failure', 'timeout', 'scope')`,
        )
      );

    const openFailures = Number(tagFailures?.count ?? 0);
    if (openFailures >= 3) {
      forceFullAgent = true;
      failureWarning = `Similar tasks have failed ${openFailures}× recently.`;
      log.warn('Failure feedback: forcing full_agent mode', { tag, openFailures });
    }
  } catch {
    // Non-blocking
  }

  // Step 4: Classification
  let executionMode: ExecutionMode;
  let verificationLevel: VerificationLevel;

  if (isKnownTag(tag)) {
    executionMode = forceFullAgent ? 'full_agent' : (classifyExecutionMode(tag) ?? 'full_agent');
    verificationLevel = classifyVerificationLevel(tag) ?? 'none';
  } else {
    const llmResult = await classifyWithLLM({ title, description, tag });
    executionMode = forceFullAgent ? 'full_agent' : llmResult.execution_mode;
    verificationLevel = llmResult.verification_level;
  }

  return {
    can_execute: true,
    execution_mode: executionMode,
    verification_level: verificationLevel,
    failure_warning: failureWarning,
    credit_warning: creditWarning,
  };
}

// ══════════════════════════════════════════════════════════════════
// PERMISSION SNAPSHOT (SPEC-CTRL-105)
// Run-level permission envelope — what a worker can do during execution.
// ══════════════════════════════════════════════════════════════════

const AGENT_TOOL_PROFILES: Record<number, string[]> = {
  30: ['base', 'engineering'],
  29: ['base', 'research'],
  33: ['base', 'data'],
  32: ['base', 'support'],
  40: ['base', 'twitter', 'documents'],
  41: ['base', 'meta-ads'],
  42: ['base', 'browser', 'email'],
  54: ['base', 'outreach', 'documents'],
};

const DANGEROUS_ACTION_TAGS = new Set([
  'meta-ads', 'facebook-ads', 'instagram-ads', 'ad-campaign', 'ad-creative',
  'outreach', 'cold-email', 'lead-gen', 'prospecting',
  'tweet', 'social',
  'account-setup', 'form-fill',
]);

export function buildPermissionSnapshot(
  task: { execution_mode?: string | null; max_turns: number; tag: string },
  agentId: number,
): PermissionSnapshot {
  const toolProfile = AGENT_TOOL_PROFILES[agentId] ?? ['base'];
  const allowedTools = [...toolProfile];

  const forbidden: string[] = [];
  if (!DANGEROUS_ACTION_TAGS.has(task.tag.toLowerCase())) {
    forbidden.push('external_write', 'ad_spend', 'send_email_external');
  }

  const mode = task.execution_mode ?? 'full_agent';
  const riskCeiling: 'low' | 'medium' | 'high' = mode === 'deterministic'
    ? 'low'
    : mode === 'template_plus_params'
      ? 'medium'
      : 'high';

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
