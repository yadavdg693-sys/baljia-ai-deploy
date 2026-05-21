// Platform-Ops Triage Agent (Phase A — read-only diagnosis)
//
// Reads open bugs from platform_feedback, diagnoses each one with bounded
// LLM calls, and writes the diagnosis back. Does NOT modify source code,
// does NOT touch founder data, does NOT open PRs.
//
// Safety:
//   - File reads are whitelisted (src/**, .claude/**, drizzle/**, package.json,
//     wrangler.toml — but NOT .env*, NOT credentials, NOT node_modules)
//   - Tool surface is read-only: read_file, list_dir, grep_repo, check_env_set
//     (returns boolean for env vars, NEVER the value)
//   - Per-run cap on bugs processed
//   - Daily LLM spend cap (separate from founder credits)
//   - PLATFORM_OPS_PAUSED env var halts the entire system
//
// Each invocation writes a row to platform_ops_runs (full audit trail) and
// transitions the feedback row from 'open' → 'awaiting_approval' so the
// human review queue (Gate 1) picks it up.

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, normalize, relative, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import {
  isAnthropicOAuthAvailable,
  createAnthropicWithOAuthAsync,
  withClaudeCodeIdentity,
} from '@/lib/anthropic-oauth';
import { callAnthropicWithTimeout } from '@/lib/llm-safety';

const log = createLogger('PlatformOps');

// ══════════════════════════════════════════════
// SAFETY BOUNDS
// ══════════════════════════════════════════════

const REPO_ROOT = process.cwd();

// File-read whitelist: globs prefix-matched against repo-relative paths.
// Triage agent can READ these. Cannot read anything else.
const READ_WHITELIST_PREFIXES = [
  'src/',
  '.claude/skills/',
  'drizzle/',
  'docs/',
  'public/',
];
const READ_WHITELIST_FILES = [
  'package.json',
  'wrangler.toml',
  'render.yaml',
  'tsconfig.json',
  'CLAUDE.md',
  '.gitignore',
];
// Even within whitelisted dirs, NEVER reveal these (defense-in-depth)
const READ_DENYLIST_PATTERNS = [
  /\.env/i,
  /\.credentials/i,
  /credentials\.json/i,
  /node_modules/i,
  /\.next/i,
  /\.open-next/i,
  /\.wrangler/i,
];

const MAX_FILE_BYTES = 200 * 1024; // 200KB cap per read

function isReadAllowed(repoPath: string): { allowed: boolean; reason?: string } {
  if (REPO_ROOT && (isAbsolute(repoPath) || repoPath.includes('..'))) {
    // Reject absolute paths and traversal
    return { allowed: false, reason: 'absolute paths and ".." traversal not allowed' };
  }
  for (const pat of READ_DENYLIST_PATTERNS) {
    if (pat.test(repoPath)) return { allowed: false, reason: `path matches denylist (secrets-bearing)` };
  }
  if (READ_WHITELIST_FILES.includes(repoPath)) return { allowed: true };
  if (READ_WHITELIST_PREFIXES.some((p) => repoPath.startsWith(p))) return { allowed: true };
  return { allowed: false, reason: `path not in read whitelist (allowed: ${READ_WHITELIST_PREFIXES.join(', ')}, ${READ_WHITELIST_FILES.join(', ')})` };
}

const MODEL = process.env.PLATFORM_OPS_MODEL ?? 'claude-sonnet-4-6';
const MAX_TURNS = Number(process.env.PLATFORM_OPS_MAX_TURNS ?? '20');
const DAILY_BUDGET_USD = Number(process.env.PLATFORM_OPS_DAILY_BUDGET_USD ?? '20');
const MAX_BUGS_PER_RUN = Number(process.env.PLATFORM_OPS_MAX_BUGS_PER_RUN ?? '5');

// Heuristic per-token cost in cents (claude-sonnet-4-6 approximate as of 2026-04)
const COST_PER_INPUT_TOKEN_CENTS = 0.0003;
const COST_PER_OUTPUT_TOKEN_CENTS = 0.0015;

// ══════════════════════════════════════════════
// READ-ONLY TOOLS for the triage agent
// ══════════════════════════════════════════════

