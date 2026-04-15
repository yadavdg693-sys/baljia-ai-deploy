// Night Shift Engine — migrated to Drizzle + Neon
import * as taskService from '@/lib/services/task.service';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import * as roadmapService from '@/lib/services/roadmap.service';
import * as failureService from '@/lib/services/failure.service';
import { evaluateStage } from '@/lib/services/stage.service';
import { sendNightShiftSummaryEmail } from '@/lib/services/email.service';
import { processQueue } from '@/lib/agents/worker-launcher';
import { db, txDb, companies, nightShiftCycles, users, tasks as tasksTable } from '@/lib/db';
import { eq, isNotNull, or, and, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { CompanyStage, NightShiftCycle } from '@/types';

const log = createLogger('NightShift');

const STAGE_OBJECTIVES: Record<CompanyStage, string> = {
  early: 'What is obviously missing?',
  validation: 'What blocks activation?',
  monetization: 'What blocks conversion?',
  retention: 'What is underused or churn-inducing?',
  scale: 'What channel is underperforming?',
  compounding: 'What can be automated or defended?',
};

// ══════════════════════════════════════════════
// STAGE-AWARE GAP ANALYSIS (SPEC-CTRL-103)
// Night shift picks the strongest gap between ideal
// stage progression and current state.
// ══════════════════════════════════════════════

interface StageGap {
  dimension: string;
  currentState: boolean;
  gapStrength: number;  // 0-100, higher = more urgent
  suggestedTag: string;
  suggestedTitle: string;
}

/** What the NEXT stage requires that the current stage may not have */
const NEXT_STAGE_REQUIREMENTS: Record<CompanyStage, Array<{
  dimension: string;
  evidenceKey: string;
  gapStrength: number;
  suggestedTag: string;
  suggestedTitle: string;
}>> = {
  early: [
    { dimension: 'website', evidenceKey: 'has_website', gapStrength: 95, suggestedTag: 'landing-page', suggestedTitle: 'Build and deploy landing page' },
    { dimension: 'seo', evidenceKey: 'has_website', gapStrength: 70, suggestedTag: 'seo', suggestedTitle: 'Set up SEO: meta tags, OG image, sitemap' },
  ],
  validation: [
    { dimension: 'payments', evidenceKey: 'has_paid', gapStrength: 90, suggestedTag: 'billing', suggestedTitle: 'Set up Stripe payments and pricing page' },
    { dimension: 'marketing', evidenceKey: 'has_marketing', gapStrength: 85, suggestedTag: 'tweet', suggestedTitle: 'Start social media presence' },
    { dimension: 'outreach', evidenceKey: 'has_outreach', gapStrength: 80, suggestedTag: 'outreach', suggestedTitle: 'Launch initial cold outreach campaign' },
  ],
  monetization: [
    { dimension: 'recurring_revenue', evidenceKey: 'has_paid', gapStrength: 90, suggestedTag: 'billing', suggestedTitle: 'Set up subscription billing for recurring revenue' },
    { dimension: 'customer_comms', evidenceKey: 'has_outreach', gapStrength: 85, suggestedTag: 'email-template', suggestedTitle: 'Create branded email templates for customer communication' },
  ],
  retention: [
    { dimension: 'multi_channel', evidenceKey: 'has_marketing', gapStrength: 85, suggestedTag: 'meta-ads', suggestedTitle: 'Set up Meta Ads campaign for second marketing channel' },
    { dimension: 'analytics', evidenceKey: 'has_marketing', gapStrength: 75, suggestedTag: 'analytics', suggestedTitle: 'Build analytics dashboard for user behavior tracking' },
  ],
  scale: [
    { dimension: 'automation', evidenceKey: 'has_marketing', gapStrength: 80, suggestedTag: 'automation', suggestedTitle: 'Automate lead nurturing sequence' },
    { dimension: 'optimization', evidenceKey: 'has_marketing', gapStrength: 70, suggestedTag: 'performance', suggestedTitle: 'Performance optimization: query caching and CDN' },
  ],
  compounding: [
    // At compounding, focus on defending and automating — no hard gaps
    { dimension: 'defense', evidenceKey: 'has_marketing', gapStrength: 60, suggestedTag: 'security', suggestedTitle: 'Security hardening: rate limits, XSS protection, audit log' },
  ],
};

/**
 * Analyze gaps between current company state and next stage requirements.
 * Returns gaps sorted by strength (highest first).
 * Reuses evaluateStage() from stage.service.ts for evidence.
 */
async function analyzeStageGaps(companyId: string, stage: CompanyStage): Promise<StageGap[]> {
  const { evidence } = await evaluateStage(companyId);
  const requirements = NEXT_STAGE_REQUIREMENTS[stage] ?? [];

  const gaps: StageGap[] = [];
  for (const req of requirements) {
    const hasIt = !!(evidence as Record<string, unknown>)[req.evidenceKey];
    if (!hasIt) {
      gaps.push({
        dimension: req.dimension,
        currentState: false,
        gapStrength: req.gapStrength,
        suggestedTag: req.suggestedTag,
        suggestedTitle: req.suggestedTitle,
      });
    }
  }

  // Sort by gap strength descending
  return gaps.sort((a, b) => b.gapStrength - a.gapStrength);
}

// ══════════════════════════════════════════════
// HEALTH PROBE — automatic URL health check
// ══════════════════════════════════════════════

/**
 * Probes the deployed URL for one company.
 * If down, creates a priority Engineering fix task.
 * Returns a summary line for the night shift report.
 */
async function probeCompanyHealth(companyId: string, liveUrl: string): Promise<string | null> {
  try {
    const start = Date.now();
    const response = await fetch(liveUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Baljia/1.0 night-shift-health' },
    });
    const elapsed = Date.now() - start;

    if (response.ok) {
      log.debug('Health probe OK', { companyId, liveUrl, status: response.status, elapsed });
      return null; // healthy — nothing to report
    }

    // Non-2xx: app is up but returning errors
    const msg = `HTTP ${response.status} in ${elapsed}ms`;
    log.warn('Health probe non-2xx', { companyId, liveUrl, status: response.status });
    
    const title = `[URGENT] App returning errors: ${liveUrl}`;
    const [existing] = await db.select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(eq(tasksTable.company_id, companyId), eq(tasksTable.title, title), or(eq(tasksTable.status, 'todo'), eq(tasksTable.status, 'in_progress'))))
      .limit(1);

    if (!existing) {
      await db.insert(tasksTable).values({
        company_id: companyId,
        title,
        description: `Night Shift health probe detected an issue:\n- URL: ${liveUrl}\n- Response: ${msg}\n\nCheck render_get_logs for the error, fix and redeploy. This is affecting live users.`,
        tag: 'bug-fix',
        priority: 95,
        source: 'auto_remediation',
        status: 'todo',
        queue_order: 0,
        estimated_credits: 2,
        max_turns: 200,
        executability_type: 'can_run_now',
      });
      return `⚠️ ${liveUrl} returned ${msg} — fix task created`;
    }
    return `⚠️ ${liveUrl} returned ${msg} — fix task already queued`;
  } catch (err) {
    // Connection refused / timeout / DNS failure = app is DOWN
    const reason = err instanceof Error ? err.message : 'Unknown';
    log.error('Health probe DOWN', { companyId, liveUrl, reason });

    const title = `[URGENT] App is DOWN: ${liveUrl}`;
    const [existing] = await db.select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(eq(tasksTable.company_id, companyId), eq(tasksTable.title, title), or(eq(tasksTable.status, 'todo'), eq(tasksTable.status, 'in_progress'))))
      .limit(1);

    if (!existing) {
      await db.insert(tasksTable).values({
        company_id: companyId,
        title,
        description: `Night Shift health probe could not reach the app:\n- URL: ${liveUrl}\n- Error: ${reason}\n\nCheck Render service status, review render_get_logs, and redeploy. If deploy is broken, use render_rollback.`,
        tag: 'bug-fix',
        priority: 99,
        source: 'auto_remediation',
        status: 'todo',
        queue_order: 0,
        estimated_credits: 2,
        max_turns: 200,
        executability_type: 'can_run_now',
      });
      return `❌ ${liveUrl} is DOWN (${reason}) — urgent fix task created`;
    }
    return `❌ ${liveUrl} is DOWN (${reason}) — urgent fix task already queued`;
  }
}

