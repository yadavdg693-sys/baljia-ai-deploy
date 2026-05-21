// Platform-Ops Verifier Agent (independent review of writer's PR)
//
// Reads the bug + the writer's diff but NOT the writer's diagnosis or
// reasoning (avoid anchoring). Re-reproduces the bug, applies the diff
// mentally via tools, votes approve/reject/needs_changes. Posts the vote
// as a PR comment + updates platform_ops_runs.
//
// Different prompt than writer; can be configured to use a different
// model via PLATFORM_OPS_VERIFIER_MODEL.

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, desc, and } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import {
  isAnthropicOAuthAvailable,
  createAnthropicWithOAuthAsync,
  withClaudeCodeIdentity,
} from '@/lib/anthropic-oauth';
import { callAnthropicWithTimeout } from '@/lib/llm-safety';

const log = createLogger('PlatformOpsVerifier');

const REPO_ROOT = process.cwd();
// Verifier uses the SAME read whitelist as triage. NO write tools.
const READ_WHITELIST_PREFIXES = ['src/', '.claude/skills/', 'drizzle/', 'docs/', 'public/'];
const READ_WHITELIST_FILES = ['package.json', 'wrangler.toml', 'render.yaml', 'tsconfig.json', 'CLAUDE.md', '.gitignore'];
const READ_DENYLIST_PATTERNS = [/\.env/i, /\.credentials/i, /credentials\.json/i, /node_modules/i];

const MAX_FILE_BYTES = 200 * 1024;
const MODEL = process.env.PLATFORM_OPS_VERIFIER_MODEL ?? process.env.PLATFORM_OPS_MODEL ?? 'claude-opus-4-6';
const MAX_TURNS = 20;

function isReadAllowed(p: string): boolean {
  if (isAbsolute(p) || p.includes('..')) return false;
  if (READ_DENYLIST_PATTERNS.some((pat) => pat.test(p))) return false;
  if (READ_WHITELIST_FILES.includes(p)) return true;
  return READ_WHITELIST_PREFIXES.some((pre) => p.startsWith(pre));
}

const VERIFIER_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file. Read-only.',
    input_schema: { type: 'object' as const, properties: { path: { type: 'string' as const } }, required: ['path'] },
  },
  {
    name: 'read_pr_diff',
    description: 'Get the full diff of the PR being reviewed (already fetched). No input needed.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'submit_verification',
    description: 'FINAL output. Cast your vote on the PR.',
    input_schema: {
      type: 'object' as const,
      properties: {
        vote: { type: 'string' as const, enum: ['approve', 'reject', 'needs_changes'], description: 'Your independent verdict.' },
        reasoning: { type: 'string' as const, description: 'Multi-paragraph reasoning. Explain what you verified, what concerns remain, and why your vote.' },
        diff_addresses_bug: { type: 'boolean' as const, description: 'Does this diff actually address the original bug, based on your independent reproduction?' },
        diff_touches_offlimits: { type: 'boolean' as const, description: 'Does the diff modify any off-limits files (auth, billing, schema, secrets, configs)?' },
        regression_concerns: { type: 'string' as const, description: 'Any regressions you spotted. Empty string if none.' },
      },
      required: ['vote', 'reasoning', 'diff_addresses_bug', 'diff_touches_offlimits', 'regression_concerns'],
    },
  },
];

interface VerifyOutput {
  vote: 'approve' | 'reject' | 'needs_changes';
  reasoning: string;
  diff_addresses_bug: boolean;
  diff_touches_offlimits: boolean;
  regression_concerns: string;
}