const TRIAGE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from the platform repo. Whitelisted to src/, .claude/skills/, drizzle/, docs/, public/, and a few root config files. Cannot read .env*, credentials, node_modules, or anything outside the whitelist. 200KB max per read.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string' as const, description: 'repo-relative path, e.g. "src/lib/agents/agent-factory.ts"' } },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files in a directory of the repo. Same whitelist as read_file.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string' as const, description: 'repo-relative directory path, e.g. "src/lib/services"' } },
      required: ['path'],
    },
  },
  {
    name: 'grep_repo',
    description: 'Search the repo for a pattern (uses ripgrep). Returns up to 50 matches. Pattern is a regex.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string' as const, description: 'regex pattern' },
        path: { type: 'string' as const, description: 'optional path prefix to limit search (default: src/)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'check_env_var_set',
    description: 'Check whether a specific environment variable is set. Returns ONLY a boolean, NEVER the value. Use this to diagnose "X not configured" bugs.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string' as const, description: 'env var name, e.g. "HUNTER_API_KEY"' } },
      required: ['name'],
    },
  },
  {
    name: 'submit_diagnosis',
    description: 'FINAL output. Submit your structured diagnosis. After calling this, your turn ends.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reproduces: {
          type: 'boolean' as const,
          description: 'Does this bug still actually reproduce on current code? false = stale (already fixed)',
        },
        root_cause: {
          type: 'string' as const,
          description: 'One-paragraph plain-English description of the root cause. If reproduces=false, explain why the bug is stale (e.g., what fixed it).',
        },
        files_to_modify: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Repo-relative paths that would need editing to fix this. Empty array if reproduces=false.',
        },
        estimated_risk: {
          type: 'string' as const,
          enum: ['low', 'medium', 'high'],
          description: 'Risk of the fix. low = whitelisted file, mechanical; medium = whitelisted but non-trivial; high = touches sensitive area or requires architectural change.',
        },
        diagnosis: {
          type: 'string' as const,
          description: 'Multi-paragraph diagnosis for the human reviewer at Gate 1. Should explain what the bug is, why it happens, what would fix it, and any concerns.',
        },
      },
      required: ['reproduces', 'root_cause', 'files_to_modify', 'estimated_risk', 'diagnosis'],
    },
  },
];

interface DiagnosisOutput {
  reproduces: boolean;
  root_cause: string;
  files_to_modify: string[];
  estimated_risk: 'low' | 'medium' | 'high';
  diagnosis: string;
}

// ══════════════════════════════════════════════
// TOOL HANDLERS
// ══════════════════════════════════════════════

function handleReadFile(input: { path: string }): string {
  const path = String(input.path ?? '').trim();
  const check = isReadAllowed(path);
  if (!check.allowed) return `[blocked] ${check.reason}`;
  const full = join(REPO_ROOT, path);
  if (!existsSync(full)) return `[not found] ${path}`;
  try {
    const stat = statSync(full);
    if (!stat.isFile()) return `[not a file] ${path}`;
    if (stat.size > MAX_FILE_BYTES) return `[too large] ${stat.size} bytes (max ${MAX_FILE_BYTES})`;
    return readFileSync(full, 'utf8');
  } catch (e) {
    return `[error] ${e instanceof Error ? e.message : String(e)}`;
  }
}

