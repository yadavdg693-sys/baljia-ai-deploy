// Platform-Ops Writer Agent (Phase B — code-fix → PR)
//
// Picks up bugs in status='approved_to_fix', generates a fix on a new
// branch, runs relevant tests, opens a PR, transitions to status='pr_open'.
// Verifier agent reviews the PR independently.
//
// Safety:
//   - File whitelist (write-only): src/lib/agents/agent-factory.ts,
//     src/lib/services/verification.service.ts, src/lib/services/governance.service.ts,
//     src/lib/agents/tools/*.tools.ts, .claude/skills/**, src/app/(dashboard)/**,
//     src/lib/db/client.ts, src/lib/services/task.service.ts
//   - Off-limits forever: auth, billing, payments, schema, env files,
//     wrangler.toml/render.yaml, anything in node_modules
//   - Branch + PR (NEVER push to main directly)
//   - Spawned from the same Anthropic OAuth as triage
//   - Per-bug 60-turn cap, 30min wall clock
//   - Same daily LLM budget as triage

import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import { db, platformFeedback, platformOpsRuns } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import {
  isAnthropicOAuthAvailable,
  createAnthropicWithOAuthAsync,
  withClaudeCodeIdentity,
} from '@/lib/anthropic-oauth';
import { callAnthropicWithTimeout } from '@/lib/llm-safety';

const log = createLogger('PlatformOpsWriter');

// ══════════════════════════════════════════════
// SAFETY BOUNDS — WRITE WHITELIST
// ══════════════════════════════════════════════

const REPO_ROOT = process.cwd();

