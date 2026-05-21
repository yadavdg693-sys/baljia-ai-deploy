import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, eq } from 'drizzle-orm';

export type DebateVote = 'fix_now' | 'manual_review' | 'wont_fix';
export type DebateRisk = 'low' | 'medium' | 'high';
export type DebateOutcome = 'auto_approve' | 'manual_review' | 'wont_fix';

export interface DebatePerspective {
  model: string;
  vote: DebateVote;
  confidence: number;
  estimatedRisk: DebateRisk;
  filesToModify: string[];
  rootCause: string;
  recommendedFix: string;
  concerns: string[];
}

export interface DebateDecision {
  feedbackId: string;
  outcome: DebateOutcome;
  status: 'approved_to_fix' | 'awaiting_approval' | 'wont_fix';
  approvedBy: string | null;
  estimatedRisk: DebateRisk;
  filesToModify: string[];
  summary: string;
}

export interface DebateRunResult {
  feedbackId: string;
  runId: string;
  status: 'done' | 'failed' | 'skipped';
  decision?: DebateDecision;
  reason?: string;
  costCents: number;
  wallClockSeconds: number;
}

const DEFAULT_GPT_MODEL = 'gpt-5.5';
const DEFAULT_OPUS_MODEL = 'claude-opus-4-7';
const MIN_AUTO_APPROVAL_CONFIDENCE = 0.65;

const AUTONOMOUS_WRITE_ALLOWLIST_PREFIXES = [
  'src/lib/agents/agent-factory.ts',
  'src/lib/agents/tools/',
  'src/lib/services/verification.service.ts',
  'src/lib/services/governance.service.ts',
  'src/lib/services/task.service.ts',
  'src/lib/services/email.service.ts',
  'src/lib/services/event.service.ts',
  'src/lib/services/router.service.ts',
  'src/app/(dashboard)/',
  'src/components/dashboard/',
  '.claude/skills/',
];

const AUTONOMOUS_WRITE_DENYLIST_PATTERNS = [
  /\.env/i,
  /credentials/i,
  /node_modules/i,
  /\.next/i,
  /\.open-next/i,
  /\.wrangler/i,
  /db\/schema\.ts$/i,
  /lib\/auth\.ts$/i,
  /lib\/services\/billing\.service\.ts$/i,
  /lib\/services\/credit\.service\.ts$/i,
  /api\/webhooks\/stripe/i,
  /wrangler\.toml$/i,
  /render\.yaml$/i,
  /package\.json$/i,
  /package-lock\.json$/i,
];

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function isAutonomousFileAllowed(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized || normalized.includes('..')) return false;
  if (AUTONOMOUS_WRITE_DENYLIST_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return AUTONOMOUS_WRITE_ALLOWLIST_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizePath).filter(Boolean))];
}

function normalizeVote(value: unknown): DebateVote {
  return value === 'fix_now' || value === 'wont_fix' ? value : 'manual_review';
}

