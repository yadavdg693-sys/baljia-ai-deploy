// Verification Service — 5-level task verification (SPEC-CTRL-106)
// The verifier is the SOLE AUTHORITY for setting final task status.
// Worker is NOT the final authority — verifier sets completed or failed.
// Levels: none, deterministic, browser_flow, quality_review, hybrid

import type { Task, VerificationLevel } from '@/types';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { db, reports, companies, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { githubFetch } from '@/lib/services/github-throttle';
import { classifyTaskIntent } from '@/lib/agents/task-intent';
import { getTaskLanePolicy } from '@/lib/agents/task-lane';
import {
  criticalFlowEvidenceChecks,
  detectCriticalFlowContracts,
  requiredCriticalFlowContracts,
} from '@/lib/agents/critical-flow-contracts';
import { requiresProductBuildContract } from '@/lib/agents/product-build-contract';
import { engineeringLaneCompletionIssues } from '@/lib/agents/runtime/engineering-subagents';
import { hasCompleteExecutionContract } from '@/lib/agents/execution-contract';

// Tools that constitute shipping code to the founder app runtime.
// Engineering apps now deploy to Render. GitHub writes are necessary, but are
// not enough: code in a repo is not a live app.
const DEPLOY_TOOL_NAMES = new Set([
  'render_create_service',
  'render_deploy',
  'render_set_env_vars',
  'deploy_to_render',
  // create_instance internally calls render_create_service after forking the
  // skeleton and provisioning Neon — count it as deploy evidence so the
  // verifier doesn't fail engineering tasks that used the atomic tool path
  // (audit P1.3 round 3, 2026-05-12).
  'create_instance',
]);

// Schema-only tools — sufficient evidence for DB-shaped tasks but NOT for
// feature/engineering tasks (which need both schema AND code).
const ADVISORY_CHECK_NAMES = new Set<string>([
  'has_report',
  'has_recommendations',
  'db_state_evidence',     // not all deploys need DB checks (static sites, marketing pages)
  'tests_folder_present',  // Backend Quality Bar — surface in reports, soft until adoption
  'readme_present',        // Backend Quality Bar — surface in reports, soft until adoption
  // 'static_code_scan' — promoted to HARD for engineering tasks. Catches the
  //   skeleton-removed-hardening shapes (missing helmet, missing rate-limit,
  //   /api/health without DB probe, etc.) that the runtime journey can't see.
  //   Skipping the scan or shipping with high-severity findings now fails the task.
  'llm_code_review',       // Quality Bar — LLM diff review, surface in reports
]);

const FAILED_TOOL_RESULT_RE = /\b(missing required input|invalid script|failed|error|not configured|not registered|not injected|no .* deployed|check logs)\b/i;
const PLANNING_TOOL_FAILURE_RE = /^(error:|unknown engineering tool|failed to|missing required input|invalid input)/i;
const DEPLOY_SUCCESS_RE = /\b(render service created|render deploy|deployment triggered|service deployed|deployed to render)\b/i;
const HEALTH_TOOL_NAMES = new Set(['check_url_health']);
const HEALTH_SUCCESS_RE = /\b(is healthy|returned HTTP 2\d\d|HTTP 2\d\d|200|responded in)\b/i;

// Higher-fidelity verifiers added 2026-05-08 to close the
// "deterministic-passes-but-app-is-broken" gap. check_url_health alone says
// "URL responds 2xx"; these prove the app actually works for users (auth flow,
// CRUD writes, third-party links).
const JOURNEY_TOOL_NAMES = new Set(['verify_user_journey']);
const JOURNEY_SUCCESS_RE = /^JOURNEY PASS\b/m;
const DB_STATE_TOOL_NAMES = new Set(['verify_db_state']);
const DB_STATE_SUCCESS_RE = /^DB STATE PASS\b/m;
const BROWSER_UI_TOOL_NAMES = new Set(['verify_browser_ui']);
const BROWSER_UI_SUCCESS_RE = /^BROWSER UI PASS\b/m;
const INTERACTION_TOOL_NAMES = new Set(['verify_interaction_contract']);
const INTERACTION_SUCCESS_RE = /^INTERACTION PROOF PASS\b|INTERACTION_PROOF_EVIDENCE[^\n]*failed=0\b/m;
const STATIC_SCAN_TOOL_NAMES = new Set(['static_code_scan']);
const STATIC_SCAN_SUCCESS_RE = /^STATIC SCAN PASS\b|high=0\b/m;
const CODE_REVIEW_TOOL_NAMES = new Set(['review_pushed_code']);
const CODE_REVIEW_SUCCESS_RE = /^CODE REVIEW PASS\b|high=0\b|^CODE REVIEW SKIPPED\b/m;

const SCHEMA_DEPLOY_TOOLS = new Set(['run_migration']);
const REQUESTED_ROUTE_LIMIT = 5;

type ExecutionToolCall = {
  tool: string;
  result: string;
  event?: string;
  reason?: string;
};

function lastToolCallIndex(
  toolCalls: ExecutionToolCall[],
  predicate: (call: ExecutionToolCall) => boolean,
): number {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    if (predicate(toolCalls[i])) return i;
  }
  return -1;
}

async function persistLatestExecutionVerification(taskId: string, result: VerificationResult): Promise<void> {
  const [latestExecution] = await db
    .select({ id: taskExecutions.id })
    .from(taskExecutions)
    .where(eq(taskExecutions.task_id, taskId))
    .orderBy(desc(taskExecutions.created_at))
    .limit(1);

  if (!latestExecution?.id) return;

  await db
    .update(taskExecutions)
    .set({
      status: result.passed ? 'completed' : 'failed',
      completed_at: new Date(),
      verification_evidence: result,
      error_summary: result.passed ? null : result.summary,
    })
    .where(eq(taskExecutions.id, latestExecution.id));
}

function isSuccessfulPlanningToolCall(result: string): boolean {
  return !PLANNING_TOOL_FAILURE_RE.test(result.trim());
}

// Tags where a deploy is REQUIRED for "completed" — i.e. without at least
// one DEPLOY_TOOL call, the task is not actually done.
const DEPLOY_REQUIRED_TAGS = new Set([
  'engineering',
  'deploy',
  'feature',
  'complex-feature',
  'mvp',
  'full-crud',
  'auth',
  'landing-page',
  'dashboard',
  'pricing-page',
  'bug',
  'bug-fix',
  'fix',
  'api',
  'crud',
  'webhook',
  'cron',
  'form',
  'css',
  'settings',
]);

/** Read execution_log from the latest execution for this task and return
 *  every tool call the agent made. Empty array on error.
 *
 *  Preserves the `reason` field on event entries so consumers like
 *  hasGateExhaustion() can surface the actual gate block reason in their
 *  detail message (audit P3, 2026-05-12). Without this, a hard fail
 *  triggered on completion_gate_exhausted reports "Last block: (no detail)"
 *  and debugging takes an extra round-trip to the DB. */
async function getExecutionToolCalls(taskId: string): Promise<ExecutionToolCall[]> {
  try {
    const [exec] = await db
      .select({ execution_log: taskExecutions.execution_log })
      .from(taskExecutions)
      .where(eq(taskExecutions.task_id, taskId))
      .orderBy(desc(taskExecutions.created_at))
      .limit(1);

    if (!exec?.execution_log) return [];

    let log: Array<{ tool?: string; result?: unknown; event?: unknown; reason?: unknown }> = [];
    if (typeof exec.execution_log === 'string') {
      try { log = JSON.parse(exec.execution_log); } catch { return []; }
    } else if (Array.isArray(exec.execution_log)) {
      log = exec.execution_log as Array<{ tool?: string; result?: unknown; event?: unknown; reason?: unknown }>;
    }

    return log
      .map((e) => ({
        tool: e.tool ?? '',
        result: typeof e.result === 'string' ? e.result : '',
        event: typeof e.event === 'string' ? e.event : undefined,
        reason: typeof e.reason === 'string' ? e.reason : undefined,
      }))
      .filter((e) => e.tool || e.event);
  } catch {
    return [];
  }
}