// File-WRITE whitelist. Agent can ONLY edit these. Critical paths
// (auth, billing, schema, secrets) are intentionally absent.
const WRITE_WHITELIST_PREFIXES = [
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
const WRITE_DENYLIST_PATTERNS = [
  /\.env/i,
  /credentials/i,
  /node_modules/i,
  /\.next/i,
  /\.open-next/i,
  /\.wrangler/i,
  /db\/schema\.ts$/i,        // schema changes are humans-only
  /lib\/auth\.ts$/i,         // auth is too sensitive
  /lib\/services\/billing\.service\.ts$/i,
  /lib\/services\/credit\.service\.ts$/i,
  /api\/webhooks\/stripe/i,
  /wrangler\.toml$/i,
  /render\.yaml$/i,
  /package\.json$/i,         // dependency changes go through humans
  /package-lock\.json$/i,
];

// READ whitelist (matches triage agent's — same set)
const READ_WHITELIST_PREFIXES = ['src/', '.claude/skills/', 'drizzle/', 'docs/', 'public/'];
const READ_WHITELIST_FILES = ['package.json', 'wrangler.toml', 'render.yaml', 'tsconfig.json', 'CLAUDE.md', '.gitignore'];
const READ_DENYLIST_PATTERNS = [/\.env/i, /\.credentials/i, /credentials\.json/i, /node_modules/i, /\.next/i, /\.open-next/i, /\.wrangler/i];

const MAX_FILE_BYTES = 200 * 1024;

function isReadAllowed(repoPath: string): { allowed: boolean; reason?: string } {
  if (isAbsolute(repoPath) || repoPath.includes('..')) return { allowed: false, reason: 'absolute paths and ".." traversal not allowed' };
  for (const pat of READ_DENYLIST_PATTERNS) if (pat.test(repoPath)) return { allowed: false, reason: 'denylist (secrets-bearing)' };
  if (READ_WHITELIST_FILES.includes(repoPath)) return { allowed: true };
  if (READ_WHITELIST_PREFIXES.some((p) => repoPath.startsWith(p))) return { allowed: true };
  return { allowed: false, reason: 'not in read whitelist' };
}

function isWriteAllowed(repoPath: string): { allowed: boolean; reason?: string } {
  if (isAbsolute(repoPath) || repoPath.includes('..')) return { allowed: false, reason: 'absolute paths and ".." traversal not allowed' };
  for (const pat of WRITE_DENYLIST_PATTERNS) if (pat.test(repoPath)) return { allowed: false, reason: 'WRITE denylist — humans only' };
  if (WRITE_WHITELIST_PREFIXES.some((p) => repoPath.startsWith(p))) return { allowed: true };
  return { allowed: false, reason: 'not in WRITE whitelist (auth/billing/schema/configs are humans-only)' };
}

const MODEL = process.env.PLATFORM_OPS_MODEL ?? 'claude-sonnet-4-6';
const MAX_TURNS = 60;

// ══════════════════════════════════════════════
// TOOLS for the writer agent (read + write + run + git)
// ══════════════════════════════════════════════

const WRITER_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file (whitelisted to src/, .claude/skills/, drizzle/, docs/, public/, root configs). 200KB max.',
    input_schema: { type: 'object' as const, properties: { path: { type: 'string' as const } }, required: ['path'] },
  },
  {
    name: 'list_dir',
    description: 'List files in a directory.',
    input_schema: { type: 'object' as const, properties: { path: { type: 'string' as const } }, required: ['path'] },
  },
  {
    name: 'grep_repo',
    description: 'Search the repo for a regex pattern.',
    input_schema: { type: 'object' as const, properties: { pattern: { type: 'string' as const }, path: { type: 'string' as const } }, required: ['pattern'] },
  },
  {
    name: 'edit_file',
    description: 'Replace exact string in a whitelisted file. Old string must be unique. Whitelist: agent-factory.ts, verification.service.ts, governance.service.ts, tools/*.tools.ts, task.service.ts, .claude/skills/**, dashboard pages. NOT permitted: auth, billing, schema, .env, credentials, configs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string' as const },
        old_string: { type: 'string' as const, description: 'Exact string to find and replace. Must be unique in the file.' },
        new_string: { type: 'string' as const, description: 'Replacement.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'create_file',
    description: 'Create a new file (must be in write whitelist). Fails if file already exists.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string' as const }, content: { type: 'string' as const } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_typecheck',
    description: 'Run `npx tsc --noEmit` to confirm the modified files type-check. Use after every edit.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'run_test_script',
    description: 'Run a specific test script from src/scripts/ (must be a regression/repro/probe script, NOT one that mutates founder data). Returns stdout/stderr.',
    input_schema: { type: 'object' as const, properties: { script: { type: 'string' as const, description: 'script filename, e.g. "test-verifier-regression.ts"' } }, required: ['script'] },
  },
  {
    name: 'submit_fix',
    description: 'FINAL output. Submit your patch as a structured artifact. Triggers branch creation, commit, and PR open. After this your turn ends.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branch_name: { type: 'string' as const, description: 'Branch name. Format: platform-ops/<short-slug>. Will be prefixed with `platform-ops-fix/`.' },
        commit_message: { type: 'string' as const, description: 'Multi-line. First line is the subject (under 70 chars). Body explains diagnosis + fix.' },
        pr_title: { type: 'string' as const, description: 'GitHub PR title. Under 70 chars.' },
        pr_body: { type: 'string' as const, description: 'GitHub PR body, markdown. Should reference the bug ID and explain.' },
        test_evidence: { type: 'string' as const, description: 'What you ran to verify the fix works. Include actual stdout from run_test_script if applicable.' },
      },
      required: ['branch_name', 'commit_message', 'pr_title', 'pr_body', 'test_evidence'],
    },
  },
];

interface FixOutput {
  branch_name: string;
  commit_message: string;
  pr_title: string;
  pr_body: string;
  test_evidence: string;
}

// ══════════════════════════════════════════════
// TOOL HANDLERS
// ══════════════════════════════════════════════

const writtenFiles = new Set<string>();  // tracks files this run modified (for diff_hash)

function handleReadFile(input: { path: string }): string {
  const path = String(input.path ?? '').trim();
  const check = isReadAllowed(path);
  if (!check.allowed) return `[blocked] ${check.reason}`;
  const full = join(REPO_ROOT, path);
  if (!existsSync(full)) return `[not found] ${path}`;
  try {
    const stat = statSync(full);
    if (!stat.isFile()) return `[not a file] ${path}`;
    if (stat.size > MAX_FILE_BYTES) return `[too large] ${stat.size} bytes`;
    return readFileSync(full, 'utf8');
  } catch (e) { return `[error] ${e instanceof Error ? e.message : String(e)}`; }
}