/**
 * Run health probes for all active companies that have a deployed URL.
 * Returns health alert lines to include in the night shift summary.
 */
async function runHealthProbes(companyId: string): Promise<string[]> {
  try {
    const [company] = await db.select({
      custom_domain: companies.custom_domain,
      slug: companies.slug,
      render_service_id: companies.render_service_id,
    }).from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) return [];

    // Determine live URL: prefer custom domain, fallback to slug subdomain
    const liveUrl = company.custom_domain
      ? `https://${company.custom_domain}`
      : company.render_service_id && company.slug
      ? `https://${company.slug}.baljia.app`
      : null;

    if (!liveUrl) return []; // no deployment yet — skip

    const alert = await probeCompanyHealth(companyId, liveUrl);
    return alert ? [alert] : [];
  } catch (err) {
    log.warn('Health probe phase failed', { companyId, error: err instanceof Error ? err.message : 'Unknown' });
    return [];
  }
}

interface AdmissibilityResult { admissible: boolean; reason: string; }

function checkAdmissibility(taskTag: string, taskTitle: string): AdmissibilityResult {
  const autoAdmissible = ['seo', 'seo-meta', 'analytics', 'tracking', 'bug-fix', 'fix', 'css', 'favicon', 'error-page', 'monitoring'];
  if (autoAdmissible.includes(taskTag.toLowerCase())) return { admissible: true, reason: 'Auto-admissible: routine improvement/fix' };

  const requiresApproval = ['billing', 'payment', 'deploy', 'delete', 'migration', 'pricing', 'pricing-page', 'auth', 'integration'];
  if (requiresApproval.includes(taskTag.toLowerCase())) return { admissible: false, reason: 'Requires founder approval: potential destructive/financial impact' };

  const looksSimple = taskTitle.length < 100;
  return { admissible: looksSimple, reason: looksSimple ? 'Auto-admissible: appears straightforward' : 'Flagged for review: complex description may need founder input' };
}

