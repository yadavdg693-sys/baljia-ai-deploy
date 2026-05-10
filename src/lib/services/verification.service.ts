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

// Tools that constitute shipping code to the founder app runtime.
// Engineering apps now deploy to Render. GitHub writes are necessary, but are
// not enough: code in a repo is not a live app.
const DEPLOY_TOOL_NAMES = new Set([
  'render_create_service',
  'render_deploy',
  'deploy_to_render',
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
const STATIC_SCAN_TOOL_NAMES = new Set(['static_code_scan']);
const STATIC_SCAN_SUCCESS_RE = /^STATIC SCAN PASS\b|high=0\b/m;
const CODE_REVIEW_TOOL_NAMES = new Set(['review_pushed_code']);
const CODE_REVIEW_SUCCESS_RE = /^CODE REVIEW PASS\b|high=0\b|^CODE REVIEW SKIPPED\b/m;

const SCHEMA_DEPLOY_TOOLS = new Set(['run_migration']);
const REQUESTED_ROUTE_LIMIT = 5;

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
 *  every tool call the agent made. Empty array on error. */
async function getExecutionToolCalls(taskId: string): Promise<Array<{
  tool: string;
  result: string;
  event?: string;
}>> {
  try {
    const [exec] = await db
      .select({ execution_log: taskExecutions.execution_log })
      .from(taskExecutions)
      .where(eq(taskExecutions.task_id, taskId))
      .orderBy(desc(taskExecutions.created_at))
      .limit(1);

    if (!exec?.execution_log) return [];

    let log: Array<{ tool?: string; result?: unknown; event?: unknown }> = [];
    if (typeof exec.execution_log === 'string') {
      try { log = JSON.parse(exec.execution_log); } catch { return []; }
    } else if (Array.isArray(exec.execution_log)) {
      log = exec.execution_log as Array<{ tool?: string; result?: unknown; event?: unknown }>;
    }

    return log
      .map((e) => ({
        tool: e.tool ?? '',
        result: typeof e.result === 'string' ? e.result : '',
        event: typeof e.event === 'string' ? e.event : undefined,
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
  if (!c.render_service_id) return null;

  const token = process.env.RENDER_API_KEY;
  if (!token) return null;
  try {
    const r = await fetch(`${RENDER_API}/services/${c.render_service_id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const data = await r.json() as { service?: { serviceDetails?: { url?: string } }; serviceDetails?: { url?: string } };
    const url = data.service?.serviceDetails?.url ?? data.serviceDetails?.url ?? '';
    return url || null;
  } catch {
    return null;
  }
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

function hardFailures(checks: VerificationCheck[]): VerificationCheck[] {
  return checks.filter((c) => !c.passed && !ADVISORY_CHECK_NAMES.has(c.name));
}

function normalizeRequestedPath(path: string): string | null {
  const cleaned = path.trim().replace(/[),.;!?]+$/g, '');
  if (!cleaned.startsWith('/') || cleaned.startsWith('//') || cleaned === '/') return null;
  if (cleaned.length > 180) return null;
  return cleaned;
}

export function extractRequestedBrowserPaths(
  task: Pick<Task, 'title' | 'description'>,
  domain?: string,
): string[] {
  const text = `${task.title}\n${task.description ?? ''}`;
  const paths = new Set<string>();

  for (const match of text.matchAll(/https?:\/\/[^\s"'<>`]+/gi)) {
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

async function verifyRequestedRoute(domain: string, path: string): Promise<VerificationCheck> {
  try {
    const response = await fetch(`https://${domain}${path}`, {
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
        ? `${domain}${path} returned ${response.status} with ${body.length} bytes.`
        : `${domain}${path} returned ${response.status}; bytes=${body.length}; errorPage=${htmlErrorPage}.`,
    };
  } catch (error) {
    return {
      name: `requested_route:${path}`,
      passed: false,
      detail: `Could not reach ${domain}${path}: ${error instanceof Error ? error.message : 'timeout'}`,
    };
  }
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

    // Stricter than before: previously we passed if ANY check_url_health
    // returned 2xx, so an agent that probed /, /register, /login (all 200)
    // and /api/health (500) would still pass. Now ALL attempted health
    // checks must succeed — a failed probe is a real signal the deploy is
    // partially broken even if the landing happens to be up.
    const healthAttempts = toolCalls.filter((t) => HEALTH_TOOL_NAMES.has(t.tool));
    const healthSuccesses = healthAttempts.filter(isSuccessfulHealthCall);
    const failedHealthCalls = healthAttempts.filter((t) => !isSuccessfulHealthCall(t));
    const allHealthPassed = healthAttempts.length > 0 && failedHealthCalls.length === 0;
    checks.push({
      name: 'render_health_evidence',
      passed: allHealthPassed,
      detail: healthAttempts.length === 0
        ? `Render deploy-shaped task must call check_url_health after deploy. Health attempts: none.`
        : allHealthPassed
          ? `${healthSuccesses.length} health check(s), all passed.`
          : `${failedHealthCalls.length} of ${healthAttempts.length} check_url_health call(s) failed (e.g. ${failedHealthCalls[0].result.slice(0, 120)}). A partially-broken deploy is still broken — fix and redeploy before declaring complete.`,
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

    // ADVISORY (does NOT fail the task): if the agent ran any DB-write
    // operations as part of the journey, it should have followed up with at
    // least one verify_db_state call to confirm the rows actually landed.
    // Not every deploy needs DB checks (static sites, marketing pages), so
    // this is encouraged but not required.
    const dbStateCalls = toolCalls.filter(isSuccessfulDbStateCall);
    const attemptedDbStateCalls = toolCalls
      .filter((t) => DB_STATE_TOOL_NAMES.has(t.tool))
      .map((t) => t.tool);
    checks.push({
      name: 'db_state_evidence',
      passed: dbStateCalls.length > 0,
      detail: dbStateCalls.length > 0
        ? `${dbStateCalls.length} passing DB-state assertion(s) — side-effects confirmed.`
        : `Advisory: no verify_db_state calls. If your app writes to the DB, follow up the journey with a SELECT-based assertion to catch lying redirects. Attempts: ${attemptedDbStateCalls.length ? attemptedDbStateCalls.join(', ') : 'none'}.`,
    });

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
    checks.push({
      name: 'static_code_scan',
      passed: !codeWasPushed
        ? true
        : staticScanAttempts.length > 0 && cleanStaticScans.length === staticScanAttempts.length,
      detail: !codeWasPushed
        ? `No new code pushed in this task — static scan not required.`
        : staticScanAttempts.length === 0
          ? `Code was pushed but no static_code_scan call. The scanner catches silent-catch blocks, secret-in-log, template-SQL, missing trust-proxy — issues runtime journey verification cannot see. Run static_code_scan after every github_create_commit.`
          : cleanStaticScans.length === staticScanAttempts.length
            ? `${cleanStaticScans.length} static scan(s) clean.`
            : `${staticScanAttempts.length - cleanStaticScans.length} of ${staticScanAttempts.length} static scan(s) found high-severity findings. Address them via github_create_commit before declaring complete.`,
    });

    // ADVISORY: LLM code review — semantic check over the diff. Catches
    // bugs static patterns can't (auth bypass, race conditions, business
    // logic mistakes). Costs one Haiku call per build; agent should
    // address high-severity findings before deploy.
    const reviewAttempts = toolCalls.filter((t) => CODE_REVIEW_TOOL_NAMES.has(t.tool));
    const cleanReviews = reviewAttempts.filter(isCleanCodeReviewCall);
    checks.push({
      name: 'llm_code_review',
      passed: reviewAttempts.length > 0 && cleanReviews.length === reviewAttempts.length,
      detail: reviewAttempts.length === 0
        ? `Advisory: no review_pushed_code calls. An LLM diff review catches semantic bugs runtime verification can't see — auth bypass, race conditions, missing input validation. One Haiku call per build (~$0.01-0.05).`
        : cleanReviews.length === reviewAttempts.length
          ? `${cleanReviews.length} code review(s) clean.`
          : `${reviewAttempts.length - cleanReviews.length} of ${reviewAttempts.length} code review(s) flagged high-severity issues. Address before declaring complete.`,
    });

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
  checks.push({
    name: 'no_failure',
    passed: task.failure_class === null,
    detail: task.failure_class ? `Failure: ${task.failure_class}` : 'No failures detected',
  });

  // Pass = no HARD check failed. Advisory checks can fail without blocking.
  const failedHardChecks = hardFailures(checks);
  const passed = failedHardChecks.length === 0;
  const advisoryFailures = checks.filter((c) => !c.passed && ADVISORY_CHECK_NAMES.has(c.name));

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

  const browserChecks: VerificationCheck[] = [...deterministicResult.checks];

  // Browser check: deployed URL is accessible
  // NOTE: Requires company to have render_service_id or custom_domain set
  const [company] = await db.select({
    subdomain: companies.subdomain, custom_domain: companies.custom_domain,
    render_service_id: companies.render_service_id,
  }).from(companies).where(eq(companies.id, task.company_id)).limit(1);

  if (company?.subdomain || company?.custom_domain) {
    // Founder apps live on *.baljia.app per ADR-002. Fallback domain bug
    // (previously .baljia.com) caused every engineering-agent deploy task to
    // fail verification via HEAD request to a non-existent domain. Fixed
    // 2026-04-24. See AUDIT_FINDINGS.md (A5) and test-pagegenie agent run.
    const domain = company.custom_domain ?? `${company.subdomain}.baljia.app`;
    try {
      const response = await fetch(`https://${domain}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });
      browserChecks.push({
        name: 'site_accessible',
        passed: response.ok,
        detail: `${domain} returned ${response.status}`,
      });

      // Enhanced: GET request to verify page has real content (not just 200 OK)
      if (response.ok) {
        try {
          const getRes = await fetch(`https://${domain}`, {
            method: 'GET',
            signal: AbortSignal.timeout(15000),
          });
          const html = await getRes.text();
          const hasBody = html.includes('<body');
          const hasContent = html.length > 500;
          const isErrorPage = isLikelyErrorHtml(html);

          browserChecks.push({
            name: 'page_has_content',
            passed: hasBody && hasContent && !isErrorPage,
            detail: hasBody && hasContent && !isErrorPage
              ? `Page has ${html.length} bytes with valid body content.`
              : `Page issue: body=${hasBody}, size=${html.length}, errorPage=${isErrorPage}`,
          });
        } catch {
          browserChecks.push({
            name: 'page_has_content',
            passed: false,
            detail: 'GET request to verify page content failed.',
          });
        }
      }

      const requestedPaths = extractRequestedBrowserPaths(task, domain);
      for (const path of requestedPaths) {
        browserChecks.push(await verifyRequestedRoute(domain, path));
      }
    } catch (error) {
      browserChecks.push({
        name: 'site_accessible',
        passed: false,
        detail: `Could not reach ${domain}: ${error instanceof Error ? error.message : 'timeout'}`,
      });
    }
  } else {
    browserChecks.push({
      name: 'site_accessible',
      passed: true, // Skip if no deployment
      detail: 'No deployment URL configured — skipping browser verification.',
    });
  }

  const failedHardChecks = hardFailures(browserChecks);
  const passed = failedHardChecks.length === 0;

  return {
    level: 'browser_flow',
    passed,
    checks: browserChecks,
    evidence: {
      ...deterministicResult.evidence,
      requested_paths: company?.subdomain || company?.custom_domain
        ? extractRequestedBrowserPaths(task, company.custom_domain ?? `${company.subdomain}.baljia.app`)
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

  const failedHardChecks = hardFailures(allChecks);
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