function handleListDir(input: { path: string }): string {
  const path = String(input.path ?? '').trim();
  const check = isReadAllowed(path === '' ? 'src/' : path + '/');
  if (!check.allowed) return `[blocked] ${check.reason}`;
  const full = join(REPO_ROOT, path);
  if (!existsSync(full)) return `[not found] ${path}`;
  try {
    const entries = readdirSync(full, { withFileTypes: true })
      .map((e) => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`)
      .sort();
    return entries.join('\n');
  } catch (e) {
    return `[error] ${e instanceof Error ? e.message : String(e)}`;
  }
}

function handleGrepRepo(input: { pattern: string; path?: string }): string {
  const pattern = String(input.pattern ?? '').trim();
  const path = String(input.path ?? 'src/').trim();
  if (!pattern) return '[error] pattern required';
  const check = isReadAllowed(path);
  if (!check.allowed) return `[blocked] ${check.reason}`;
  try {
    // Try ripgrep first (faster, cleaner output), fall back to system grep -r.
    // Earlier Phase A run found `npx rg` triggers an install prompt — using
    // local node_modules bin path or system rg first, only falling back if absent.
    const rgPath = join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'rg.cmd' : 'rg');
    let cmd: string;
    if (existsSync(rgPath)) {
      cmd = `"${rgPath}" --max-count 50 --line-number --no-heading --color never -e ${JSON.stringify(pattern)} ${JSON.stringify(path)}`;
    } else {
      // Fall back to grep -rn. Same flags map: --line-number, --max-count via head.
      // -E for extended regex (ripgrep is regex by default).
      cmd = process.platform === 'win32'
        // Windows doesn't ship grep — use findstr (line numbers via /N)
        ? `findstr /N /S /R /C:${JSON.stringify(pattern)} ${JSON.stringify(join(path, '*'))}`
        : `grep -rEn --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" -e ${JSON.stringify(pattern)} ${JSON.stringify(path)} | head -50`;
    }
    const out = execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024, timeout: 15_000 });
    return out.length > 0 ? out : '[no matches]';
  } catch (e) {
    const stderr = (e as { stderr?: Buffer | string })?.stderr;
    const stderrStr = stderr instanceof Buffer ? stderr.toString('utf8') : (stderr ?? '');
    if ((e as { status?: number })?.status === 1 && !stderrStr) return '[no matches]';
    return `[error] grep_repo failed — fall back to read_file/list_dir if you need to inspect specific files. (${e instanceof Error ? e.message.slice(0, 100) : String(e).slice(0, 100)})`;
  }
}

function handleCheckEnvVarSet(input: { name: string }): string {
  const name = String(input.name ?? '').trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return '[invalid env var name]';
  const isSet = !!process.env[name];
  return `${name} is ${isSet ? 'SET' : 'NOT SET'}`;
}

// ══════════════════════════════════════════════
// MAIN: triage one bug
// ══════════════════════════════════════════════

interface TriageResult {
  feedbackId: string;
  runId: string;
  status: 'done' | 'failed' | 'skipped';
  reason?: string;
  diagnosis?: DiagnosisOutput;
  turns: number;
  wallClockSeconds: number;
  costCents: number;
}

const SYSTEM_PROMPT = `You are the Baljia Platform Triage Agent. Your job: read an open bug report from the platform's bug-feedback table, investigate the codebase, and produce a structured diagnosis for human review.

You can ONLY read code. You cannot modify anything, run scripts that change data, or write to founder DBs. Your only output is a structured diagnosis via submit_diagnosis.

Investigate thoroughly:
1. Try to determine if the bug still reproduces on current code (it might have already been fixed — check recent code, especially src/lib/agents/agent-factory.ts dispatcher sets, src/lib/services/verification.service.ts, and any path the bug description points to).
2. Find the root cause by reading the relevant code.
3. List the specific files that would need to change.
4. Estimate the risk of fixing (low: whitelisted mechanical edit; medium: whitelisted but non-trivial; high: sensitive area, architectural change).
5. Write a clear diagnosis for the human reviewer.

Be concise. Don't speculate beyond what the code shows. If a bug is stale (already fixed), explicitly say so and reference the fix you found in the code.

Always end your investigation with submit_diagnosis. Do not chain more reads after submitting.`;