const SYSTEM_PROMPT = `You are the Baljia Platform Verifier Agent. A different agent (the Writer) has produced a PR fixing a platform bug. Your job is INDEPENDENT review.

You will see:
  - The original bug (description, severity)
  - The diff (the writer's proposed fix)

You will NOT see:
  - The triage agent's diagnosis (avoid anchoring)
  - The writer's reasoning (avoid anchoring)

Your independent review:
  1. From the bug description ALONE, predict where the fix should land.
  2. Read the diff. Does it land where you predicted, or somewhere unexpected?
  3. Does the diff actually address the symptom the bug describes?
  4. Does the diff touch any OFF-LIMITS files? (auth, billing, schema, .env, credentials, wrangler.toml, render.yaml, package.json, db/schema.ts) — those are humans-only and a violation should be a HARD reject.
  5. Spot-check: any obvious regressions? (API contract changes, removed exports, broken imports, type errors)
  6. Vote: approve, reject, or needs_changes — with reasoning.

You are conservative by default. If you're not sure, prefer needs_changes over approve. Reject is for clear violations or wrong fixes.

Always end with submit_verification.`;

interface VerifyResult {
  feedbackId: string;
  runId: string;
  status: 'done' | 'failed' | 'skipped';
  reason?: string;
  vote?: VerifyOutput['vote'];
  reasoning?: string;
  prCommentUrl?: string;
  turns: number;
  wallClockSeconds: number;
  costCents: number;
}

