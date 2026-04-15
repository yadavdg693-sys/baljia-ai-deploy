// Verification Service — 5-level task verification (SPEC-CTRL-106)
// The verifier is the SOLE AUTHORITY for setting final task status.
// Worker is NOT the final authority — verifier sets completed or failed.
// Levels: none, deterministic, browser_flow, quality_review, hybrid

import type { Task, VerificationLevel } from '@/types';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { db, reports, companies } from '@/lib/db';
import { eq } from 'drizzle-orm';

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

  // Deterministic checks — DB/API tasks
  if (['api', 'crud', 'database', 'webhook', 'cron', 'auth'].includes(tag)) {
    return 'deterministic';
  }

  // Browser flow — UI/frontend tasks
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

  // Check 1: Task has a report
  const reportRows = await db.select({ id: reports.id, title: reports.title })
    .from(reports).where(eq(reports.task_id, task.id));

  checks.push({
    name: 'has_report',
    passed: reportRows.length > 0,
    detail: reportRows.length ? `Found ${reportRows.length} report(s)` : 'No execution report created',
  });

  // Check 2: Task completed within time limit
  if (task.started_at && task.completed_at) {
    const duration = new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
    const maxMs = 4 * 60 * 60 * 1000; // 4 hours
    checks.push({
      name: 'within_time_limit',
      passed: duration <= maxMs,
      detail: `Duration: ${Math.round(duration / 60000)} minutes`,
    });
  }

  // Check 3: Turn count within limits
  checks.push({
    name: 'within_turn_limit',
    passed: task.turn_count <= task.max_turns,
    detail: `Turns: ${task.turn_count}/${task.max_turns}`,
  });

  // Check 4: No error in execution
  checks.push({
    name: 'no_failure',
    passed: task.failure_class === null,
    detail: task.failure_class ? `Failure: ${task.failure_class}` : 'No failures detected',
  });

  const passed = checks.every((c) => c.passed);

  return {
    level: 'deterministic',
    passed,
    checks,
    evidence: { report_count: reportRows.length },
    summary: passed
      ? `All ${checks.length} deterministic checks passed.`
      : `${checks.filter((c) => !c.passed).length}/${checks.length} checks failed.`,
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
    const domain = company.custom_domain ?? `${company.subdomain}.baljia.com`;
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