function handleListDir(input: { path: string }): string {
  const path = String(input.path ?? '').trim();
  const check = isReadAllowed(path === '' ? 'src/' : path + '/');
  if (!check.allowed) return `[blocked] ${check.reason}`;
  const full = join(REPO_ROOT, path);
  if (!existsSync(full)) return `[not found] ${path}`;
  try {
    return readdirSync(full, { withFileTypes: true })
      .map((e) => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`).sort().join('\n');
  } catch (e) { return `[error] ${e instanceof Error ? e.message : String(e)}`; }
}

function handleGrepRepo(input: { pattern: string; path?: string }): string {
  const pattern = String(input.pattern ?? '').trim();
  const path = String(input.path ?? 'src/').trim();
  if (!pattern) return '[error] pattern required';
  const check = isReadAllowed(path);
  if (!check.allowed) return `[blocked] ${check.reason}`;
  try {
    const rgPath = join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'rg.cmd' : 'rg');
    let cmd: string;
    if (existsSync(rgPath)) {
      cmd = `"${rgPath}" --max-count 50 --line-number --no-heading --color never -e ${JSON.stringify(pattern)} ${JSON.stringify(path)}`;
    } else {
      cmd = process.platform === 'win32'
        ? `findstr /N /S /R /C:${JSON.stringify(pattern)} ${JSON.stringify(join(path, '*'))}`
        : `grep -rEn --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" -e ${JSON.stringify(pattern)} ${JSON.stringify(path)} | head -50`;
    }
    const out = execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024, timeout: 15_000 });
    return out.length > 0 ? out : '[no matches]';
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 1) return '[no matches]';
    return `[grep error — fall back to read_file]`;
  }
}

function handleEditFile(input: { path: string; old_string: string; new_string: string }): string {
  const path = String(input.path ?? '').trim();
  const writeCheck = isWriteAllowed(path);
  if (!writeCheck.allowed) return `[blocked] ${writeCheck.reason}`;

  const full = join(REPO_ROOT, path);
  if (!existsSync(full)) return `[not found] ${path} — use create_file to create new files`;

  const content = readFileSync(full, 'utf8');
  const occurrences = content.split(input.old_string).length - 1;
  if (occurrences === 0) return `[error] old_string not found in ${path}. Use read_file to see current contents.`;
  if (occurrences > 1) return `[error] old_string appears ${occurrences} times in ${path}. Make it unique by including more surrounding context.`;

  const newContent = content.replace(input.old_string, input.new_string);
  writeFileSync(full, newContent, 'utf8');
  writtenFiles.add(path);
  log.info('File edited', { path });
  return `[edited] ${path} — wrote ${newContent.length} bytes`;
}

function handleCreateFile(input: { path: string; content: string }): string {
  const path = String(input.path ?? '').trim();
  const writeCheck = isWriteAllowed(path);
  if (!writeCheck.allowed) return `[blocked] ${writeCheck.reason}`;

  const full = join(REPO_ROOT, path);
  if (existsSync(full)) return `[error] file already exists at ${path}. Use edit_file to modify.`;
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, input.content, 'utf8');
  writtenFiles.add(path);
  log.info('File created', { path });
  return `[created] ${path} — ${input.content.length} bytes`;
}

function handleRunTypecheck(): string {
  try {
    execSync('npx tsc --noEmit', { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 120_000 });
    return '[tsc clean] no errors';
  } catch (e) {
    const stdout = (e as { stdout?: Buffer | string })?.stdout;
    const stdoutStr: string = stdout instanceof Buffer ? stdout.toString('utf8') : (typeof stdout === 'string' ? stdout : '');
    const stderr = (e as { stderr?: Buffer | string })?.stderr;
    const stderrStr: string = stderr instanceof Buffer ? stderr.toString('utf8') : (typeof stderr === 'string' ? stderr : '');
    return `[tsc errors]\n${(stdoutStr + stderrStr).slice(0, 4000)}`;
  }
}

function handleRunTestScript(input: { script: string }): string {
  const script = String(input.script ?? '').trim();
  // Allowlist: only test/repro/probe scripts
  if (!/^(test-|reproduce-|probe-|inspect-)/i.test(script)) {
    return `[blocked] script must start with test-, reproduce-, probe-, or inspect- (read-only/idempotent scripts)`;
  }
  if (script.includes('..') || script.includes('/')) return `[blocked] script must be a filename, no paths`;
  const full = join(REPO_ROOT, 'src', 'scripts', script);
  if (!existsSync(full)) return `[not found] src/scripts/${script}`;
  try {
    const out = execSync(`npx tsx --env-file=.env.local "src/scripts/${script}"`, {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 180_000,
    });
    return `[script ok]\n${out.slice(-3000)}`;  // last 3KB of output
  } catch (e) {
    const stdout = (e as { stdout?: Buffer | string })?.stdout;
    const stdoutStr: string = stdout instanceof Buffer ? stdout.toString('utf8') : (typeof stdout === 'string' ? stdout : '');
    return `[script failed]\n${stdoutStr.slice(-3000)}`;
  }
}