async function postPrComment(prNumber: number, body: string): Promise<{ url: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  const remote = execSync('git remote get-url origin', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const m = remote.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot parse repo from origin: ${remote}`);
  const [, owner, repo] = m;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`PR comment failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json() as { html_url: string };
  return { url: data.html_url };
}

async function fetchPrDiff(prNumber: number): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  const remote = execSync('git remote get-url origin', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const m = remote.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot parse repo: ${remote}`);
  const [, owner, repo] = m;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3.diff' },
  });
  if (!res.ok) throw new Error(`Diff fetch failed: ${res.status}`);
  return await res.text();
}

export async function verifyOpenPr(feedbackId: string): Promise<VerifyResult> {
  const result: VerifyResult = { feedbackId, runId: '', status: 'failed', turns: 0, wallClockSeconds: 0, costCents: 0 };
  const start = Date.now();

  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    result.status = 'skipped'; result.reason = 'PLATFORM_OPS_PAUSED'; return result;
  }

  const [bug] = await db.select().from(platformFeedback).where(eq(platformFeedback.id, feedbackId)).limit(1);
  if (!bug) { result.reason = 'bug not found'; return result; }
  if (bug.status !== 'pr_open') { result.reason = `bug not in pr_open (status=${bug.status})`; return result; }

  // Find the writer run with the PR info
  const [writerRun] = await db.select().from(platformOpsRuns)
    .where(and(eq(platformOpsRuns.feedback_id, bug.id), eq(platformOpsRuns.agent_role, 'writer')))
    .orderBy(desc(platformOpsRuns.created_at)).limit(1);
  if (!writerRun?.pr_number) { result.reason = 'no PR number on writer run'; return result; }

  const [run] = await db.insert(platformOpsRuns).values({
    feedback_id: bug.id, agent_role: 'verifier', phase: 'review', status: 'running',
    llm_provider: 'anthropic', llm_model: MODEL, pr_number: writerRun.pr_number, pr_url: writerRun.pr_url,
  }).returning({ id: platformOpsRuns.id });
  result.runId = run.id;

  log.info('Verifier started', { feedbackId, runId: run.id, prNumber: writerRun.pr_number });

  try {
    if (!isAnthropicOAuthAvailable()) throw new Error('Anthropic OAuth not available');
    const { client, isOAuth } = await createAnthropicWithOAuthAsync();

    const prDiff = await fetchPrDiff(writerRun.pr_number);

    const userPrompt = [
      `BUG (id: ${bug.id})`,
      `Severity: ${bug.severity}`,
      `Title: ${bug.title}`,
      `Description: ${bug.description ?? '(none)'}`,
      ``,
      `THE PR DIFF:`,
      `\`\`\`diff`,
      prDiff.slice(0, 8000),
      `\`\`\``,
      ``,
      `Verify independently. End with submit_verification.`,
    ].join('\n');

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let verdict: VerifyOutput | null = null;
    let turns = 0;

    while (turns < MAX_TURNS) {
      turns++;
      const resp = await callAnthropicWithTimeout(client, {
        model: MODEL,
        max_tokens: 4096,
        system: withClaudeCodeIdentity(SYSTEM_PROMPT, isOAuth),
        tools: VERIFIER_TOOLS,
        messages,
      }, { timeoutMs: 120_000, label: `verifier_turn_${turns}` }) as Anthropic.Message;

      totalInputTokens += resp.usage?.input_tokens ?? 0;
      totalOutputTokens += resp.usage?.output_tokens ?? 0;

      const toolUses = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      if (toolUses.length === 0) throw new Error('Verifier ended without submit_verification');

      messages.push({ role: 'assistant', content: resp.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let submitted = false;

      for (const use of toolUses) {
        let resultText: string;
        switch (use.name) {
          case 'read_file': {
            const path = String((use.input as { path: string }).path ?? '').trim();
            if (!isReadAllowed(path)) { resultText = `[blocked] not in read whitelist: ${path}`; break; }
            const full = join(REPO_ROOT, path);
            if (!existsSync(full)) { resultText = `[not found] ${path}`; break; }
            try {
              const stat = statSync(full);
              if (stat.size > MAX_FILE_BYTES) { resultText = `[too large] ${stat.size}B`; break; }
              resultText = readFileSync(full, 'utf8');
            } catch (e) { resultText = `[error] ${e instanceof Error ? e.message : String(e)}`; }
            break;
          }
          case 'read_pr_diff':
            resultText = prDiff.slice(0, 8000);
            break;
          case 'submit_verification':
            verdict = use.input as VerifyOutput;
            submitted = true;
            resultText = 'Verdict received.';
            break;
          default:
            resultText = `[error] unknown tool: ${use.name}`;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: resultText });
      }

      messages.push({ role: 'user', content: toolResults });
      if (submitted && verdict) break;
    }

    if (!verdict) throw new Error(`No verification after ${turns} turns`);

    // Post comment on PR
    const commentBody = [
      `## 🤖 Verifier Agent Review`,
      ``,
      `**Vote:** ${verdict.vote === 'approve' ? '✅ approve' : verdict.vote === 'reject' ? '❌ reject' : '⚠️ needs changes'}`,
      ``,
      `**Diff addresses bug:** ${verdict.diff_addresses_bug ? '✓ yes' : '✗ no'}`,
      `**Touches off-limits files:** ${verdict.diff_touches_offlimits ? '⚠️ YES — review carefully' : '✓ no'}`,
      ``,
      `**Reasoning:**`,
      verdict.reasoning,
      ``,
      verdict.regression_concerns ? `**Regression concerns:** ${verdict.regression_concerns}` : '',
      ``,
      `*Independent review by Platform-Ops Verifier (model: ${MODEL}). Writer's diagnosis was withheld to avoid anchoring.*`,
    ].filter(Boolean).join('\n');

    const comment = await postPrComment(writerRun.pr_number, commentBody);
    log.info('Verifier comment posted', { commentUrl: comment.url, vote: verdict.vote });

    const wallClockSeconds = Math.round((Date.now() - start) / 1000);
    const costCents = Math.round(totalInputTokens * 0.0003 + totalOutputTokens * 0.0015);
    await db.update(platformOpsRuns).set({
      status: 'done',
      verifier_vote: verdict.vote,
      verifier_reasoning: verdict.reasoning,
      turns, wall_clock_seconds: wallClockSeconds, cost_cents: costCents,
      completed_at: new Date(),
    }).where(eq(platformOpsRuns.id, run.id));

    result.status = 'done';
    result.vote = verdict.vote;
    result.reasoning = verdict.reasoning;
    result.prCommentUrl = comment.url;
    result.turns = turns;
    result.wallClockSeconds = wallClockSeconds;
    result.costCents = costCents;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Verifier failed', { feedbackId, runId: run.id, error: msg });
    await db.update(platformOpsRuns).set({
      status: 'failed', error_summary: msg.slice(0, 500),
      wall_clock_seconds: Math.round((Date.now() - start) / 1000), completed_at: new Date(),
    }).where(eq(platformOpsRuns.id, run.id));
    result.reason = msg;
  }

  return result;
}