interface NightShiftPlan {
  companyId: string; stage: CompanyStage; objective: string;
  tasks_to_execute: string[]; tasks_to_create: Array<{ title: string; tag: string; description: string }>;
  skipped_reasons: string[];
}

async function planNightShift(companyId: string): Promise<NightShiftPlan> {
  const [company] = await db.select({ company_stage: companies.company_stage, lifecycle: companies.lifecycle })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  const stage = (company?.company_stage ?? 'early') as CompanyStage;
  const objective = STAGE_OBJECTIVES[stage];

  const tasks = await taskService.getTasks(companyId);
  const todoTasks = tasks.filter((t) => t.status === 'todo');
  const failedTasks = tasks.filter((t) => t.status === 'failed');

  const plan: NightShiftPlan = { companyId, stage, objective, tasks_to_execute: [], tasks_to_create: [], skipped_reasons: [] };

  // Build a set of titles already pending/active — used for duplicate retry guard
  const activeTitles = new Set(
    tasks
      .filter((t) => ['todo', 'in_progress', 'failed'].includes(t.status ?? ''))
      .map((t) => t.title.toLowerCase())
  );

  for (const failed of failedTasks.slice(0, 3)) {
    const retryTitle = `[Retry] ${failed.title}`;

    // DUPLICATE GUARD: skip if a retry task for this title already exists in queue
    if (activeTitles.has(retryTitle.toLowerCase())) {
      plan.skipped_reasons.push(`Skipped retry of "${failed.title}": a retry task already exists in queue`);
      continue;
    }

    const a = checkAdmissibility(failed.tag, failed.title);
    if (a.admissible) {
      // Enrich retry with actual failure class and original description for better agent context
      const failureContext = [
        failed.failure_class ? `Failure class: ${failed.failure_class}` : null,
        failed.description ? `Original task: ${failed.description.substring(0, 300)}` : null,
      ].filter(Boolean).join('\n');

      plan.tasks_to_create.push({
        title: retryTitle,
        tag: failed.tag,
        description: `Auto-retry of a previously failed task.\n${failureContext}\n\nReview the failure reason above and attempt a corrected approach.`,
      });
    } else {
      plan.skipped_reasons.push(`Skipped retry of "${failed.title}": ${a.reason}`);
    }
  }

  for (const todo of todoTasks) {
    const a = checkAdmissibility(todo.tag, todo.title);
    if (a.admissible) plan.tasks_to_execute.push(todo.id);
    else plan.skipped_reasons.push(`Skipped "${todo.title}": ${a.reason}`);
  }

  // 2B-4: Roadmap-guided task suggestions
  // If the current milestone has suggested tags, create tasks for unstarted tags
  try {
    const milestoneCtx = await roadmapService.getCurrentMilestoneTags(companyId);
    if (milestoneCtx.tags.length > 0 && milestoneCtx.hint) {
      const existingTags = new Set(tasks.map((t) => t.tag.toLowerCase()));
      const missingTags = milestoneCtx.tags.filter((tag) => !existingTags.has(tag.toLowerCase()));

      for (const tag of missingTags.slice(0, 2)) {
        const a = checkAdmissibility(tag, milestoneCtx.hint);
        if (a.admissible) {
          plan.tasks_to_create.push({
            title: `[Roadmap] ${milestoneCtx.milestoneTitle}: ${tag}`,
            tag,
            description: `Auto-generated from roadmap milestone "${milestoneCtx.milestoneTitle}". ${milestoneCtx.hint}`,
          });
        }
      }
    }
  } catch { /* roadmap may not exist yet */ }

  // SPEC-CTRL-103: Stage-aware gap analysis — prioritize strongest gaps
  try {
    const gaps = await analyzeStageGaps(companyId, stage);
    const existingTags = new Set(tasks.map((t) => t.tag.toLowerCase()));

    for (const gap of gaps.slice(0, 2)) {
      // Skip if a task with this tag already exists
      if (existingTags.has(gap.suggestedTag.toLowerCase())) continue;
      // Skip if title already in queue
      if (activeTitles.has(gap.suggestedTitle.toLowerCase())) continue;

      const a = checkAdmissibility(gap.suggestedTag, gap.suggestedTitle);
      if (a.admissible) {
        plan.tasks_to_create.push({
          title: `[Gap] ${gap.suggestedTitle}`,
          tag: gap.suggestedTag,
          description: `Auto-generated from stage gap analysis. Stage: ${stage}. Gap: ${gap.dimension} (strength: ${gap.gapStrength}/100). This is the strongest gap blocking progression to the next stage.`,
        });
      } else {
        plan.skipped_reasons.push(`Gap "${gap.dimension}" requires founder approval: ${a.reason}`);
      }
    }
  } catch (err) {
    log.warn('Gap analysis failed, continuing without', { companyId, error: err instanceof Error ? err.message : 'Unknown' });
  }

  // Failure feedback loop — inject regression context into night-shift planning
  // Spec: Domain 12.3 "6-step failure learning: capture → fingerprint → inject → monitor → feedback"
  try {
    const recentFailures = await failureService.getRecentFailures(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    );

    // Regression-sensitive fingerprints with high occurrence = proactive remediation task
    const regressionRisk = recentFailures.filter(
      (f) => f.regression_sensitive && (f.occurrence_count ?? 0) >= 3 && f.fix_status === 'open'
    );

    for (const fp of regressionRisk.slice(0, 1)) {
      plan.tasks_to_create.push({
        title: `[Regression Guard] Fix recurring issue: ${fp.category}`,
        tag: 'bug-fix',
        description: `Known regression-sensitive failure (${fp.occurrence_count} occurrences): ${fp.description}. Category: ${fp.category}. Fingerprint ID: ${fp.id}.`,
      });
    }

    // Enrich retry task descriptions with known-issue context
    plan.tasks_to_create = plan.tasks_to_create.map((t) => {
      const matchingFp = recentFailures.find((f) =>
        t.tag && f.category && t.tag.toLowerCase().includes(f.category.toLowerCase())
      );
      if (matchingFp && t.title.startsWith('[Retry]')) {
        return {
          ...t,
          description: `${t.description}\n\n[Known Issue Context] ${matchingFp.description} (seen ${matchingFp.occurrence_count ?? 1}x, status: ${matchingFp.fix_status})`,
        };
      }
      return t;
    });
  } catch { /* failure service unavailable — continue without context */ }

  return plan;
}