function normalizeRisk(value: unknown): DebateRisk {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'high';
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function extractJsonObject(raw: string): string {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return withoutFence;
  return withoutFence.slice(start, end + 1);
}

export function parseDebatePerspective(raw: string, model: string): DebatePerspective {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
    return {
      model,
      vote: normalizeVote(parsed.vote),
      confidence: clampConfidence(parsed.confidence),
      estimatedRisk: normalizeRisk(parsed.estimated_risk ?? parsed.estimatedRisk),
      filesToModify: unique(stringArray(parsed.files_to_modify ?? parsed.filesToModify)),
      rootCause: typeof parsed.root_cause === 'string' ? parsed.root_cause : String(parsed.rootCause ?? ''),
      recommendedFix: typeof parsed.recommended_fix === 'string' ? parsed.recommended_fix : String(parsed.recommendedFix ?? ''),
      concerns: stringArray(parsed.concerns),
    };
  } catch (error) {
    return {
      model,
      vote: 'manual_review',
      confidence: 0,
      estimatedRisk: 'high',
      filesToModify: [],
      rootCause: 'Model response could not be parsed.',
      recommendedFix: 'Send to human review before executing.',
      concerns: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function maxRisk(a: DebateRisk, b: DebateRisk): DebateRisk {
  const rank: Record<DebateRisk, number> = { low: 1, medium: 2, high: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export function adjudicateDebate(input: {
  feedbackId: string;
  gpt: DebatePerspective;
  opus: DebatePerspective;
}): DebateDecision {
  const filesToModify = unique([...input.gpt.filesToModify, ...input.opus.filesToModify]);
  const offLimits = filesToModify.filter((file) => !isAutonomousFileAllowed(file));
  const estimatedRisk = maxRisk(input.gpt.estimatedRisk, input.opus.estimatedRisk);
  const minConfidence = Math.min(input.gpt.confidence, input.opus.confidence);

  if (offLimits.length > 0) {
    return {
      feedbackId: input.feedbackId,
      outcome: 'manual_review',
      status: 'awaiting_approval',
      approvedBy: null,
      estimatedRisk: 'high',
      filesToModify,
      summary: `Manual review required: proposed fix touches off-limits files (${offLimits.join(', ')}).`,
    };
  }

  if (input.gpt.vote === 'wont_fix' && input.opus.vote === 'wont_fix') {
    return {
      feedbackId: input.feedbackId,
      outcome: 'wont_fix',
      status: 'wont_fix',
      approvedBy: null,
      estimatedRisk,
      filesToModify,
      summary: 'Both models voted wont_fix; no autonomous PR should be opened.',
    };
  }

  if (input.gpt.vote !== 'fix_now' || input.opus.vote !== 'fix_now') {
    return {
      feedbackId: input.feedbackId,
      outcome: 'manual_review',
      status: 'awaiting_approval',
      approvedBy: null,
      estimatedRisk,
      filesToModify,
      summary: `Manual review required: GPT-5.5 and Opus 4.7 disagreed (${input.gpt.vote} vs ${input.opus.vote}).`,
    };
  }

  if (estimatedRisk === 'high' || minConfidence < MIN_AUTO_APPROVAL_CONFIDENCE) {
    return {
      feedbackId: input.feedbackId,
      outcome: 'manual_review',
      status: 'awaiting_approval',
      approvedBy: null,
      estimatedRisk,
      filesToModify,
      summary: `Manual review required: debate risk=${estimatedRisk}, minimum confidence=${minConfidence.toFixed(2)}.`,
    };
  }

  return {
    feedbackId: input.feedbackId,
    outcome: 'auto_approve',
    status: 'approved_to_fix',
    approvedBy: 'auto:gpt-5.5+opus-4.7',
    estimatedRisk,
    filesToModify,
    summary: `Both models voted fix_now with bounded risk. GPT-5.5: ${input.gpt.recommendedFix} Opus 4.7: ${input.opus.recommendedFix}`,
  };
}

const DEBATE_SYSTEM_PROMPT = `You are one side of Baljia's autonomous support-escalation fix debate.

Return JSON only:
{
  "vote": "fix_now" | "manual_review" | "wont_fix",
  "confidence": number between 0 and 1,
  "estimated_risk": "low" | "medium" | "high",
  "files_to_modify": ["repo-relative path"],
  "root_cause": "one paragraph",
  "recommended_fix": "one paragraph",
  "concerns": ["short concern"]
}

Vote fix_now only when the issue is likely a platform bug, the fix is bounded, and the files are safe for the existing platform-ops writer. Vote manual_review for schema/auth/billing/config changes, unclear repros, or broad architecture. Vote wont_fix only when the escalation is not a platform bug.`;

function debatePrompt(feedback: {
  id: string;
  title: string;
  description: string | null;
  severity: string | null;
  area: string | null;
  occurrence_count: number | null;
  metadata: Record<string, unknown> | null;
}, prior?: { model: string; raw: string }): string {
  return [
    `SUPPORT ESCALATION CLUSTER`,
    `ID: ${feedback.id}`,
    `Severity: ${feedback.severity ?? 'medium'}`,
    `Area: ${feedback.area ?? 'platform'}`,
    `Occurrences: ${feedback.occurrence_count ?? 1}`,
    `Title: ${feedback.title}`,
    `Description:`,
    feedback.description ?? '(none)',
    ``,
    `Metadata:`,
    JSON.stringify(feedback.metadata ?? {}, null, 2).slice(0, 3000),
    prior ? [
      ``,
      `${prior.model} already argued:`,
      prior.raw.slice(0, 3000),
      ``,
      `Debate that proposal. Agree only if it is the right bounded fix; otherwise identify the safer path.`,
    ].join('\n') : '',
  ].filter(Boolean).join('\n');
}

async function callOpusDebater(model: string, prompt: string): Promise<string> {
  const {
    createAnthropicWithOAuthAsync,
    withClaudeCodeIdentity,
  } = await import('@/lib/anthropic-oauth');
  const { callAnthropicWithTimeout } = await import('@/lib/llm-safety');
  const { client, isOAuth } = await createAnthropicWithOAuthAsync();
  const response = await callAnthropicWithTimeout(client, {
    model,
    max_tokens: 1600,
    system: withClaudeCodeIdentity(DEBATE_SYSTEM_PROMPT, isOAuth),
    messages: [{ role: 'user', content: prompt }],
  }, { timeoutMs: 120_000, label: 'support_fix_debate_opus' }) as Anthropic.Message;

  return response.content
    .filter((part): part is Anthropic.TextBlock => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

async function callGptDebater(model: string, prompt: string): Promise<string> {
  const { callOpenAI } = await import('@/lib/llm-provider');
  return callOpenAI({
    model,
    systemPrompt: DEBATE_SYSTEM_PROMPT,
    userPrompt: prompt,
    maxTokens: 1600,
    reasoningEffort: 'high',
    timeoutMs: 120_000,
  });
}

export async function runSupportFixDebate(feedbackId: string): Promise<DebateRunResult> {
  const start = Date.now();
  const gptModel = process.env.PLATFORM_OPS_DEBATE_OPENAI_MODEL ?? DEFAULT_GPT_MODEL;
  const opusModel = process.env.PLATFORM_OPS_DEBATE_ANTHROPIC_MODEL ?? DEFAULT_OPUS_MODEL;
  const result: DebateRunResult = {
    feedbackId,
    runId: '',
    status: 'failed',
    costCents: 0,
    wallClockSeconds: 0,
  };

  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    return { ...result, status: 'skipped', reason: 'PLATFORM_OPS_PAUSED=true' };
  }
  if (process.env.PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED === 'true') {
    return { ...result, status: 'skipped', reason: 'PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED=true' };
  }

  const { db, platformFeedback, platformOpsRuns } = await import('@/lib/db');
  const [feedback] = await db.select().from(platformFeedback).where(eq(platformFeedback.id, feedbackId)).limit(1);
  if (!feedback) return { ...result, reason: 'feedback row not found' };
  if (feedback.status !== 'open') return { ...result, status: 'skipped', reason: `feedback status is ${feedback.status}` };
  if (feedback.source !== 'support') return { ...result, status: 'skipped', reason: `feedback source is ${feedback.source}` };

  const [run] = await db.insert(platformOpsRuns).values({
    feedback_id: feedback.id,
    agent_role: 'debate',
    phase: 'deliberate',
    status: 'running',
    llm_provider: 'openai+anthropic',
    llm_model: `${gptModel}+${opusModel}`,
  }).returning({ id: platformOpsRuns.id });
  result.runId = run.id;

  try {
    const gptRaw = await callGptDebater(gptModel, debatePrompt(feedback));
    const opusRaw = await callOpusDebater(opusModel, debatePrompt(feedback, { model: gptModel, raw: gptRaw }));
    const gpt = parseDebatePerspective(gptRaw, gptModel);
    const opus = parseDebatePerspective(opusRaw, opusModel);
    const decision = adjudicateDebate({ feedbackId, gpt, opus });
    const wallClockSeconds = Math.round((Date.now() - start) / 1000);
    const costCents = Math.max(1, Math.round((gptRaw.length + opusRaw.length) / 600));

    await db.update(platformOpsRuns).set({
      status: 'done',
      diagnosis: decision.summary,
      root_cause: [gpt.rootCause, opus.rootCause].filter(Boolean).join('\n\n'),
      files_to_modify: decision.filesToModify,
      estimated_risk: decision.estimatedRisk,
      test_evidence: { gpt, opus, decision },
      turns: 2,
      wall_clock_seconds: wallClockSeconds,
      cost_cents: costCents,
      completed_at: new Date(),
    }).where(eq(platformOpsRuns.id, run.id));

    await db.update(platformFeedback).set({
      status: decision.status,
      diagnosis: decision.summary,
      estimated_risk: decision.estimatedRisk,
      ops_run_id: run.id,
      resolution: decision.outcome === 'wont_fix' ? 'wont_fix' : null,
      approved_at: decision.outcome === 'auto_approve' ? new Date() : null,
      approved_by: decision.approvedBy,
    }).where(eq(platformFeedback.id, feedback.id));

    return {
      feedbackId,
      runId: run.id,
      status: 'done',
      decision,
      costCents,
      wallClockSeconds,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const wallClockSeconds = Math.round((Date.now() - start) / 1000);
    await db.update(platformOpsRuns).set({
      status: 'failed',
      error_summary: reason.slice(0, 500),
      wall_clock_seconds: wallClockSeconds,
      completed_at: new Date(),
    }).where(eq(platformOpsRuns.id, run.id));
    return {
      feedbackId,
      runId: run.id,
      status: 'failed',
      reason,
      costCents: 0,
      wallClockSeconds,
    };
  }
}

export async function debateOpenSupportFeedback(options: { maxItems?: number } = {}): Promise<DebateRunResult[]> {
  if (process.env.PLATFORM_OPS_PAUSED === 'true' || process.env.PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED === 'true') return [];

  const { db, platformFeedback } = await import('@/lib/db');
  const rows = await db
    .select({ id: platformFeedback.id })
    .from(platformFeedback)
    .where(and(eq(platformFeedback.source, 'support'), eq(platformFeedback.status, 'open')))
    .orderBy(asc(platformFeedback.last_seen_at))
    .limit(options.maxItems ?? 3);

  const results: DebateRunResult[] = [];
  for (const row of rows) {
    results.push(await runSupportFixDebate(row.id));
  }
  return results;
}