export async function triageBug(feedbackId: string): Promise<TriageResult> {
  const result: TriageResult = {
    feedbackId, runId: '', status: 'failed',
    turns: 0, wallClockSeconds: 0, costCents: 0,
  };
  const start = Date.now();

  // Kill switches
  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    result.status = 'skipped';
    result.reason = 'PLATFORM_OPS_PAUSED=true';
    return result;
  }
  if (await dailyBudgetExceeded()) {
    result.status = 'skipped';
    result.reason = `daily LLM budget exceeded (${DAILY_BUDGET_USD} USD)`;
    return result;
  }

  // Load the bug
  const [bug] = await db.select().from(platformFeedback).where(eq(platformFeedback.id, feedbackId)).limit(1);
  if (!bug) { result.reason = 'feedback row not found'; return result; }

  // Create the run row
  const [run] = await db.insert(platformOpsRuns).values({
    feedback_id: bug.id,
    agent_role: 'triage',
    phase: 'diagnose',
    status: 'running',
    llm_provider: 'anthropic',
    llm_model: MODEL,
  }).returning({ id: platformOpsRuns.id });
  result.runId = run.id;

  log.info('Triage started', { feedbackId, runId: run.id, title: bug.title?.slice(0, 50) });

  try {
    // Anthropic OAuth client
    if (!isAnthropicOAuthAvailable()) {
      throw new Error('Anthropic OAuth not available — run claude login');
    }
    const { client, isOAuth } = await createAnthropicWithOAuthAsync();

    const userPrompt = [
      `BUG REPORT (id: ${bug.id})`,
      `Type: ${bug.type}  |  Severity: ${bug.severity}  |  Status: ${bug.status}`,
      `Title: ${bug.title}`,
      `Description: ${bug.description ?? '(none)'}`,
      `Reported: ${bug.created_at}`,
      ``,
      `Investigate. End with submit_diagnosis.`,
    ].join('\n');

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let diagnosis: DiagnosisOutput | null = null;
    let turns = 0;

    // Critical-severity bugs deserve more turns (they're more complex).
    // Defaults: medium/high → 20 turns, critical → 35.
    const turnCap = bug.severity === 'critical' ? Math.max(MAX_TURNS, 35) : MAX_TURNS;

    // Track that we sent a "wrap up now" nudge — only do it once.
    let nudged = false;

    while (turns < turnCap) {
      turns++;
      const resp = await callAnthropicWithTimeout(client, {
        model: MODEL,
        max_tokens: 4096,
        system: withClaudeCodeIdentity(SYSTEM_PROMPT, isOAuth),
        tools: TRIAGE_TOOLS,
        messages,
        // 120s — context grows with each turn (tool results accumulate),
        // and complex bugs may need 25+ turns. Default 60s caused the
        // critical task-disappearing bug to time out at turn 27.
      }, { timeoutMs: 120_000, label: `triage_turn_${turns}` }) as Anthropic.Message;

      totalInputTokens += resp.usage?.input_tokens ?? 0;
      totalOutputTokens += resp.usage?.output_tokens ?? 0;

      const toolUses = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      if (toolUses.length === 0) {
        // Model stopped without calling submit_diagnosis — abort
        throw new Error('Agent ended turn without calling submit_diagnosis');
      }

      // Add assistant message + tool results
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let submitted = false;

      for (const use of toolUses) {
        let resultText: string;
        switch (use.name) {
          case 'read_file': resultText = handleReadFile(use.input as { path: string }); break;
          case 'list_dir': resultText = handleListDir(use.input as { path: string }); break;
          case 'grep_repo': resultText = handleGrepRepo(use.input as { pattern: string; path?: string }); break;
          case 'check_env_var_set': resultText = handleCheckEnvVarSet(use.input as { name: string }); break;
          case 'submit_diagnosis':
            diagnosis = use.input as DiagnosisOutput;
            submitted = true;
            resultText = 'Diagnosis received. Triage complete.';
            break;
          default:
            resultText = `[error] unknown tool: ${use.name}`;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: resultText });
      }

      messages.push({ role: 'user', content: toolResults });
      if (submitted && diagnosis) break;

      // If we're 5 turns from the cap and still no diagnosis submitted,
      // nudge the agent: "wrap up now, submit your best diagnosis".
      // This avoids the failure mode we hit on the critical bug — agent kept
      // exploring instead of synthesizing.
      if (!nudged && turns >= turnCap - 5) {
        nudged = true;
        messages.push({
          role: 'user',
          content: `[SYSTEM NUDGE] You have ${turnCap - turns} turns remaining. STOP investigating and call submit_diagnosis NOW with your best understanding. If you don't have certainty, set estimated_risk='high' and explain what you couldn't verify in the diagnosis text — that's fine. The human reviewer will read your partial findings.`,
        });
      }
    }

    if (!diagnosis) {
      throw new Error(`No diagnosis after ${turns} turns (cap=${turnCap})`);
    }

    // Compute cost
    const costCents = Math.round(
      totalInputTokens * COST_PER_INPUT_TOKEN_CENTS +
      totalOutputTokens * COST_PER_OUTPUT_TOKEN_CENTS,
    );

    // Persist diagnosis to platform_ops_runs + update platform_feedback
    const wallClockSeconds = Math.round((Date.now() - start) / 1000);
    await db.update(platformOpsRuns).set({
      status: 'done',
      diagnosis: diagnosis.diagnosis,
      root_cause: diagnosis.root_cause,
      files_to_modify: diagnosis.files_to_modify,
      estimated_risk: diagnosis.estimated_risk,
      reproduces: diagnosis.reproduces,
      turns,
      wall_clock_seconds: wallClockSeconds,
      cost_cents: costCents,
      completed_at: new Date(),
    }).where(eq(platformOpsRuns.id, run.id));

    // Transition the bug row
    // - If reproduces=false → status='resolved', resolution='auto_couldnt_fix' (already fixed without our help)
    //   Actually: 'auto_fixed' if we already shipped a fix in this session.
    //   Use 'stale' resolution to mean "no longer reproduces, no fix needed from us".
    //   But the resolution field doesn't have 'stale' yet — using 'auto_fixed' for now.
    // - If reproduces=true → status='awaiting_approval' (Gate 1)
    const newStatus = diagnosis.reproduces ? 'awaiting_approval' : 'resolved';
    const newResolution = diagnosis.reproduces ? null : 'auto_fixed';
    await db.update(platformFeedback).set({
      status: newStatus,
      diagnosis: diagnosis.diagnosis,
      estimated_risk: diagnosis.estimated_risk,
      ops_run_id: run.id,
      resolution: newResolution,
      reproduced_at: diagnosis.reproduces ? new Date() : null,
    }).where(eq(platformFeedback.id, bug.id));

    result.status = 'done';
    result.diagnosis = diagnosis;
    result.turns = turns;
    result.wallClockSeconds = wallClockSeconds;
    result.costCents = costCents;
    log.info('Triage complete', {
      feedbackId, runId: run.id, turns, costCents,
      reproduces: diagnosis.reproduces, risk: diagnosis.estimated_risk,
    });

    // Critical-severity alert: if this is a real critical bug, email the
    // operator immediately. Non-blocking — alert failure doesn't affect triage.
    if (diagnosis.reproduces && bug.severity === 'critical') {
      try {
        await alertOnCritical(bug.id, bug.title, bug.severity, diagnosis.diagnosis);
      } catch (alertErr) {
        log.warn('Critical alert dispatch errored', { feedbackId, error: alertErr instanceof Error ? alertErr.message : String(alertErr) });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const partialWallSec = Math.round((Date.now() - start) / 1000);
    log.error('Triage failed', { feedbackId, runId: run.id, error: msg, wallSec: partialWallSec });
    await db.update(platformOpsRuns).set({
      status: 'failed',
      error_summary: msg.slice(0, 500),
      wall_clock_seconds: partialWallSec,
      completed_at: new Date(),
      // Note: turn_count and cost_cents already nullable; we don't capture
      // the partial-turn count from this catch because the loop variable is
      // out of scope. Audit shows wall_clock + error so it's still findable.
    }).where(eq(platformOpsRuns.id, run.id));
    result.reason = msg;
    result.wallClockSeconds = partialWallSec;
  }

  return result;
}