function isSuccessfulDeployCall(call: { tool: string; result: string }): boolean {
  if (!DEPLOY_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  if (FAILED_TOOL_RESULT_RE.test(call.result)) return false;
  return DEPLOY_SUCCESS_RE.test(call.result) || !/\b(missing|required|invalid|failed|error)\b/i.test(call.result);
}

function isSuccessfulHealthCall(call: { tool: string; result: string }): boolean {
  if (!HEALTH_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  if (FAILED_TOOL_RESULT_RE.test(call.result)) return false;
  return HEALTH_SUCCESS_RE.test(call.result) || !/\b(down|failed|error|timeout|HTTP [45]\d\d)\b/i.test(call.result);
}

function isSuccessfulJourneyCall(call: { tool: string; result: string }): boolean {
  if (!JOURNEY_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  return JOURNEY_SUCCESS_RE.test(call.result);
}

function isSuccessfulDbStateCall(call: { tool: string; result: string }): boolean {
  if (!DB_STATE_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  return DB_STATE_SUCCESS_RE.test(call.result);
}

function isFocusedRepairForVerifier(
  task: Pick<Task, 'title' | 'description' | 'tag' | 'source'>,
  toolCalls: ExecutionToolCall[],
): boolean {
  const logText = toolCalls.map((t) => t.result).join('\n');
  if (/TASK_INTENT_EVIDENCE[^\n]*lane=repair\b/i.test(logText)) return true;

  const intent = classifyTaskIntent({
    title: task.title,
    description: task.description,
    tag: task.tag,
  });
  if (intent.lane !== 'repair') return false;

  const taskText = `${task.title ?? ''}\n${task.description ?? ''}\n${task.source ?? ''}`;
  return /\b(ceo repair|repair task|existing|same repo|same service|current app|already deployed|preserve|replay|original canary failed)\b/i.test(taskText);
}

function isDesignCritiqueRequiredForVerifier(
  task: Pick<Task, 'title' | 'description' | 'tag' | 'source'>,
  evidence: { planningDepth: string; taskIntentLane: string; taskIntent: string },
  hadCritiqueBlocker = false,
): boolean {
  if (hadCritiqueBlocker) return true;
  const lanePolicy = getTaskLanePolicy(task, {
    planningDepth: evidence.planningDepth as never,
    taskIntent: evidence.taskIntent as never,
  });
  if (!lanePolicy.completion.requireDesignCritique) {
    const text = `${task.title ?? ''}\n${task.description ?? ''}\n${task.tag ?? ''}\n${task.source ?? ''}`;
    return /\b(design_critique|vision critique|critique the design|visual critique)\b/i.test(text);
  }
  if (evidence.planningDepth === 'canary_world_class' || evidence.planningDepth === 'mixed_complex_app') return true;
  if (evidence.taskIntentLane === 'build' && evidence.taskIntent === 'new_app_build') return true;

  const text = `${task.title ?? ''}\n${task.description ?? ''}\n${task.tag ?? ''}\n${task.source ?? ''}`;
  return /\b(landing|marketing|homepage|hero|brand|visual redesign|redesign|design system|theme|typography|font|layout|responsive|mobile|polish)\b/i.test(text);
}

function extractOnrenderBaseUrls(toolCalls: ExecutionToolCall[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const urlRe = /https?:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.onrender\.com(?:\/[^\s"'<>`]*)?/gi;

  for (const call of [...toolCalls].reverse()) {
    for (const match of call.result.matchAll(urlRe)) {
      try {
        const origin = new URL(match[0]).origin;
        if (!seen.has(origin)) {
          seen.add(origin);
          urls.push(origin);
        }
      } catch {
        // Ignore malformed URLs in tool output.
      }
    }
  }

  return urls;
}

function normalizeBaseUrlCandidate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const raw = value.trim().replace(/\/+$/, '');
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.origin;
  } catch {
    return null;
  }
}

async function getRenderServiceUrl(renderServiceId: string | null | undefined): Promise<string | null> {
  if (!renderServiceId) return null;
  const token = process.env.RENDER_API_KEY;
  if (!token) return null;

  try {
    const r = await fetch(`${RENDER_API}/services/${renderServiceId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const data = await r.json() as { service?: { serviceDetails?: { url?: string } }; serviceDetails?: { url?: string } };
    return normalizeBaseUrlCandidate(data.service?.serviceDetails?.url ?? data.serviceDetails?.url ?? null);
  } catch {
    return null;
  }
}

function isSuccessfulBrowserUiCall(call: { tool: string; result: string }): boolean {
  if (!BROWSER_UI_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  return BROWSER_UI_SUCCESS_RE.test(call.result);
}

function interactionContractCountFromText(text: string): number {
  let max = 0;
  const regex = /INTERACTION_CONTRACT_EVIDENCE[^\n]*count=(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    max = Math.max(max, Number(match[1]) || 0);
  }
  return max;
}

function interactionProofCountsFromText(text: string): { passed: number; failed: number } | null {
  const match = text.match(/INTERACTION_PROOF_EVIDENCE[^\n]*passed=(\d+)[^\n]*failed=(\d+)/);
  if (!match) return null;
  return {
    passed: Number(match[1]) || 0,
    failed: Number(match[2]) || 0,
  };
}

function isSuccessfulInteractionCall(call: { tool: string; result: string }, minPassed = 1): boolean {
  if (!INTERACTION_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  const counts = interactionProofCountsFromText(call.result);
  if (counts) {
    return counts.failed === 0 && counts.passed >= minPassed;
  }
  return minPassed <= 1 && INTERACTION_SUCCESS_RE.test(call.result);
}

function isCleanStaticScanCall(call: { tool: string; result: string }): boolean {
  if (!STATIC_SCAN_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  // "PASS" OR "STATIC SCAN: ... high=0" both count as clean.
  return STATIC_SCAN_SUCCESS_RE.test(call.result);
}

function isCleanCodeReviewCall(call: { tool: string; result: string }): boolean {
  if (!CODE_REVIEW_TOOL_NAMES.has(call.tool)) return false;
  if (!call.result) return false;
  // PASS / high=0 / SKIPPED (no provider available) all count as clean —
  // SKIPPED isn't a failure of the agent, it's a missing-config issue.
  return CODE_REVIEW_SUCCESS_RE.test(call.result);
}

// Backend Quality Bar enforcement (advisory). Fetches the company's GitHub
// repo via the Contents API and checks for cross-cutting hygiene that's
// independent of the specific feature: tests folder exists, README exists.
// Heavier checks (trust-proxy, env validation) are caught by verify_user_journey
// at runtime, so we keep the static check minimal.
interface RepoHygiene {
  reachable: boolean;
  hasTestsFolder: boolean;
  hasReadme: boolean;
  testFileCount: number;
  readmeBytes: number;
  detail: string;
}

const GITHUB_API = 'https://api.github.com';
const RENDER_API = 'https://api.render.com/v1';

/**
 * Resolve the URL where the company's deployed app is reachable.
 * Prefers custom_domain (e.g. threadpulse.baljia.app) over the Render-assigned
 * hostname. Returns null when neither is available — the verifier should skip
 * the journey-fallback in that case.
 */
export async function getCompanyAppUrl(companyId: string): Promise<string | null> {
  const [c] = await db.select({
    custom_domain:     companies.custom_domain,
    render_service_id: companies.render_service_id,
  }).from(companies).where(eq(companies.id, companyId)).limit(1);

  if (!c) return null;
  if (c.custom_domain) {
    return `https://${c.custom_domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }
  return getRenderServiceUrl(c.render_service_id);
}

/**
 * Verifier-side fallback when the engineering agent finished a deploy
 * without calling verify_user_journey. Probes the deployed URL with a
 * minimal "is this app actually responding?" walk: GET / and GET /api/health.
 *
 * Returns null when the URL can't be resolved (no fallback possible).
 * Otherwise returns a JourneyResult — the caller pushes it as journey
 * evidence into the verification check list.
 *
 * Intentionally narrow: we don't run the full register→login flow
 * because we'd be writing rows to the founder DB. The agent's own
 * verify_user_journey is the right place for that. The fallback is
 * a backstop, not a replacement.
 */
export async function runFallbackJourney(companyId: string): Promise<import('./journey-runner.service').JourneyResult | null> {
  const baseUrl = await getCompanyAppUrl(companyId);
  if (!baseUrl) return null;

  const { runJourney } = await import('./journey-runner.service');
  return runJourney({
    journey_name: 'verifier-fallback (read-only liveness)',
    base_url: baseUrl,
    steps: [
      { step: 'landing responds 2xx', path: '/',           expect_status: [200, 301, 302] },
      { step: 'health endpoint up',   path: '/api/health', expect_status: [200, 404] }, // 404 is acceptable — not all apps expose /api/health
    ],
  });
}

async function getRepoHygiene(repo: string | null): Promise<RepoHygiene> {
  if (!repo) return { reachable: false, hasTestsFolder: false, hasReadme: false, testFileCount: 0, readmeBytes: 0, detail: 'no github_repo on company' };
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { reachable: false, hasTestsFolder: false, hasReadme: false, testFileCount: 0, readmeBytes: 0, detail: 'GITHUB_TOKEN not configured' };

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

  // Single recursive Trees API call returns the entire repo's file index in one
  // request — half the rate-limit cost of the previous root + tests-dir pair.
  // Default branch resolution: try main first, fall back to master.
  type TreeEntry = { path: string; type: 'blob' | 'tree'; size?: number };
  let entries: TreeEntry[] = [];
  for (const branch of ['main', 'master']) {
    try {
      const res = await githubFetch(`${GITHUB_API}/repos/${repo}/git/trees/${branch}?recursive=1`, { headers, signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const data = await res.json() as { tree?: TreeEntry[]; truncated?: boolean };
        entries = data.tree ?? [];
        break;
      }
      if (res.status !== 404) {
        return { reachable: false, hasTestsFolder: false, hasReadme: false, testFileCount: 0, readmeBytes: 0, detail: `repo tree HTTP ${res.status} on ${branch}` };
      }
      // 404 on main: try master next
    } catch (err) {
      return { reachable: false, hasTestsFolder: false, hasReadme: false, testFileCount: 0, readmeBytes: 0, detail: `repo tree threw on ${branch}: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (entries.length === 0) {
    return { reachable: false, hasTestsFolder: false, hasReadme: false, testFileCount: 0, readmeBytes: 0, detail: 'repo tree empty or default branch not found (main/master)' };
  }

  // README — root-level only (no nested README.md in a subdir counts here)
  const readmeEntry = entries.find((e) => e.type === 'blob' && !e.path.includes('/') && /^readme(\.\w+)?$/i.test(e.path));
  const readmeBytes = readmeEntry?.size ?? 0;

  // Tests — accept any of tests/, test/, __tests__/, specs/, or scoped under any of those.
  // testFileCount counts test-shaped files anywhere in the tree.
  const testFileCount = entries.filter((e) => {
    if (e.type !== 'blob') return false;
    const segments = e.path.split('/');
    const inTestsDir = segments.some((s, i) => i < segments.length - 1 && /^(tests?|__tests__|specs?)$/i.test(s));
    if (!inTestsDir) return false;
    return /\.(test|spec)\.(t|j)sx?$|\.py$/i.test(e.path);
  }).length;

  return {
    reachable: true,
    hasTestsFolder: testFileCount > 0,
    hasReadme: !!readmeEntry && readmeBytes >= 200,
    testFileCount,
    readmeBytes,
    detail: `repo=${repo}, tests=${testFileCount} file(s), readme=${readmeBytes}b`,
  };
}

function hasAgentLoop(logEntries: Array<{ event?: string }>): boolean {
  return logEntries.some((entry) =>
    ['loop_kill', 'watchdog_kill', 'watchdog_health_kill'].includes(entry.event ?? '')
  );
}

// Gate exhaustion = the agent hit MAX_FORCED_CONTINUATIONS while the
// completion gate was still blocking. Means health / journey / design
// checks were unresolved when the loop gave up. Treat as a hard verifier
// failure — agent can't escape unresolved BLOCKERs by exhausting the gate
// (audit P1.1 round 3, 2026-05-12).
function hasGateExhaustion(logEntries: Array<{ event?: string; reason?: string }>): { exhausted: boolean; reason?: string } {
  for (const entry of logEntries) {
    if (entry.event === 'completion_gate_exhausted') {
      return { exhausted: true, reason: entry.reason };
    }
  }
  return { exhausted: false };
}

function requiresDbStateEvidence(task?: Pick<Task, 'title' | 'description' | 'tag'>): boolean {
  if (!task) return false;
  const text = `${task.title ?? ''}\n${task.description ?? ''}`;
  if (/verify_db_state|DB STATE PASS|real Render canary|CANARY\b/i.test(text)) return true;
  if (task.tag !== 'engineering') return false;
  return /\b(full[- ]?stack|database|postgres|db|auth|crud|upload|document|payment|billing|checkout|subscription|booking|marketplace|admin|approval|dashboard|analytics|ai|rag|search|history|notification|email|webhook|integration)\b/i.test(text);
}

function isAdvisoryCheckName(name: string, task?: Pick<Task, 'title' | 'description' | 'tag'>): boolean {
  if (name === 'db_state_evidence' && requiresDbStateEvidence(task)) return false;
  return ADVISORY_CHECK_NAMES.has(name);
}

function hardFailures(checks: VerificationCheck[], task?: Pick<Task, 'title' | 'description' | 'tag'>): VerificationCheck[] {
  return checks.filter((c) => !c.passed && !isAdvisoryCheckName(c.name, task));
}

function normalizeRequestedPath(path: string): string | null {
  const cleaned = path.trim().replace(/[),.;!?]+$/g, '');
  if (!cleaned.startsWith('/') || cleaned.startsWith('//') || cleaned === '/') return null;
  if (cleaned.length > 180) return null;
  return cleaned;
}

const NEGATED_ROUTE_DIRECTIVE_RE =
  /\b(?:do\s+not|don't|dont|never|skip|avoid|ignore|out\s+of\s+scope|out-of-scope|not\s+required|not\s+in\s+scope|must\s+not|should\s+not)\b/i;

function lineContainingIndex(text: string, index: number): { line: string; start: number } {
  const start = Math.max(text.lastIndexOf('\n', index) + 1, 0);
  const end = text.indexOf('\n', index);
  return { line: text.slice(start, end === -1 ? text.length : end), start };
}

function isNegatedRouteMention(text: string, index: number): boolean {
  const { line, start } = lineContainingIndex(text, index);
  return NEGATED_ROUTE_DIRECTIVE_RE.test(line.slice(0, Math.max(index - start, 0)));
}

export function extractRequestedBrowserPaths(
  task: Pick<Task, 'title' | 'description'>,
  domain?: string,
): string[] {
  const text = `${task.title}\n${task.description ?? ''}`;
  const paths = new Set<string>();

  for (const match of text.matchAll(/https?:\/\/[^\s"'<>`]+/gi)) {
    if (typeof match.index === 'number' && isNegatedRouteMention(text, match.index)) continue;
    try {
      const url = new URL(match[0]);
      if (domain && url.hostname !== domain) continue;
      const normalized = normalizeRequestedPath(`${url.pathname}${url.search}`);
      if (normalized) paths.add(normalized);
    } catch {
      // Ignore malformed URLs in founder-written task text.
    }
  }

  const standalonePathRe = /(^|[\s"'`(>])((?:\/(?!\/)[A-Za-z0-9._~%!$&'()*+,;=:@-]+)+\/?(?:\?[^\s"'`)<]+)?)/g;
  for (const match of text.matchAll(standalonePathRe)) {
    const pathIndex = (match.index ?? 0) + match[1].length;
    if (isNegatedRouteMention(text, pathIndex)) continue;
    const normalized = normalizeRequestedPath(match[2]);
    if (normalized) paths.add(normalized);
    if (paths.size >= REQUESTED_ROUTE_LIMIT) break;
  }

  return [...paths].slice(0, REQUESTED_ROUTE_LIMIT);
}

function isLikelyErrorHtml(html: string): boolean {
  const firstChunk = html.slice(0, 2000);
  const titleText = firstChunk.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] ?? '';
  const errorHeading = /<h1[^>]*>\s*(404|500|502|503|not found|internal server error|bad gateway|service unavailable)\s*<\/h1>/i.test(firstChunk);
  const errorTitle = /\b(404|500|502|503|not found|internal server error|bad gateway|service unavailable|default page)\b/i.test(titleText);
  return errorTitle || errorHeading;
}

async function verifyRequestedRouteAtBase(baseUrl: string, path: string): Promise<VerificationCheck> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    const htmlErrorPage = contentType.includes('text/html') && isLikelyErrorHtml(body);
    const passed = response.ok && body.length > 0 && !htmlErrorPage;

    return {
      name: `requested_route:${path}`,
      passed,
      detail: passed
        ? `${baseUrl}${path} returned ${response.status} with ${body.length} bytes.`
        : `${baseUrl}${path} returned ${response.status}; bytes=${body.length}; errorPage=${htmlErrorPage}.`,
    };
  } catch (error) {
    return {
      name: `requested_route:${path}`,
      passed: false,
      detail: `Could not reach ${baseUrl}${path}: ${error instanceof Error ? error.message : 'timeout'}`,
    };
  }
}

async function probeBrowserBaseUrl(baseUrl: string): Promise<{
  baseUrl: string;
  hostname: string;
  status: number | null;
  passed: boolean;
  bytes: number;
  hasBody: boolean;
  isErrorPage: boolean;
  error?: string;
}> {
  try {
    const url = new URL(baseUrl);
    const response = await fetch(url.origin, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    const hasBody = body.includes('<body') || !contentType.includes('text/html');
    const hasContent = body.length > 0;
    const isErrorPage = contentType.includes('text/html') && isLikelyErrorHtml(body);
    return {
      baseUrl: url.origin,
      hostname: url.hostname,
      status: response.status,
      passed: response.ok && hasContent && !isErrorPage,
      bytes: body.length,
      hasBody,
      isErrorPage,
    };
  } catch (error) {
    let hostname = baseUrl;
    try { hostname = new URL(baseUrl).hostname; } catch {}
    return {
      baseUrl,
      hostname,
      status: null,
      passed: false,
      bytes: 0,
      hasBody: false,
      isErrorPage: false,
      error: error instanceof Error ? error.message : 'timeout',
    };
  }
}

async function browserUrlCandidates(
  company: { subdomain: string | null; custom_domain: string | null; render_service_id: string | null } | undefined,
  toolCalls: ExecutionToolCall[],
): Promise<string[]> {
  const rawCandidates = [
    ...extractOnrenderBaseUrls(toolCalls),
    company?.custom_domain ? `https://${company.custom_domain}` : null,
    await getRenderServiceUrl(company?.render_service_id),
    company?.subdomain ? `https://${company.subdomain}.baljia.app` : null,
  ];

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const raw of rawCandidates) {
    const normalized = normalizeBaseUrlCandidate(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  }
  return candidates;
}

// ══════════════════════════════════════════════
// VERIFICATION EVIDENCE
// ══════════════════════════════════════════════

export interface VerificationResult {
  level: VerificationLevel;
  passed: boolean;
  checks: VerificationCheck[];
  evidence: Record<string, unknown>;
  summary: string;
}

interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

// ══════════════════════════════════════════════
// MAIN ENTRY POINT — verify a completed task
// ══════════════════════════════════════════════

export async function verifyTask(task: Task): Promise<VerificationResult> {
  const level = task.verification_level ?? determineLevel(task);

  switch (level) {
    case 'none':
      return verifyNone(task);
    case 'deterministic':
      return verifyDeterministic(task);
    case 'browser_flow':
      return verifyBrowserFlow(task);
    case 'quality_review':
      return verifyQualityReview(task);
    case 'hybrid':
      return verifyHybrid(task);
    default:
      return verifyNone(task);
  }
}

// ══════════════════════════════════════════════
// LEVEL DETERMINATION — auto-select based on tag
// ══════════════════════════════════════════════

function determineLevel(task: Task): VerificationLevel {
  const tag = task.tag.toLowerCase();

  // Deterministic checks — DB/API tasks + generic engineering work that's
  // expected to ship code somewhere. 'engineering' was missing pre-2026-04-28:
  // queryforge campaign-generator (tag='engineering') fell through to 'none'
  // and verifyNone rubber-stamped a 0-deploy task as "completed".
  if (['engineering', 'feature', 'mvp', 'complex-feature', 'full-crud',
       'bug-fix', 'fix', 'api', 'crud', 'database', 'webhook', 'cron',
       'auth'].includes(tag)) {
    return 'deterministic';
  }

  // Browser flow — UI/frontend tasks (validates by hitting the deployed URL)
  if (['landing-page', 'dashboard', 'form', 'css', 'onboarding', 'settings', 'pricing-page', 'bug'].includes(tag)) {
    return 'browser_flow';
  }

  // Quality review — content/strategy tasks
  if (['blog', 'seo', 'research', 'brand-voice', 'content', 'copy'].includes(tag)) {
    return 'quality_review';
  }

  // Hybrid — complex multi-faceted tasks
  if (['billing', 'payment', 'integration', 'deploy'].includes(tag)) {
    return 'hybrid';
  }

  return 'none';
}

// ══════════════════════════════════════════════
// LEVEL 0: NONE — mark as unverified
// ══════════════════════════════════════════════

function verifyNone(task: Task): VerificationResult {
  return {
    level: 'none',
    passed: true,
    checks: [{ name: 'no_verification', passed: true, detail: 'Task marked completed without verification' }],
    evidence: {},
    summary: 'No verification required for this task type.',
  };
}

// ══════════════════════════════════════════════
// LEVEL 1: DETERMINISTIC — automated checks
// ══════════════════════════════════════════════

async function verifyDeterministic(task: Task): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  // advisory_only: failure on these checks should NOT fail the task — they're
  // for audit/observability. has_report is here because the deployed artifact
  // (a live Worker URL) is more meaningful than a written-out report; agents
  // that ship working code without a separate report row should still pass.
  const toolCalls = await getExecutionToolCalls(task.id);

  // Check 1 (HARD REQUIREMENT for deploy-shaped tags): The agent must have
  // called a DEPLOY tool. queryforge campaign-generator (task 9a36e013-…)
  // had ZERO deploy calls in 20 turns and still got rubber-stamped before
  // this check existed.
  const tagNormalized = task.tag.toLowerCase().trim();
  const requiresDeploy = DEPLOY_REQUIRED_TAGS.has(tagNormalized);
  if (requiresDeploy) {
    const { engineeringPlanningEvidence, isCapabilityPlanningTask, isReferenceRetrievalTask, isUserFacingUiTask } = await import('@/lib/agents/agent-factory');
    const capabilityLogShape = toolCalls.map((tc) => ({ tool: tc.tool }));
    const planningEvidence = engineeringPlanningEvidence(toolCalls, {
      title: task.title,
      description: task.description ?? null,
      tag: task.tag,
    });
    const lanePolicy = getTaskLanePolicy(task, {
      logEntries: toolCalls as unknown as Array<Record<string, unknown>>,
      planningDepth: planningEvidence.planningDepth,
      taskIntent: planningEvidence.taskIntent,
      selectedCapabilities: [
        ...planningEvidence.selectedCapabilities,
        ...planningEvidence.requiredCapabilities,
        ...planningEvidence.architectureCapabilities,
      ],
      riskSignals: planningEvidence.planningRiskSignals,
    });
    const fastUiTask = lanePolicy.lane === 'fast' && isUserFacingUiTask(
      { title: task.title, description: task.description ?? null },
      capabilityLogShape,
    );
    const requiresCapabilityPlan = isCapabilityPlanningTask(
      { title: task.title, description: task.description ?? null, tag: task.tag },
      capabilityLogShape,
    );
    const focusedRepair = isFocusedRepairForVerifier(task, toolCalls);
    const contractScopeLocked = hasCompleteExecutionContract(task.execution_contract);
    if (contractScopeLocked) {
      checks.push({
        name: 'execution_contract_scope',
        passed: true,
        detail: 'CEO Execution Contract is present and complete; verifier checks deployed behavior instead of requiring Engineering to re-infer product scope through capability/domain planning.',
      });
    }
    if (!contractScopeLocked && requiresCapabilityPlan) {
      const capabilityMatchCalls = toolCalls.filter((t) => t.tool === 'match_capabilities' && isSuccessfulPlanningToolCall(t.result));
      const architectureCalls = toolCalls.filter((t) => t.tool === 'compose_app_architecture' && isSuccessfulPlanningToolCall(t.result));
      const capabilityPacksLoaded = focusedRepair
        ? planningEvidence.loadedCapabilityPacks.length > 0
        : planningEvidence.requiredCapabilities.length > 0 &&
          planningEvidence.missingCapabilityPacks.length === 0 &&
          planningEvidence.loadedCapabilityPacks.length > 0;
      const capabilityPlanPassed = capabilityMatchCalls.length > 0 && capabilityPacksLoaded && architectureCalls.length > 0;
      checks.push({
        name: 'capability_plan_evidence',
        passed: capabilityPlanPassed,
        detail: capabilityPlanPassed
          ? focusedRepair
            ? `Focused repair capability plan completed: match_capabilities=${capabilityMatchCalls.length}, loaded_repair_packs=${planningEvidence.loadedCapabilityPacks.join(', ') || 'none'}, broad_missing_packs_advisory=${planningEvidence.missingCapabilityPacks.join(', ') || 'none'}, compose_app_architecture=${architectureCalls.length}.`
            : `Capability plan completed: match_capabilities=${capabilityMatchCalls.length}, required_packs=${planningEvidence.requiredCapabilities.join(', ') || 'none'}, optional_packs=${planningEvidence.optionalCapabilities.join(', ') || 'none'}, get_capability_pack=${planningEvidence.loadedCapabilityPacks.length}, compose_app_architecture=${architectureCalls.length}.`
          : `Build-shaped Engineering task missing capability planning evidence. Required before coding: match_capabilities, get_capability_pack for required capabilities only, and compose_app_architecture. Seen: match=${capabilityMatchCalls.length}, required=${planningEvidence.requiredCapabilities.join(', ') || 'none'}, loaded=${planningEvidence.loadedCapabilityPacks.join(', ') || 'none'}, missing_required=${planningEvidence.missingCapabilityPacks.join(', ') || 'none'}, architecture=${architectureCalls.length}.`,
      });
    }

    const requiresReferenceRetrieval = isReferenceRetrievalTask(
      { title: task.title, description: task.description ?? null, tag: task.tag },
      capabilityLogShape,
    );
    if (!contractScopeLocked && requiresReferenceRetrieval) {
      const referenceMatchCalls = toolCalls.filter((t) => t.tool === 'match_reference_repos' && isSuccessfulPlanningToolCall(t.result));
      const referencePatternCalls = toolCalls.filter((t) => t.tool === 'get_reference_repo_patterns' && isSuccessfulPlanningToolCall(t.result));
      const componentExampleCalls = toolCalls.filter((t) => t.tool === 'retrieve_component_examples' && isSuccessfulPlanningToolCall(t.result));
      const passed = focusedRepair || (referenceMatchCalls.length > 0 && referencePatternCalls.length > 0 && componentExampleCalls.length > 0);
      checks.push({
        name: 'reference_pattern_evidence',
        passed,
        detail: focusedRepair
          ? 'Focused repair lane: reference retrieval is advisory. Existing codebase context, capability pack evidence, and a narrow architecture repair plan are sufficient; fresh builds and world-class canaries remain strict.'
          : passed
          ? `Reference retrieval completed: match_reference_repos=${referenceMatchCalls.length}, get_reference_repo_patterns=${referencePatternCalls.length}, retrieve_component_examples=${componentExampleCalls.length}.`
          : `UI/architecture-heavy Engineering task missing reference pattern evidence. Required before coding: match_reference_repos, get_reference_repo_patterns, and retrieve_component_examples. Seen: match=${referenceMatchCalls.length}, pattern=${referencePatternCalls.length}, examples=${componentExampleCalls.length}.`,
      });
    }

    const deployCalls = toolCalls.filter(isSuccessfulDeployCall);
    const attemptedDeployTools = toolCalls
      .filter((t) => DEPLOY_TOOL_NAMES.has(t.tool))
      .map((t) => t.tool);
    // Render auto-deploys on git push when the service has GitHub auto-deploy
    // enabled, so an explicit render_deploy can fail (e.g., "deploy already in
    // progress") while the actual deployment succeeds. Accept successful
    // github commits as alternate deploy evidence — the journey check below
    // is the truer source of "did this actually ship and work" gating.
    const githubCommits = toolCalls.filter((t) =>
      (t.tool === 'github_push_file' || t.tool === 'github_create_commit') &&
      !!t.result &&
      !FAILED_TOOL_RESULT_RE.test(t.result),
    );
    // Third evidence path: a successful agent-driven journey passes against
    // the company's deployed URL. The journey CAN'T pass without a working
    // deploy — so if the agent ran one and it returned JOURNEY PASS, deploy
    // is provably live, even if THIS task didn't push or call render_deploy
    // (e.g., agent decided no redeploy was needed because existing deploy
    // already serves the requested feature).
    const successfulJourneys = toolCalls.filter(isSuccessfulJourneyCall);
    const deployPassed = deployCalls.length > 0 || githubCommits.length > 0 || successfulJourneys.length > 0;
    checks.push({
      name: 'deploy_evidence',
      passed: deployPassed,
      detail: deployCalls.length > 0
        ? `${deployCalls.length} successful deploy tool call(s): ${[...new Set(deployCalls.map((t) => t.tool))].join(', ')}`
        : githubCommits.length > 0
          ? `${githubCommits.length} successful GitHub commit(s); explicit deploy tools failed but auto-deploy on push proves shipping. Journey check below validates the deployed app actually works.`
          : successfulJourneys.length > 0
            ? `No new deploy in this task, but ${successfulJourneys.length} successful verify_user_journey call(s) prove the existing deploy is live and serves the requested feature.`
            : `Tag "${task.tag}" requires either a successful deploy tool call, a successful github commit (auto-deploy on push), OR a successful verify_user_journey against the existing deploy. Attempts: deploy=${attemptedDeployTools.length ? [...new Set(attemptedDeployTools)].join(', ') : 'none'}; github=${toolCalls.filter((t) => t.tool === 'github_push_file' || t.tool === 'github_create_commit').length}; journey=${toolCalls.filter((t) => JOURNEY_TOOL_NAMES.has(t.tool)).length}. Tools used: ${[...new Set(toolCalls.map((t) => t.tool).filter(Boolean))].slice(0, 8).join(', ') || 'none'}`,
    });

    // Health checks: only the FINAL state matters, not transition flaps. An
    // agent that pushes a fix, redeploys, and re-checks should be allowed to
    // see one failed probe before the redeploy without being penalized for
    // it. The verifier's job is to certify the END state, not punish the
    // debugging process. Rule: the MOST RECENT health check must have passed.
    // This matches the completion gate's logic (only "unaddressed" failures
    // count) and aligns verifier behavior with what the agent was just told.
    const healthAttempts = toolCalls.filter((t) => HEALTH_TOOL_NAMES.has(t.tool));
    const lastHealth = healthAttempts.length > 0 ? healthAttempts[healthAttempts.length - 1] : null;
    const lastHealthPassed = lastHealth !== null && isSuccessfulHealthCall(lastHealth);
    const healthSuccesses = healthAttempts.filter(isSuccessfulHealthCall);
    const failedHealthCalls = healthAttempts.filter((t) => !isSuccessfulHealthCall(t));
    checks.push({
      name: 'render_health_evidence',
      passed: lastHealthPassed,
      detail: healthAttempts.length === 0
        ? `Render deploy-shaped task must call check_url_health after deploy. Health attempts: none.`
        : lastHealthPassed
          ? `${healthSuccesses.length} of ${healthAttempts.length} health check(s) passed (intermediate failures during transitions ignored — final check is 2xx).`
          : `Final \`check_url_health\` returned non-2xx: ${lastHealth!.result.slice(0, 160)}. Fix the underlying issue, redeploy, and re-run check_url_health until the LAST call passes.`,
    });

    // HARD: deploy-shaped tasks must walk a full user journey end-to-end.
    // check_url_health only proves "/ returned 2xx"; verify_user_journey proves
    // a real user could register, sign in, and use the core feature.
    const journeyCalls = toolCalls.filter(isSuccessfulJourneyCall);
    const attemptedJourneys = toolCalls
      .filter((t) => JOURNEY_TOOL_NAMES.has(t.tool))
      .map((t) => t.tool);

    if (journeyCalls.length > 0) {
      checks.push({
        name: 'user_journey_evidence',
        passed: true,
        detail: `${journeyCalls.length} passing user journey verification(s).`,
      });
    } else if (fastUiTask) {
      checks.push({
        name: 'user_journey_evidence',
        passed: true,
        detail: 'Fast UI repair lane: verify_user_journey is advisory. The hard targeted proof is browser_ui_evidence plus design_audit/static scan after the changed UI surface.',
      });
    } else if (deployCalls.length > 0 || githubCommits.length > 0) {
      // Agent skipped verify_user_journey but a deploy or push happened. Run
      // the verifier-side fallback for diagnostic visibility, but DO NOT let
      // it substitute for the mandatory agent journey call — skipping is a
      // hard fail regardless of fallback outcome. Fallback only proves "/" and
      // "/api/health" respond; that's not the same as proving the requested
      // feature actually works for a real user.
      const fallback = await runFallbackJourney(task.company_id);
      const fallbackDetail = !fallback
        ? 'fallback could not resolve a deployed URL (no custom_domain / no render_service_id)'
        : fallback.allPassed
          ? `fallback liveness probe PASSED (${fallback.passedSteps}/${fallback.totalSteps}) — but / and /api/health responding is NOT proof the requested feature works`
          : `fallback liveness probe FAILED — ${fallback.summary.split('\n')[0]}`;
      checks.push({
        name: 'user_journey_evidence',
        passed: false,
        detail: `Engineering task must call verify_user_journey itself after deploy — the agent skipped it. ${fallbackDetail}. Journey attempts: ${attemptedJourneys.length ? attemptedJourneys.join(', ') : 'none'}.`,
      });
    } else {
      checks.push({
        name: 'user_journey_evidence',
        passed: false,
        detail: `Engineering task must run verify_user_journey after deploy to prove the app actually works for real users (register → use feature → log in). Journey attempts: ${attemptedJourneys.length ? attemptedJourneys.join(', ') : 'none'}.`,
      });
    }

    // DB state proof is hard for full-stack/canary tasks and advisory for
    // static or marketing deploys. User journeys can pass even when writes
    // silently fail, so DB-writing flows need a SELECT-based assertion.
    const dbStateCalls = toolCalls.filter(isSuccessfulDbStateCall);
    const attemptedDbStateCalls = toolCalls
      .filter((t) => DB_STATE_TOOL_NAMES.has(t.tool))
      .map((t) => t.tool);
    const dbStateRequired = requiresDbStateEvidence(task);
    checks.push({
      name: 'db_state_evidence',
      passed: dbStateCalls.length > 0,
      detail: dbStateCalls.length > 0
        ? `${dbStateCalls.length} passing DB-state assertion(s) — side-effects confirmed.`
        : `${dbStateRequired ? 'Required' : 'Advisory'}: no passing verify_db_state call. If your app writes to the DB, follow up the journey with a SELECT-based assertion to catch lying redirects. Attempts: ${attemptedDbStateCalls.length ? attemptedDbStateCalls.join(', ') : 'none'}.`,
    });

    const requiresBrowserUi = isUserFacingUiTask(
      { title: task.title, description: task.description ?? null },
      capabilityLogShape,
    );
    if (requiresBrowserUi) {
      const browserUiAttempts = toolCalls.filter((t) => BROWSER_UI_TOOL_NAMES.has(t.tool));
      const lastBrowserUi = browserUiAttempts.length > 0 ? browserUiAttempts[browserUiAttempts.length - 1] : null;
      const lastBrowserUiPassed = lastBrowserUi !== null && isSuccessfulBrowserUiCall(lastBrowserUi);
      checks.push({
        name: 'browser_ui_evidence',
        passed: lastBrowserUiPassed,
        detail: !lastBrowserUi
          ? 'User-facing/full-stack UI task missing verify_browser_ui. HTTP journey checks cannot see React hydration errors, missing buttons, blank shells, or forms that cannot be submitted from the browser.'
          : lastBrowserUiPassed
            ? `Final verify_browser_ui passed (ran ${browserUiAttempts.length} browser UI check(s)).`
            : `Final verify_browser_ui failed: ${lastBrowserUi.result.slice(0, 240)}. Fix browser-visible UI issues, redeploy, and rerun verify_browser_ui.`,
      });

      const plannedInteractionCount = Math.max(
        0,
        ...toolCalls.map((t) => interactionContractCountFromText(t.result)),
      );
      const interactionContractPlanned = plannedInteractionCount > 0;
      if (interactionContractPlanned) {
        const interactionAttempts = toolCalls.filter((t) => INTERACTION_TOOL_NAMES.has(t.tool));
        const lastInteraction = interactionAttempts.length > 0 ? interactionAttempts[interactionAttempts.length - 1] : null;
        const lastInteractionCounts = lastInteraction ? interactionProofCountsFromText(lastInteraction.result) : null;
        const lastInteractionPassed = lastInteraction !== null && isSuccessfulInteractionCall(lastInteraction, plannedInteractionCount);
        checks.push({
          name: 'interaction_contract_evidence',
          passed: lastInteractionPassed,
          detail: !lastInteraction
            ? 'Frontend plan emitted interaction contracts, but the task never ran verify_interaction_contract. Buttons/forms must be clicked and read back through the real UI.'
            : lastInteractionPassed
              ? `Final verify_interaction_contract proved ${lastInteractionCounts?.passed ?? plannedInteractionCount}/${plannedInteractionCount} planned interaction(s) (ran ${interactionAttempts.length} proof attempt(s)).`
            : `Final verify_interaction_contract did not prove every planned interaction (${lastInteractionCounts?.passed ?? 0}/${plannedInteractionCount}, failed=${lastInteractionCounts?.failed ?? 'unknown'}): ${lastInteraction.result.slice(0, 240)}. Fix the broken button/form, redeploy, and rerun.`,
        });
      }

      const productContractRequired = requiresProductBuildContract({
        lane: lanePolicy.lane,
        taskIntent: planningEvidence.taskIntent,
        planningDepth: planningEvidence.planningDepth,
        isUserFacing: requiresBrowserUi,
        focusedRepair,
        selectedDomains: planningEvidence.selectedDomains,
        selectedCapabilities: [
          ...planningEvidence.selectedCapabilities,
          ...planningEvidence.requiredCapabilities,
          ...planningEvidence.architectureCapabilities,
        ],
        clearDomainSignals: planningEvidence.selectedDomains.length > 0,
      });
      if (!contractScopeLocked && productContractRequired) {
        const acceptancePassed =
          planningEvidence.productContractPresent &&
          planningEvidence.productContractFlowCount > 0 &&
          planningEvidence.productContractArtifactPresent &&
          planningEvidence.acceptanceProofPresent &&
          planningEvidence.acceptanceProofFailedCount === 0 &&
          planningEvidence.productContractMissingFlowIds.length === 0 &&
          planningEvidence.productContractMissingFieldProofs.length === 0 &&
          (
            !(planningEvidence.productContractAuthBaseline || planningEvidence.productContractUserIsolation) ||
            planningEvidence.authIsolationProofPassed
          );
        checks.push({
          name: 'product_build_contract_acceptance',
          passed: acceptancePassed,
          detail: acceptancePassed
            ? `Product Build Contract proved exact flow ids (${planningEvidence.acceptanceProofPassedFlowIds.join(', ') || 'none'}), required fields, and auth isolation where required.`
            : `Product Build Contract missing or unproved. build_brief=${planningEvidence.buildBriefPresent}; contract=${planningEvidence.productContractPresent}; artifact=${planningEvidence.productContractArtifactPresent}; flows=${planningEvidence.productContractFlowCount}; acceptance=${planningEvidence.acceptanceProofPresent}; missing_flow_ids=${planningEvidence.productContractMissingFlowIds.join(',') || 'none'}; missing_field_proofs=${planningEvidence.productContractMissingFieldProofs.map((item) => `${item.flowId}:${item.entity}`).join(',') || 'none'}; auth_isolation=${planningEvidence.authIsolationProofPresent ? (planningEvidence.authIsolationProofPassed ? 'pass' : 'fail') : 'missing'}. Tester must read PRODUCT_BUILD_CONTRACT_EVIDENCE, not the builder summary.`,
        });

        if (planningEvidence.engineeringLaneRequiredRoles.length > 0) {
          const latestDeployOrPushAt = lastToolCallIndex(toolCalls, (call) =>
            DEPLOY_TOOL_NAMES.has(call.tool) ||
            call.tool === 'github_push_file' ||
            call.tool === 'github_create_commit'
          );
          const laneIssues = engineeringLaneCompletionIssues(
            planningEvidence.engineeringLaneRequiredRoles,
            planningEvidence.engineeringLaneOutputs,
            {
              minLogIndex: Math.max(
                planningEvidence.lastProductContractAt,
                planningEvidence.lastAcceptanceProofAt,
                planningEvidence.lastAuthIsolationProofAt,
                latestDeployOrPushAt,
              ),
            },
          );
          checks.push({
            name: 'engineering_lane_outputs',
            passed: laneIssues.length === 0,
            detail: laneIssues.length === 0
              ? `Completed bounded Engineering lane outputs present for ${planningEvidence.engineeringLaneRequiredRoles.join(', ')} after latest contract/deploy/proof evidence.`
              : `Missing, weak, or stale bounded Engineering lane outputs for ${laneIssues.map((issue) => issue.role).join(', ')}. Details: ${laneIssues.map((issue) => `${issue.role} ${issue.reason}`).join('; ')}. These outputs do not replace Product Build Contract proof; they prove each bounded lane reconciled against it.`,
          });
        }
      }

      const criticalFlowContracts = contractScopeLocked
        ? []
        : requiredCriticalFlowContracts(
            lanePolicy,
            detectCriticalFlowContracts(task, {
              logEntries: toolCalls,
              selectedCapabilities: [
                ...planningEvidence.selectedCapabilities,
                ...planningEvidence.requiredCapabilities,
                ...planningEvidence.architectureCapabilities,
              ],
              selectedDomains: planningEvidence.selectedDomains,
              frontendPlanPatterns: planningEvidence.frontendPlanPatterns,
              taskIntent: planningEvidence.taskIntent,
              planningDepth: planningEvidence.planningDepth,
              isUserFacing: requiresBrowserUi,
            }),
          );
      checks.push(...criticalFlowEvidenceChecks(toolCalls, criticalFlowContracts));
    }

    // ADVISORY: static code scan — pattern-based check over pushed source.
    // Cheap (regex over JS/TS files), catches AI-coding pitfalls runtime
    // verification can't see (silent catch, secret-in-log, env-without-config,
    // template-SQL injection). Encouraged but advisory.
    const staticScanAttempts = toolCalls.filter((t) => STATIC_SCAN_TOOL_NAMES.has(t.tool));
    const cleanStaticScans = staticScanAttempts.filter(isCleanStaticScanCall);
    // Only require static_code_scan when the agent actually pushed/committed
    // code in this task. A "verify the existing deploy" task with zero commits
    // has no new code to scan — skipping the scan is correct, not a violation.
    const codeWasPushed = githubCommits.length > 0;
    // Static scan: same logic as health checks — only the MOST RECENT scan
    // matters. An agent that ran 10 scans early (all dirty), fixed every
    // finding, and ran a final clean scan should pass. Penalizing historical
    // dirty scans punishes iterative debugging — exactly the behavior we
    // want to encourage. Matches the completion gate's lastScanCleanAt check.
    const lastScan = staticScanAttempts.length > 0 ? staticScanAttempts[staticScanAttempts.length - 1] : null;
    const lastScanClean = lastScan !== null && isCleanStaticScanCall(lastScan);
    checks.push({
      name: 'static_code_scan',
      passed: !codeWasPushed
        ? true
        : staticScanAttempts.length > 0 && lastScanClean,
      detail: !codeWasPushed
        ? `No new code pushed in this task — static scan not required.`
        : staticScanAttempts.length === 0
          ? `Code was pushed but no static_code_scan call. The scanner catches silent-catch blocks, secret-in-log, template-SQL, missing trust-proxy — issues runtime journey verification cannot see. Run static_code_scan after every github_create_commit.`
          : lastScanClean
            ? `Final static_code_scan clean (ran ${staticScanAttempts.length} scan(s) total; earlier dirty scans were addressed before the last one).`
            : `Final static_code_scan found high-severity findings: ${lastScan!.result.slice(0, 200)}. Address them via github_create_commit before declaring complete.`,
    });

    // ADVISORY if absent, HARD if it ran dirty: LLM code review catches
    // semantic bugs static patterns can't (auth bypass, race conditions,
    // business logic mistakes). We encourage one review per build, but once
    // the reviewer reports HIGH findings the task cannot pass until a clean
    // review follows.
    const reviewAttempts = toolCalls.filter((t) => CODE_REVIEW_TOOL_NAMES.has(t.tool));
    const lastReview = reviewAttempts.length > 0 ? reviewAttempts[reviewAttempts.length - 1] : null;
    const lastReviewClean = lastReview !== null && isCleanCodeReviewCall(lastReview);
    checks.push({
      name: 'llm_code_review',
      passed: reviewAttempts.length > 0,
      detail: reviewAttempts.length === 0
        ? `Advisory: no review_pushed_code calls. An LLM diff review catches semantic bugs runtime verification can't see — auth bypass, race conditions, missing input validation. One Haiku call per build (~$0.01-0.05).`
        : `${reviewAttempts.length} code review(s) ran.`,
    });
    if (reviewAttempts.length > 0) {
      checks.push({
        name: 'llm_code_review_clean',
        passed: lastReviewClean,
        detail: lastReviewClean
          ? `Final review_pushed_code clean (ran ${reviewAttempts.length} review(s) total; earlier HIGH findings were addressed before the last one).`
          : `Final review_pushed_code still flagged high-severity issues: ${lastReview!.result.slice(0, 200)}. Address each finding, push a fix, and re-run review_pushed_code until clean.`,
      });
    }

    // HARD (audit P1.2): Render log quality. The prompt + completion gate
    // require `render_get_logs` to confirm no startup errors before stopping.
    // The verifier mirrors that contract — a deploy whose logs contain
    // `level=error` / fatal / "ECONNREFUSED" / Postgres SQLSTATE codes is
    // broken even if /api/health returned 200.
    const logCalls = toolCalls.filter((t) => t.tool === 'render_get_logs');
    // Log check fires when EITHER:
    //   - the agent pushed code (commits → auto-deploy on Render), OR
    //   - the agent called a deploy tool directly (render_create_service,
    //     render_deploy, create_instance, render_set_env_vars).
    // Previously only checked githubCommits — meaning a task that used the
    // atomic create_instance tool (now in DEPLOY_TOOL_NAMES) skipped the log
    // verification entirely (audit, 2026-05-12 round 4).
    const deployWasTriggered = deployCalls.length > 0 || githubCommits.length > 0;
    // The most recent log call is the one that matters — earlier dirty logs
    // can be the agent iterating. We look for "error" / "fatal" / common
    // crash signatures in the LAST log result.
    const lastLogCall = logCalls.length > 0 ? logCalls[logCalls.length - 1] : null;
    const LOG_ERROR_RE = /\b(level=error|level=fatal|FATAL|ECONNREFUSED|Cannot find module|SQLSTATE|permission denied|EACCES|Error: |\s+Error:|UnhandledPromiseRejection)\b/i;
    const lastLogClean = lastLogCall !== null && !LOG_ERROR_RE.test(lastLogCall.result);
    checks.push({
      name: 'deploy_logs_clean',
      passed: !deployWasTriggered
        ? true
        : logCalls.length > 0 && lastLogClean,
      detail: !deployWasTriggered
        ? 'No deploy triggered in this task — log check not required.'
        : logCalls.length === 0
          ? 'A deploy was triggered (push or create_instance / render_create_service / render_deploy / render_set_env_vars) but no render_get_logs call. Apps that boot with bad env vars / wrong DATABASE_URL / missing tables log errors on startup while still returning 2xx on /. Run render_get_logs after every deploy.'
          : lastLogClean
            ? `Final render_get_logs clean (ran ${logCalls.length} log check(s) total).`
            : `Final render_get_logs contained error signatures: ${lastLogCall!.result.slice(0, 200)}. Fix the root cause, redeploy, and re-pull logs.`,
    });

    // HARD (audit P1.2): design_audit + design_critique for UI tasks. The
    // completion gate already enforces these but only blocks the agent from
    // claiming done — if the agent gives up (gate exhausted) the gate doesn't
    // fail the task on its own. The verifier mirrors the contract so that
    // exhausted-gate UI tasks fail at this layer too.
    const verifierLogShape = toolCalls.map((tc) => ({ tool: tc.tool }));
    const isUiTaskForVerifier = isUserFacingUiTask({ title: task.title, description: task.description ?? null }, verifierLogShape);
    if (isUiTaskForVerifier) {
      // design_audit (regex anti-patterns)
      const auditCalls = toolCalls.filter((t) => t.tool === 'design_audit');
      const lastAudit = auditCalls.length > 0 ? auditCalls[auditCalls.length - 1] : null;
      const auditClean = lastAudit !== null && /\bCLEAN\b/.test(lastAudit.result) && !/\bHIGH\b/.test(lastAudit.result);
      checks.push({
        name: 'design_audit_clean',
        passed: auditCalls.length > 0 && auditClean,
        detail: auditCalls.length === 0
          ? 'UI task missing design_audit call. Run design_audit against the deployed URL to catch surface anti-patterns (indigo gradients, emoji-in-h1, lorem, API docs on landing).'
          : auditClean
            ? `Final design_audit CLEAN (ran ${auditCalls.length} audit(s) total).`
            : `Final design_audit reported HIGH findings: ${lastAudit!.result.slice(0, 200)}. Fix each via github_create_commit, redeploy, and re-run.`,
      });

      // design_critique (vision-LLM rubric) — only when Gemini is configured.
      // Without the key, design_critique returns an error string; we can't
      // hold the agent to a check the environment can't perform.
      const { isDesignCritiqueConfigured } = await import('@/lib/services/design-critic.service');
      if (isDesignCritiqueConfigured()) {
        const critiqueCalls = toolCalls.filter((t) => t.tool === 'design_critique');
        const lastCritique = critiqueCalls.length > 0 ? critiqueCalls[critiqueCalls.length - 1] : null;
        const critiqueClean = lastCritique !== null && /\bCLEAN\b/.test(lastCritique.result) && !/\bBLOCKER\b/.test(lastCritique.result);
        const critiqueBlocker = lastCritique !== null && (/\[[^\]]*BLOCKER[^\]]*\]/i.test(lastCritique.result) || /\b[1-9]\d*\s+BLOCKER/i.test(lastCritique.result));
        const critiqueRequired = isDesignCritiqueRequiredForVerifier(task, planningEvidence, critiqueBlocker);
        const critiqueDetail = critiqueCalls.length === 0
          ? critiqueRequired
            ? 'UI task missing required design_critique call. After design_audit, run design_critique to judge typography rhythm, hierarchy, mobile state, and visual quality.'
            : 'Focused/narrow UI repair: design_critique was not required because design_audit/browser UI evidence are the hard gates for this task.'
          : critiqueClean
            ? `Final design_critique CLEAN (ran ${critiqueCalls.length} critique(s) total).`
            : critiqueBlocker
              ? `Final design_critique reported BLOCKER findings: ${lastCritique!.result.slice(0, 200)}. Address each, redeploy, re-run until 0 BLOCKERs.`
              : critiqueRequired
                ? `Final design_critique did not return CLEAN: ${lastCritique!.result.slice(0, 200)}. Re-run or fix the feedback before completing this UI task.`
                : `Optional design_critique returned non-blocking feedback: ${lastCritique!.result.slice(0, 200)}.`;
        checks.push({
          name: 'design_critique_clean',
          passed: critiqueRequired ? critiqueCalls.length > 0 && critiqueClean : !critiqueBlocker,
          detail: critiqueDetail,
        });
      }
    }

    // ADVISORY: Backend Quality Bar adherence — static checks against the
    // pushed repo. Tests folder and README must exist; future builds can
    // grow this set (trust-proxy, env validation, etc.). Skipped silently
    // if the repo isn't reachable (no github_repo, missing token, GitHub
    // outage) to avoid false negatives.
    const [companyRow] = await db
      .select({ github_repo: companies.github_repo })
      .from(companies)
      .where(eq(companies.id, task.company_id))
      .limit(1);
    const hygiene = await getRepoHygiene(companyRow?.github_repo ?? null);
    if (hygiene.reachable) {
      checks.push({
        name: 'tests_folder_present',
        passed: hygiene.hasTestsFolder,
        detail: hygiene.hasTestsFolder
          ? `tests/ folder has ${hygiene.testFileCount} test file(s).`
          : `Advisory: no tests/ folder (or empty) in ${companyRow?.github_repo}. Backend Quality Bar P0 requires at minimum one happy-path journey test + one failure-mode test per critical handler.`,
      });
      checks.push({
        name: 'readme_present',
        passed: hygiene.hasReadme,
        detail: hygiene.hasReadme
          ? `README is ${hygiene.readmeBytes} bytes.`
          : `Advisory: README missing or under 200 bytes in ${companyRow?.github_repo}. Quality Bar P1 requires a README with required env vars + how to run tests + how to redeploy.`,
      });
    }
  }

  checks.push({
    name: 'no_agent_loop',
    passed: !hasAgentLoop(toolCalls),
    detail: hasAgentLoop(toolCalls)
      ? 'Agent was stopped by loop/watchdog detection before a clean finish.'
      : 'No agent loop detected.',
  });

  // Gate exhaustion = the agent burned through MAX_FORCED_CONTINUATIONS while
  // the completion gate still had unresolved BLOCKERs (broken journey, dirty
  // design_audit, missing design_critique, etc.). The agent then "finished"
  // anyway. Without escalating this here, the verifier can pass on health +
  // scan and miss the underlying unfixed quality failure (audit P1.1).
  const gateState = hasGateExhaustion(toolCalls);
  checks.push({
    name: 'completion_gate_resolved',
    passed: !gateState.exhausted,
    detail: gateState.exhausted
      ? `Completion gate exhausted — agent ran out of forced-continuation attempts with the gate still blocking. Last block: ${gateState.reason ?? '(no detail)'}. The underlying quality failure was not fixed.`
      : 'Completion gate either passed cleanly or was not engaged.',
  });

  // Check 2 (advisory): Task has a report. Engineering tasks ship code as the
  // primary artifact — a separate report row is nice to have but not required.
  const reportRows = await db.select({ id: reports.id, title: reports.title })
    .from(reports).where(eq(reports.task_id, task.id));

  checks.push({
    name: 'has_report',
    passed: reportRows.length > 0,
    detail: reportRows.length ? `Found ${reportRows.length} report(s)` : 'No execution report (advisory — deploy artifact is the proof)',
  });

  // Check 3 (hard): Task completed within time limit
  if (task.started_at && task.completed_at) {
    const duration = new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
    const maxMs = 4 * 60 * 60 * 1000; // 4 hours
    checks.push({
      name: 'within_time_limit',
      passed: duration <= maxMs,
      detail: `Duration: ${Math.round(duration / 60000)} minutes`,
    });
  }

  // Check 4 (hard): Turn count within limits
  checks.push({
    name: 'within_turn_limit',
    passed: task.turn_count <= task.max_turns,
    detail: `Turns: ${task.turn_count}/${task.max_turns}`,
  });

  // Check 5 (hard): No error in execution
  const failureClassBlocks = task.failure_class !== null && task.failure_class !== 'verification_reject';
  checks.push({
    name: 'no_failure',
    passed: !failureClassBlocks,
    detail: task.failure_class === 'verification_reject'
      ? 'Previous verifier rejection is re-checkable; current evidence determines pass/fail.'
      : task.failure_class
        ? `Failure: ${task.failure_class}`
        : 'No failures detected',
  });

  // Pass = no HARD check failed. Advisory checks can fail without blocking.
  const failedHardChecks = hardFailures(checks, task);
  const passed = failedHardChecks.length === 0;
  const advisoryFailures = checks.filter((c) => !c.passed && isAdvisoryCheckName(c.name, task));

  return {
    level: 'deterministic',
    passed,
    checks,
    evidence: {
      report_count: reportRows.length,
      requires_deploy: requiresDeploy,
      advisory_failures: advisoryFailures.map((c) => c.name),
    },
    summary: passed
      ? (advisoryFailures.length > 0
        ? `${checks.length - advisoryFailures.length}/${checks.length} hard checks passed (${advisoryFailures.length} advisory failed: ${advisoryFailures.map((c) => c.name).join(', ')}).`
        : `All ${checks.length} deterministic checks passed.`)
      : `${failedHardChecks.length} hard check(s) failed: ${failedHardChecks.map((c) => c.name).join(', ')}.`,
  };
}

// ══════════════════════════════════════════════
// LEVEL 2: BROWSER FLOW — check deployed page
// ══════════════════════════════════════════════

async function verifyBrowserFlow(task: Task): Promise<VerificationResult> {
  // Start with deterministic checks
  const deterministicResult = await verifyDeterministic(task);
  const toolCalls = await getExecutionToolCalls(task.id);

  const browserChecks: VerificationCheck[] = [...deterministicResult.checks];

  // Browser check: deployed URL is accessible
  // NOTE: Requires company to have render_service_id or custom_domain set
  const [company] = await db.select({
    subdomain: companies.subdomain, custom_domain: companies.custom_domain,
    render_service_id: companies.render_service_id,
  }).from(companies).where(eq(companies.id, task.company_id)).limit(1);

  const candidates = await browserUrlCandidates(company, toolCalls);
  let selectedProbe: Awaited<ReturnType<typeof probeBrowserBaseUrl>> | null = null;
  const failedProbeDetails: string[] = [];

  if (candidates.length > 0) {
    for (const candidate of candidates) {
      const probe = await probeBrowserBaseUrl(candidate);
      if (probe.passed) {
        selectedProbe = probe;
        break;
      }
      failedProbeDetails.push(probe.status === null
        ? `${candidate}: ${probe.error ?? 'unreachable'}`
        : `${candidate}: HTTP ${probe.status}, bytes=${probe.bytes}, errorPage=${probe.isErrorPage}`);
    }

    if (selectedProbe) {
      browserChecks.push({
        name: 'site_accessible',
        passed: true,
        detail: `${selectedProbe.baseUrl} returned ${selectedProbe.status}; selected from ${candidates.length} candidate URL(s).${failedProbeDetails.length ? ` Earlier candidate failures ignored after Render URL fallback: ${failedProbeDetails.join('; ')}` : ''}`,
      });

      browserChecks.push({
        name: 'page_has_content',
        passed: selectedProbe.bytes > 500 && selectedProbe.hasBody && !selectedProbe.isErrorPage,
        detail: selectedProbe.bytes > 500 && selectedProbe.hasBody && !selectedProbe.isErrorPage
          ? `Page has ${selectedProbe.bytes} bytes with valid body content at ${selectedProbe.baseUrl}.`
          : `Page issue at ${selectedProbe.baseUrl}: body=${selectedProbe.hasBody}, size=${selectedProbe.bytes}, errorPage=${selectedProbe.isErrorPage}.`,
      });

      const requestedPaths = extractRequestedBrowserPaths(task, selectedProbe.hostname);
      for (const path of requestedPaths) {
        browserChecks.push(await verifyRequestedRouteAtBase(selectedProbe.baseUrl, path));
      }
    } else {
      browserChecks.push({
        name: 'site_accessible',
        passed: false,
        detail: `No candidate app URL responded with valid content. Attempts: ${failedProbeDetails.join('; ') || 'none'}`,
      });
    }
  } else {
    browserChecks.push({
      name: 'site_accessible',
      passed: true, // Skip if no deployment
      detail: 'No deployment URL configured — skipping browser verification.',
    });
  }

  const failedHardChecks = hardFailures(browserChecks, task);
  const passed = failedHardChecks.length === 0;

  return {
    level: 'browser_flow',
    passed,
    checks: browserChecks,
    evidence: {
      ...deterministicResult.evidence,
      browser_url_candidates: candidates,
      selected_browser_url: selectedProbe?.baseUrl ?? null,
      requested_paths: selectedProbe
        ? extractRequestedBrowserPaths(task, selectedProbe.hostname)
        : [],
    },
    summary: passed
      ? `Browser flow verification passed (${browserChecks.length} checks).`
      : `${failedHardChecks.length} hard browser check(s) failed: ${failedHardChecks.map((c) => c.name).join(', ')}.`,
  };
}

// ══════════════════════════════════════════════
// LEVEL 3: QUALITY REVIEW — content/output check
// ══════════════════════════════════════════════

async function verifyQualityReview(task: Task): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  // has_recommendations is ADVISORY — many factual research tasks
  // ("give me 3 facts about X") legitimately have no actionable recs and
  // shouldn't fail. Production failure observed 2026-04-25 on
  // "Reddit API rate limits research" (4 turns, 134 words, valid sources)
  // — verifier required "recommend|suggest|should|action|next step"
  // regex match. Now informational only.
  const advisoryNames = new Set<string>(['has_recommendations']);

  const reportRows = await db.select({ id: reports.id, title: reports.title, content: reports.content })
    .from(reports).where(eq(reports.task_id, task.id));

  const hasReport = reportRows.length > 0;
  checks.push({
    name: 'has_report',
    passed: hasReport,
    detail: hasReport ? `${reportRows.length} report(s) created` : 'No report found',
  });

  if (hasReport && reportRows[0].content) {
    const content = reportRows[0].content;
    const wordCount = content.split(/\s+/).length;

    // Quality (HARD): minimum word count
    checks.push({
      name: 'minimum_content',
      passed: wordCount >= 100,
      detail: `Report has ${wordCount} words (min: 100)`,
    });

    // Quality (HARD): has structure (headers)
    const hasHeaders = content.includes('#') || content.includes('##');
    checks.push({
      name: 'has_structure',
      passed: hasHeaders,
      detail: hasHeaders ? 'Report has markdown headers' : 'Report lacks structure (no headers)',
    });

    // Quality (ADVISORY): has actionable items
    const hasActions = /recommend|suggest|should|action|next step/i.test(content);
    checks.push({
      name: 'has_recommendations',
      passed: hasActions,
      detail: hasActions ? 'Contains actionable recommendations' : 'No actionable recommendations (advisory — fine for factual research)',
    });
  }

  const hardFailures = checks.filter((c) => !c.passed && !advisoryNames.has(c.name));
  const advisoryFailures = checks.filter((c) => !c.passed && advisoryNames.has(c.name));
  const passed = hardFailures.length === 0;

  return {
    level: 'quality_review',
    passed,
    checks,
    evidence: {
      report_word_count: reportRows[0]?.content?.split(/\s+/).length ?? 0,
      advisory_failures: advisoryFailures.map((c) => c.name),
    },
    summary: passed
      ? (advisoryFailures.length > 0
        ? `${checks.length - advisoryFailures.length}/${checks.length} hard checks passed (${advisoryFailures.length} advisory failed: ${advisoryFailures.map((c) => c.name).join(', ')}).`
        : `Quality review passed (${checks.length} checks).`)
      : `${hardFailures.length} hard quality check(s) failed: ${hardFailures.map((c) => c.name).join(', ')}.`,
  };
}

// ══════════════════════════════════════════════
// LEVEL 4: HYBRID — deterministic + browser + quality
// ══════════════════════════════════════════════

async function verifyHybrid(task: Task): Promise<VerificationResult> {
  const [deterministic, browser, quality] = await Promise.all([
    verifyDeterministic(task),
    verifyBrowserFlow(task),
    verifyQualityReview(task),
  ]);

  // Combine all checks, deduplicate by name
  const seenNames = new Set<string>();
  const allChecks: VerificationCheck[] = [];

  for (const check of [...deterministic.checks, ...browser.checks, ...quality.checks]) {
    if (!seenNames.has(check.name)) {
      seenNames.add(check.name);
      allChecks.push(check);
    }
  }

  const failedHardChecks = hardFailures(allChecks, task);
  const passed = failedHardChecks.length === 0;

  return {
    level: 'hybrid',
    passed,
    checks: allChecks,
    evidence: {
      ...deterministic.evidence,
      ...browser.evidence,
      ...quality.evidence,
    },
    summary: passed
      ? `Hybrid verification passed (${allChecks.length} checks across 3 levels).`
      : `${failedHardChecks.length} hard check(s) failed across deterministic, browser, and quality levels: ${failedHardChecks.map((c) => c.name).join(', ')}.`,
  };
}

// ══════════════════════════════════════════════
// POST-VERIFICATION — update task status
// ══════════════════════════════════════════════

/**
 * Verify a task and set its final status.
 * This is the SOLE AUTHORITY for transitioning a task from 'verifying'
 * to 'completed' or 'failed' (SPEC-CTRL-106).
 */
export async function verifyAndUpdate(taskId: string): Promise<VerificationResult> {
  const task = await taskService.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const result = await verifyTask(task);

  // Verifier is the sole authority for final task status (SPEC-CTRL-106)
  await taskService.finalizeTask(taskId, result.passed);
  await persistLatestExecutionVerification(taskId, result);
  if (!result.passed) {
    await taskService.updateTask(taskId, { failure_class: 'verification_reject' });
  }

  // Emit correct event based on verification outcome
  const eventType = result.passed ? 'task_completed' : 'task_failed';
  await eventService.emit(task.company_id, eventType, {
    task_id: taskId,
    title: task.title,
    verification_level: result.level,
    verification_passed: result.passed,
    checks_total: result.checks.length,
    checks_passed: result.checks.filter((c) => c.passed).length,
  });

  return result;
}