// ══════════════════════════════════════════════
// GIT + GITHUB OPERATIONS
// ══════════════════════════════════════════════

function gitExec(cmd: string): string {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

/**
 * Pre-flight check: confirm the platform write token actually has write
 * access to the platform repo. Avoids burning LLM cost on runs that will
 * fail at push time.
 */
async function checkPlatformWriteAccess(): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.PLATFORM_OPS_GIT_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, reason: 'No PLATFORM_OPS_GIT_TOKEN or GITHUB_TOKEN set' };

  try {
    const remote = gitExec('git remote get-url origin').trim();
    const m = remote.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!m) return { ok: false, reason: `Cannot parse owner/repo from origin: ${remote}` };
    const [, owner, repo] = m;

    // GET /repos/{owner}/{repo} returns `permissions` object when authed
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      return { ok: false, reason: `GitHub API ${res.status} fetching ${owner}/${repo} — token may be invalid` };
    }
    const data = await res.json() as { permissions?: { push?: boolean; admin?: boolean }; full_name?: string };
    const canPush = data.permissions?.push === true || data.permissions?.admin === true;
    if (!canPush) {
      return {
        ok: false,
        reason: `Token has no push permission for ${data.full_name ?? `${owner}/${repo}`}. Set PLATFORM_OPS_GIT_TOKEN to a PAT with Contents:write + Pull-requests:write for that repo.`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Pre-flight check threw: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function openPullRequest(branch: string, title: string, body: string): Promise<{ url: string; number: number }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured for PR creation');
  // Determine repo from origin URL
  const remote = gitExec('git remote get-url origin').trim();
  // git@github.com:owner/repo.git or https://github.com/owner/repo.git
  const m = remote.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot parse owner/repo from origin: ${remote}`);
  const [, owner, repo] = m;

  // Determine base branch (the branch we're on before checkout)
  // For now, use 'cloudflare-spike' (the active dev branch) — could be configurable
  const base = process.env.PLATFORM_OPS_PR_BASE ?? 'cloudflare-spike';

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, head: branch, base }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`PR create failed: ${res.status} ${err.slice(0, 300)}`);
  }
  const data = await res.json() as { html_url: string; number: number };
  return { url: data.html_url, number: data.number };
}

// ══════════════════════════════════════════════
// MAIN: write a fix for one approved bug
// ══════════════════════════════════════════════

interface WriteResult {
  feedbackId: string;
  runId: string;
  status: 'done' | 'failed' | 'skipped';
  reason?: string;
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  turns: number;
  wallClockSeconds: number;
  costCents: number;
}

const SYSTEM_PROMPT = `You are the Baljia Platform Writer Agent. You receive an APPROVED platform bug with a triage diagnosis, and your job is to:

1. Re-read the diagnosis and the relevant code yourself (don't just trust the diagnosis verbatim — verify with read_file/grep_repo).
2. Make the smallest correct fix possible. Use edit_file (whitelisted) or create_file (whitelisted).
3. Run run_typecheck after edits. Fix any errors.
4. If a regression test exists for this domain (test-verifier-regression, reproduce-task-not-appearing, etc.), run it via run_test_script.
5. Submit your fix via submit_fix with a structured commit message and PR body.

You CANNOT edit: auth, billing, schema, secrets, env files, wrangler.toml, render.yaml, package.json. Those are humans-only.

You CANNOT directly merge — submit_fix opens a PR. The verifier agent will independently review it before a human approves.

Be surgical. Don't over-fix. If the diagnosis is wrong (e.g., the bug doesn't actually reproduce when you check), set test_evidence to explain that and submit a fix that's effectively a no-op + comment, OR fail by NOT calling submit_fix (the run will be marked failed and a human will review).`;

export async function fixApprovedBug(feedbackId: string): Promise<WriteResult> {
  const result: WriteResult = {
    feedbackId, runId: '', status: 'failed',
    turns: 0, wallClockSeconds: 0, costCents: 0,
  };
  const start = Date.now();
  writtenFiles.clear();

  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    result.status = 'skipped';
    result.reason = 'PLATFORM_OPS_PAUSED=true';
    return result;
  }

  // Pre-flight: confirm we have a token that can write to the platform repo.
  // We don't actually push here — just verify the token+permission via the
  // GitHub API so we don't burn $1+ in LLM cost on a run that's doomed at
  // the push step.
  // Dry-run mode (PLATFORM_OPS_DRY_RUN=true) skips the pre-flight + push +
  // PR-open and just commits locally on a branch. Useful for testing the
  // agent's reasoning without needing platform-repo write access.
  const dryRun = process.env.PLATFORM_OPS_DRY_RUN === 'true';
  if (!dryRun) {
    const writeOk = await checkPlatformWriteAccess();
    if (!writeOk.ok) {
      result.status = 'skipped';
      result.reason = writeOk.reason;
      log.warn('Writer pre-flight failed — skipping bug', { feedbackId, reason: writeOk.reason });
      return result;
    }
  } else {
    log.info('Writer running in DRY-RUN mode (no push, no PR)', { feedbackId });
  }

  const [bug] = await db.select().from(platformFeedback).where(eq(platformFeedback.id, feedbackId)).limit(1);
  if (!bug) { result.reason = 'bug not found'; return result; }
  if (bug.status !== 'approved_to_fix') { result.reason = `bug not approved (status=${bug.status})`; return result; }

  const [run] = await db.insert(platformOpsRuns).values({
    feedback_id: bug.id,
    agent_role: 'writer',
    phase: 'fix',
    status: 'running',
    llm_provider: 'anthropic',
    llm_model: MODEL,
  }).returning({ id: platformOpsRuns.id });
  result.runId = run.id;
  log.info('Writer started', { feedbackId, runId: run.id });

  try {
    if (!isAnthropicOAuthAvailable()) throw new Error('Anthropic OAuth not available');
    const { client, isOAuth } = await createAnthropicWithOAuthAsync();

    const userPrompt = [
      `APPROVED BUG (id: ${bug.id})`,
      `Severity: ${bug.severity}  |  Risk: ${bug.estimated_risk ?? 'unknown'}`,
      `Title: ${bug.title}`,
      `Description: ${bug.description ?? '(none)'}`,
      ``,
      `TRIAGE DIAGNOSIS (verify before trusting):`,
      bug.diagnosis ?? '(no diagnosis text — re-read the bug and code yourself)',
      ``,
      `Fix it. End with submit_fix.`,
    ].join('\n');

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let fixOutput: FixOutput | null = null;
    let turns = 0;

    while (turns < MAX_TURNS) {
      turns++;
      const resp = await callAnthropicWithTimeout(client, {
        model: MODEL,
        max_tokens: 4096,
        system: withClaudeCodeIdentity(SYSTEM_PROMPT, isOAuth),
        tools: WRITER_TOOLS,
        messages,
      }, { timeoutMs: 120_000, label: `writer_turn_${turns}` }) as Anthropic.Message;

      totalInputTokens += resp.usage?.input_tokens ?? 0;
      totalOutputTokens += resp.usage?.output_tokens ?? 0;

      const toolUses = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      if (toolUses.length === 0) throw new Error('Agent ended turn without calling submit_fix');

      messages.push({ role: 'assistant', content: resp.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      let submitted = false;

      for (const use of toolUses) {
        let resultText: string;
        switch (use.name) {
          case 'read_file': resultText = handleReadFile(use.input as { path: string }); break;
          case 'list_dir': resultText = handleListDir(use.input as { path: string }); break;
          case 'grep_repo': resultText = handleGrepRepo(use.input as { pattern: string; path?: string }); break;
          case 'edit_file': resultText = handleEditFile(use.input as { path: string; old_string: string; new_string: string }); break;
          case 'create_file': resultText = handleCreateFile(use.input as { path: string; content: string }); break;
          case 'run_typecheck': resultText = handleRunTypecheck(); break;
          case 'run_test_script': resultText = handleRunTestScript(use.input as { script: string }); break;
          case 'submit_fix':
            fixOutput = use.input as FixOutput;
            submitted = true;
            resultText = 'Fix submitted. Branching, committing, and opening PR.';
            break;
          default:
            resultText = `[error] unknown tool: ${use.name}`;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: resultText });
      }

      messages.push({ role: 'user', content: toolResults });
      if (submitted && fixOutput) break;

      // Nudge near cap
      if (turns >= MAX_TURNS - 5 && !submitted) {
        messages.push({
          role: 'user',
          content: `[NUDGE] ${MAX_TURNS - turns} turns left. Submit your fix NOW via submit_fix.`,
        });
      }
    }

    if (!fixOutput) throw new Error(`No submit_fix after ${turns} turns`);
    if (writtenFiles.size === 0) throw new Error('submit_fix called but no files were written');

    // ── Branch + commit + push + PR ──
    const branchName = fixOutput.branch_name.startsWith('platform-ops-fix/')
      ? fixOutput.branch_name
      : `platform-ops-fix/${fixOutput.branch_name.replace(/^platform-ops\//, '')}`;

    log.info('Creating branch + commit', { branchName, files: [...writtenFiles] });
    const baseBranch = gitExec('git rev-parse --abbrev-ref HEAD').trim();
    gitExec(`git checkout -b ${JSON.stringify(branchName)}`);
    for (const f of writtenFiles) {
      gitExec(`git add ${JSON.stringify(f)}`);
    }
    // Compute diff hash before commit
    const diff = gitExec('git diff --cached');
    const diffHash = createHash('sha256').update(diff).digest('hex');

    // Commit (use temp file in OS tmpdir to handle multi-line message
    // safely. Earlier we used .git/PLATFORM_OPS_COMMIT_MSG but that path
    // doesn't exist when .git is a worktree pointer-file, not a dir.)
    const commitFile = join(tmpdir(), `platform-ops-commit-${randomUUID()}.txt`);
    writeFileSync(commitFile, fixOutput.commit_message, 'utf8');
    try {
      gitExec(`git commit -F ${JSON.stringify(commitFile)}`);
    } finally {
      // Best-effort cleanup. unlinkSync would throw on Windows if file is
      // locked; fs.rm async would too. Keeping silent — file is in tmpdir
      // and gets cleaned by OS eventually.
      try { execSync(process.platform === 'win32' ? `del /Q ${JSON.stringify(commitFile)}` : `rm -f ${JSON.stringify(commitFile)}`, { cwd: REPO_ROOT, stdio: 'ignore' }); } catch { /* swallow */ }
    }
    const commitSha = gitExec('git rev-parse HEAD').trim();

    let prUrl = '';
    let prNumber = 0;
    if (dryRun) {
      // Dry-run: skip push + PR. Branch + commit are local. Operator can
      // inspect with `git log platform-ops-fix/<slug>` and decide manually.
      log.info('DRY-RUN: skipping push + PR open. Branch is local only.', { branchName, commitSha });
      prUrl = `(dry-run, no PR)`;
      prNumber = 0;
    } else {
      // Push the branch. Use PLATFORM_OPS_GIT_TOKEN if set (separately scoped
      // for platform-repo writes), else fall back to GITHUB_TOKEN.
      const ghToken = process.env.PLATFORM_OPS_GIT_TOKEN ?? process.env.GITHUB_TOKEN;
      if (!ghToken) throw new Error('No platform-write token: set PLATFORM_OPS_GIT_TOKEN');
      const remote2 = gitExec('git remote get-url origin').trim();
      const m2 = remote2.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (!m2) throw new Error(`Cannot parse origin: ${remote2}`);
      const [, owner2, repo2] = m2;
      const authedUrl = `https://x-access-token:${ghToken}@github.com/${owner2}/${repo2}.git`;
      log.info('Pushing branch to origin', { branchName });
      try {
        gitExec(`git push -u ${JSON.stringify(authedUrl)} ${JSON.stringify(branchName)}:${JSON.stringify(branchName)}`);
      } catch (pushErr) {
        const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        if (/403|Write access to repository not granted/.test(msg)) {
          throw new Error(
            `Push 403: token has no write access to ${owner2}/${repo2}. ` +
            `Set PLATFORM_OPS_GIT_TOKEN to a PAT with Contents:write + Pull-requests:write. ` +
            `(Branch + commit succeeded locally on ${branchName})`
          );
        }
        throw pushErr;
      }

      // Open PR (skipped in dry-run)
      const prBodyWithFooter = [
        fixOutput.pr_body,
        ``,
        `---`,
        `**Bug ID:** ${bug.id}`,
        `**Triage diagnosis:**`,
        `\`\`\``,
        (bug.diagnosis ?? '').slice(0, 2000),
        `\`\`\``,
        ``,
        `**Test evidence:**`,
        `\`\`\``,
        fixOutput.test_evidence.slice(0, 2000),
        `\`\`\``,
        ``,
        `*Generated by Baljia Platform-Ops Writer Agent. Verifier agent review and human Gate 2 required before merge.*`,
      ].join('\n');

      const pr = await openPullRequest(branchName, fixOutput.pr_title, prBodyWithFooter);
      log.info('PR opened', { prUrl: pr.url, prNumber: pr.number });
      prUrl = pr.url;
      prNumber = pr.number;
    }

    // Switch back to base branch so next runs aren't on this branch
    gitExec(`git checkout ${JSON.stringify(baseBranch)}`);

    // Persist run + transition bug
    const wallClockSeconds = Math.round((Date.now() - start) / 1000);
    const costCents = Math.round(totalInputTokens * 0.0003 + totalOutputTokens * 0.0015);
    await db.update(platformOpsRuns).set({
      status: 'done',
      branch_name: branchName,
      commit_sha: commitSha,
      diff_hash: diffHash,
      pr_url: prUrl || null,
      pr_number: prNumber || null,
      files_to_modify: [...writtenFiles],
      test_evidence: { stdout: fixOutput.test_evidence } as Record<string, unknown>,
      turns,
      wall_clock_seconds: wallClockSeconds,
      cost_cents: costCents,
      completed_at: new Date(),
    }).where(eq(platformOpsRuns.id, run.id));

    // Bug status: pr_open if we actually opened a PR, dry_run_branch if local-only
    await db.update(platformFeedback).set({
      status: dryRun ? 'awaiting_approval' : 'pr_open',
      ops_run_id: run.id,
    }).where(eq(platformFeedback.id, bug.id));

    result.status = 'done';
    result.prUrl = prUrl;
    result.prNumber = prNumber;
    result.branchName = branchName;
    result.turns = turns;
    result.wallClockSeconds = wallClockSeconds;
    result.costCents = costCents;
    log.info('Writer complete', { feedbackId, prUrl, branchName, turns, costCents, dryRun });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Writer failed', { feedbackId, runId: run.id, error: msg });
    // Best-effort: try to revert the local branch checkout if we created one
    try {
      const branchHead = gitExec('git rev-parse --abbrev-ref HEAD').trim();
      if (branchHead.startsWith('platform-ops-fix/')) {
        // We're stuck on the fix branch — checkout base before bailing
        gitExec(`git checkout ${JSON.stringify(process.env.PLATFORM_OPS_PR_BASE ?? 'cloudflare-spike')}`);
        gitExec(`git branch -D ${JSON.stringify(branchHead)}`);
      }
    } catch { /* swallow */ }
    await db.update(platformOpsRuns).set({
      status: 'failed',
      error_summary: msg.slice(0, 500),
      wall_clock_seconds: Math.round((Date.now() - start) / 1000),
      completed_at: new Date(),
    }).where(eq(platformOpsRuns.id, run.id));
    result.reason = msg;
  }

  return result;
}

// ══════════════════════════════════════════════
// BATCH ENTRY: process all approved-to-fix bugs
// ══════════════════════════════════════════════

export async function processApprovedBugs(opts: { maxBugs?: number } = {}): Promise<WriteResult[]> {
  if (process.env.PLATFORM_OPS_PAUSED === 'true') {
    log.info('Platform-ops paused, skipping writer batch');
    return [];
  }
  const cap = opts.maxBugs ?? 3;  // smaller cap for writer (each one is 5+ min, opens a PR)

  const bugs = await db.select({ id: platformFeedback.id })
    .from(platformFeedback)
    .where(eq(platformFeedback.status, 'approved_to_fix'))
    .orderBy(sql`${platformFeedback.approved_at} ASC NULLS LAST`)
    .limit(cap);

  log.info('Writer batch', { count: bugs.length, cap });
  const results: WriteResult[] = [];
  for (const b of bugs) {
    const r = await fixApprovedBug(b.id);
    results.push(r);
    await new Promise((r) => setTimeout(r, 2000));  // breath between PRs
  }
  return results;
}