async function executeNightShift(plan: NightShiftPlan): Promise<{ completed: number; failed: number }> {
  let completed = 0; let failed = 0;
  const balance = await creditService.getBalance(plan.companyId);

  // Bug #4 fix: track committed credits across BOTH task creation and execution.
  // Creating a task reserves a credit slot (it will be consumed when executed).
  // Without this, balance checks allow n tasks to be created against balance=1.
  let creditsCommitted = 0;

  for (const newTask of plan.tasks_to_create) {
    if (balance - creditsCommitted <= 0) { log.warn('Out of credits for new tasks', { companyId: plan.companyId }); break; }
    try {
      await taskService.createTask({ company_id: plan.companyId, title: newTask.title, tag: newTask.tag, description: newTask.description, priority: 80, source: 'night_shift_generated', status: 'todo', queue_order: 1, estimated_credits: 1, max_turns: 200, executability_type: 'can_run_now', authorized_by: 'night_shift', authorization_reason: `Night shift auto-created: stage=${plan.stage}, objective=${plan.objective}` });
      creditsCommitted++; // Count creation as a committed credit slot
    } catch (error) { log.error('Failed to create retry task', { title: newTask.title }, error); }
  }

  const maxTasks = Math.min(plan.tasks_to_execute.length, balance - creditsCommitted, 5);
  for (let i = 0; i < maxTasks; i++) {
    try { const processed = await processQueue(plan.companyId); if (processed > 0) { completed++; creditsCommitted++; } else break; }
    catch (error) { log.error('Task execution failed', { companyId: plan.companyId }, error); failed++; }
  }

  return { completed, failed };
}