// ══════════════════════════════════════════════
// BATCH ENTRY: triage all open bugs (called by cron or manual)
// ══════════════════════════════════════════════

export async function triageOpenBugs(opts: { maxBugs?: number } = {}): Promise<TriageResult[]> {
  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    log.info('Platform-ops paused, skipping batch');
    return [];
  }

  const cap = Math.min(opts.maxBugs ?? MAX_BUGS_PER_RUN, MAX_BUGS_PER_RUN);

  // Pick bugs that have not been diagnosed yet (status='open' AND no diagnosis row)
  const bugs = await db
    .select({ id: platformFeedback.id, severity: platformFeedback.severity, title: platformFeedback.title })
    .from(platformFeedback)
    .where(eq(platformFeedback.status, 'open'))
    .orderBy(
      // critical → high → medium → low
      sql`CASE
        WHEN ${platformFeedback.severity} = 'critical' THEN 0
        WHEN ${platformFeedback.severity} = 'high' THEN 1
        WHEN ${platformFeedback.severity} = 'medium' THEN 2
        ELSE 3 END`,
      asc(platformFeedback.created_at),
    )
    .limit(cap);

  log.info('Triaging open bugs', { count: bugs.length, cap });
  const results: TriageResult[] = [];
  for (const b of bugs) {
    const r = await triageBug(b.id);
    results.push(r);
    // brief breath between calls
    await new Promise((r) => setTimeout(r, 1000));
  }
  return results;
}

