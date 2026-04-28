// Verification Service — 5-level task verification (SPEC-CTRL-106)
// The verifier is the SOLE AUTHORITY for setting final task status.
// Worker is NOT the final authority — verifier sets completed or failed.
// Levels: none, deterministic, browser_flow, quality_review, hybrid

import type { Task, VerificationLevel } from '@/types';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { db, reports, companies, taskExecutions } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';

// Tools that CONSTITUTE shipping CODE somewhere a customer can hit. If a
// task tag implies it should produce a running app, at least one of these
// must appear in the execution_log — otherwise the agent's running but
// nothing is live. queryforge campaign-generator failure (2026-04-25,
// task 9a36e013-…) had ZERO of these calls in 20 turns; agent created DB
// tables via run_migration and stopped.
//
// run_migration is INTENTIONALLY EXCLUDED — schema migrations alone don't
// constitute "the feature shipped". For pure-DB tasks (tag='database',
// 'migration', 'sql'), use a different evidence path.
const DEPLOY_TOOL_NAMES = new Set([
  'cf_deploy_app',
  'cf_deploy_landing',
  'github_push_file',          // Render deploy-from-repo path
  'github_create_commit',
  'render_create_service',
  'render_deploy',
  'deploy_to_render',
]);

// Schema-only tools — sufficient evidence for DB-shaped tasks but NOT for
// feature/engineering tasks (which need both schema AND code).
const SCHEMA_DEPLOY_TOOLS = new Set(['run_migration']);

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
  'bug-fix',
  'fix',
]);

/** Read execution_log from the latest execution for this task and return
 *  the names of every tool the agent called. Empty array on error. */
async function getExecutionToolCalls(taskId: string): Promise<string[]> {
  try {
    const [exec] = await db
      .select({ execution_log: taskExecutions.execution_log })
      .from(taskExecutions)
      .where(eq(taskExecutions.task_id, taskId))
      .orderBy(desc(taskExecutions.created_at))
      .limit(1);

    if (!exec?.execution_log) return [];

    let log: Array<{ tool?: string }> = [];
    if (typeof exec.execution_log === 'string') {
      try { log = JSON.parse(exec.execution_log); } catch { return []; }
    } else if (Array.isArray(exec.execution_log)) {
      log = exec.execution_log as Array<{ tool?: string }>;
    }

    return log.map((e) => e.tool ?? '').filter(Boolean);
  } catch {
    return [];
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
  if (['landing-page', 'dashboard', 'form', 'css', 'onboarding', 'settings', 'pricing-page'].includes(tag)) {
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
  const advisoryNames = new Set<string>(['has_report']);

  // Check 1 (HARD REQUIREMENT for deploy-shaped tags): The agent must have
  // called a DEPLOY tool. queryforge campaign-generator (task 9a36e013-…)
  // had ZERO deploy calls in 20 turns and still got rubber-stamped before
  // this check existed.
  const tagNormalized = task.tag.toLowerCase().trim();
  const requiresDeploy = DEPLOY_REQUIRED_TAGS.has(tagNormalized);
  if (requiresDeploy) {
    const toolCalls = await getExecutionToolCalls(task.id);
    const deployCalls = toolCalls.filter((t) => DEPLOY_TOOL_NAMES.has(t));
    checks.push({
      name: 'deploy_evidence',
      passed: deployCalls.length > 0,
      detail: deployCalls.length > 0
        ? `${deployCalls.length} deploy tool call(s): ${[...new Set(deployCalls)].join(', ')}`
        : `Tag "${task.tag}" requires a deploy but agent never called a deploy tool. Tools used: ${[...new Set(toolCalls)].slice(0, 8).join(', ') || 'none'}`,
    });
  }

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
  const hardFailures = checks.filter((c) => !c.passed && !advisoryNames.has(c.name));
  const passed = hardFailures.length === 0;
  const advisoryFailures = checks.filter((c) => !c.passed && advisoryNames.has(c.name));

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
      : `${hardFailures.length} hard check(s) failed: ${hardFailures.map((c) => c.name).join(', ')}.`,
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
          const isErrorPage = /error|not found|500|502|503|default page/i.test(html.slice(0, 2000));

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

  const passed = browserChecks.every((c) => c.passed);

  return {
    level: 'browser_flow',
    passed,
    checks: browserChecks,
    evidence: { ...deterministicResult.evidence },
    summary: passed
      ? `Browser flow verification passed (${browserChecks.length} checks).`
      : `Some browser checks failed.`,
  };
}

// ══════════════════════════════════════════════
// LEVEL 3: QUALITY REVIEW — content/output check
// ══════════════════════════════════════════════

async function verifyQualityReview(task: Task): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];

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

    // Quality: minimum word count
    checks.push({
      name: 'minimum_content',
      passed: wordCount >= 100,
      detail: `Report has ${wordCount} words (min: 100)`,
    });

    // Quality: has structure (headers)
    const hasHeaders = content.includes('#') || content.includes('##');
    checks.push({
      name: 'has_structure',
      passed: hasHeaders,
      detail: hasHeaders ? 'Report has markdown headers' : 'Report lacks structure (no headers)',
    });

    // Quality: has actionable items
    const hasActions = /recommend|suggest|should|action|next step/i.test(content);
    checks.push({
      name: 'has_recommendations',
      passed: hasActions,
      detail: hasActions ? 'Contains actionable recommendations' : 'Missing actionable recommendations',
    });
  }

  const passed = checks.every((c) => c.passed);

  return {
    level: 'quality_review',
    passed,
    checks,
    evidence: { report_word_count: reportRows[0]?.content?.split(/\s+/).length ?? 0 },
    summary: passed
      ? `Quality review passed (${checks.length} checks).`
      : `Quality issues found: ${checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
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

  const passed = allChecks.every((c) => c.passed);
  const failedCount = allChecks.filter((c) => !c.passed).length;

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
      : `${failedCount} check(s) failed across deterministic, browser, and quality levels.`,
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