function generateSummary(
  plan: NightShiftPlan,
  results: { completed: number; failed: number },
  healthAlerts: string[] = [],
): string {
  const lines = [
    `## Night Shift Report`,
    `**Stage:** ${plan.stage} | **Objective:** ${plan.objective}`,
    '',
    `### Results`,
    `- Tasks completed: ${results.completed}`,
    `- Tasks failed: ${results.failed}`,
    `- Retry tasks created: ${plan.tasks_to_create.length}`,
  ];

  if (healthAlerts.length > 0) {
    lines.push('', '### 🚨 Health Alerts (auto-fix tasks created)');
    for (const alert of healthAlerts) lines.push(`- ${alert}`);
  }

  if (plan.skipped_reasons.length > 0) {
    lines.push('', '### Skipped (needs your approval)');
    for (const r of plan.skipped_reasons) lines.push(`- ${r}`);
  }

  return lines.join('\n');
}

export async function runNightShift(companyId: string): Promise<NightShiftCycle> {
  log.info('Starting night shift', { companyId });

  const [company] = await db.select({ lifecycle: companies.lifecycle, execution_state: companies.execution_state })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  // Audit #5: Only trial_active and full_active get night shifts.
  // keep_live_active is post-cancellation grace — no new execution.
  const activeLifecycles = ['trial_active', 'full_active'];
  const mkSkipped = (reason: string) => ({ id: crypto.randomUUID(), company_id: companyId, cycle_number: null, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), planned_tasks: null, executed_tasks: null, summary: reason, company_stage: 'early', trust_score: null, created_at: new Date().toISOString() }) as NightShiftCycle;

  if (!company || !activeLifecycles.includes(company.lifecycle ?? '')) return mkSkipped(`Night shift skipped: lifecycle is ${company?.lifecycle ?? 'unknown'}`);
  if (company.execution_state === 'suspended') return mkSkipped('Night shift skipped: execution suspended');

  // SPEC-CTRL-001: One-slot concurrency — use advisory lock to prevent TOCTOU race
  // between slot check and task claim. Night shift and manual execution share one slot.
  let slotAcquired = false;
  try {
    // pg_try_advisory_lock returns true if lock acquired, false if already held.
    // hashtext gives a stable int for the company UUID.
    const lockResult = await txDb.execute(sql`SELECT pg_try_advisory_lock(hashtext(${companyId})) AS acquired`);
    slotAcquired = (lockResult.rows?.[0] as { acquired: boolean })?.acquired ?? false;
  } catch {
    log.warn('Advisory lock check failed, falling back to query-based check', { companyId });
  }

  if (!slotAcquired) {
    return mkSkipped('Night shift skipped: could not acquire execution lock (slot may be occupied).');
  }

  try {
    const [activeTask] = await db.select({ id: tasksTable.id, title: tasksTable.title })
      .from(tasksTable)
      .where(and(eq(tasksTable.company_id, companyId), eq(tasksTable.status, 'in_progress')))
      .limit(1);
    if (activeTask) {
      return mkSkipped(`Night shift skipped: company has an active execution (task "${activeTask.title}"). Slot is occupied.`);
    }

  await eventService.emit(companyId, 'night_shift_started', {});
  const plan = await planNightShift(companyId);

  // ── Automatic health probes — runs BEFORE task execution ──
  const healthAlerts = await runHealthProbes(companyId);
  if (healthAlerts.length > 0) {
    log.warn('Health alerts detected during night shift', { companyId, alerts: healthAlerts });
  }

  const results = await executeNightShift(plan);
  const summary = generateSummary(plan, results, healthAlerts);

  const [cycle] = await db.insert(nightShiftCycles).values({
    company_id: companyId, summary, company_stage: plan.stage,
  }).returning();

  await eventService.emit(companyId, 'night_shift_completed', { tasks_completed: results.completed, tasks_failed: results.failed, tasks_created: plan.tasks_to_create.length });

  // Send email (non-blocking)
  try {
    const [co] = await db.select({ name: companies.name, owner_id: companies.owner_id }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (co?.owner_id) {
      const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, co.owner_id)).limit(1);
      if (owner?.email) sendNightShiftSummaryEmail(owner.email, co.name ?? 'Your Company', summary, companyId).catch((err) => log.warn('Night shift email failed', { companyId, error: err?.message }));
    }
  } catch { /* non-blocking */ }

  // 2B-4: Try to advance roadmap after execution
  try {
    const advancement = await roadmapService.advanceRoadmap(companyId);
    if (advancement.advanced) {
      log.info('Roadmap advanced during night shift', { companyId, phase: advancement.currentPhase });
    }
  } catch { /* non-blocking */ }

  log.info('Night shift complete', { companyId, completed: results.completed, failed: results.failed });
  return (cycle ?? mkSkipped(summary)) as unknown as NightShiftCycle;

  } finally {
    // Release advisory lock
    try {
      await txDb.execute(sql`SELECT pg_advisory_unlock(hashtext(${companyId}))`);
    } catch { /* best-effort release */ }
  }
}