// ══════════════════════════════════════════════
// CRITICAL-SEVERITY ALERTING
// Sends a Postmark email when triage finds a real (reproduces=true)
// critical-severity bug. Bypasses email.service.ts because there's no
// company_id for platform alerts.
// ══════════════════════════════════════════════

async function alertOnCritical(feedbackId: string, bugTitle: string, severity: string, diagnosis: string): Promise<void> {
  if (severity !== 'critical') return;

  const recipient = process.env.PLATFORM_OPS_ALERT_EMAIL ?? process.env.ADMIN_EMAILS?.split(',')[0]?.trim();
  if (!recipient) {
    log.warn('Critical bug found but no PLATFORM_OPS_ALERT_EMAIL or ADMIN_EMAILS configured — alert dropped', { feedbackId });
    return;
  }
  const apiToken = process.env.POSTMARK_SERVER_TOKEN;
  if (!apiToken) {
    log.warn('Critical bug found but POSTMARK_SERVER_TOKEN not set — alert dropped', { feedbackId });
    return;
  }

  const subject = `[Baljia Platform-Ops] Critical bug awaiting approval: ${bugTitle.slice(0, 80)}`;
  const dashboardLink = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai'}/admin/feedback/${feedbackId}`;
  const body = [
    `A CRITICAL platform bug has been triaged and is waiting for your review at Gate 1.`,
    ``,
    `Title:    ${bugTitle}`,
    `Severity: ${severity}`,
    `Bug ID:   ${feedbackId}`,
    ``,
    `DIAGNOSIS (excerpt):`,
    diagnosis.slice(0, 1500),
    ``,
    `Review and approve/reject:`,
    dashboardLink,
    ``,
    `— Baljia Platform-Ops Triage`,
  ].join('\n');

  try {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': apiToken,
      },
      body: JSON.stringify({
        From: 'system@baljia.ai',
        To: recipient,
        Subject: subject,
        TextBody: body,
        Tag: 'platform-ops-critical',
        TrackOpens: false,
        TrackLinks: 'None',
      }),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      log.error('Critical alert email send failed', { feedbackId, status: response.status, body: errBody.slice(0, 300) });
      return;
    }
    log.info('Critical alert email sent', { feedbackId, recipient });
  } catch (err) {
    log.error('Critical alert email threw', { feedbackId, error: err instanceof Error ? err.message : String(err) });
  }
}

// ══════════════════════════════════════════════
// Daily LLM budget check — separate from founder credits
// ══════════════════════════════════════════════

async function dailyBudgetExceeded(): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const [row] = await db
    .select({
      total_cents: sql<number>`COALESCE(SUM(${platformOpsRuns.cost_cents}), 0)::int`,
    })
    .from(platformOpsRuns)
    .where(and(
      sql`${platformOpsRuns.created_at} >= ${`${today}T00:00:00Z`}::timestamptz`,
      inArray(platformOpsRuns.status, ['done', 'failed']),
    ));
  const cents = row?.total_cents ?? 0;
  const dailyBudgetCents = DAILY_BUDGET_USD * 100;
  return cents >= dailyBudgetCents;
}
