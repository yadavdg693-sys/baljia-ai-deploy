// Night Shift Engine — context-driven planner (no stage buckets)
//
// Design note: this module previously routed planning through fixed
// `early/validation/monetization/...` stage buckets backed by hardcoded
// requirement tables. The bucketing was based on completed-task counters,
// not real signals about the company. We replaced it with a contextual
// planner: we read documents, recent task outcomes, deployment status,
// activity counts, and learnings, then ask a small LLM (Haiku via
// callSmallLLM) to pick the next 1-2 priorities. No templated gap lists,
// no stage objectives — judgment from real context.
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import * as roadmapService from '@/lib/services/roadmap.service';
import * as failureService from '@/lib/services/failure.service';
import { createTaskDraft, finalizeTaskDraftIds } from '@/lib/services/task-draft.service';
import { sendNightShiftSummaryEmail } from '@/lib/services/email.service';
import { callSmallLLM } from '@/lib/services/onboarding/llm/small-llm';
import { processQueue } from '@/lib/agents/worker-launcher';
import {
  db, txDb, companies, nightShiftCycles, users,
  tasks as tasksTable, documents, learnings, emailThreads, adCampaigns,
} from '@/lib/db';
import { eq, and, or, gte, sql, desc } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';
import type { NightShiftCycle, Task } from '@/types';

const log = createLogger('NightShift');

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
        description: `Night Shift health probe detected an issue:\n- URL: ${liveUrl}\n- Response: ${msg}\n\nDiagnose first: call get_company_tech to find the company's Render service and GitHub repo, then call render_get_logs with log_type="service" or "deploy" to see the error pattern. Fix the code in GitHub, redeploy with render_deploy, and verify the URL with check_url_health. This is affecting live users.`,
        tag: 'bug-fix',
        priority: 95,
        source: 'auto_remediation',
        status: 'todo',
        queue_order: 0,
        estimated_credits: 1,
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
        description: `Night Shift health probe could not reach the app:\n- URL: ${liveUrl}\n- Error: ${reason}\n\nThe live Render app is unreachable. Call get_company_tech to find the Render service and GitHub repo, inspect render_get_logs with log_type="service" and "deploy", then fix the repo and redeploy with render_deploy. If the current source is broken, revert by redeploying the last known-good GitHub commit.`,
        tag: 'bug-fix',
        priority: 99,
        source: 'auto_remediation',
        status: 'todo',
        queue_order: 0,
        estimated_credits: 1,
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
      subdomain: companies.subdomain,
      slug: companies.slug,
    }).from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) return [];

    // Determine live URL: prefer custom domain, fallback to
    // {subdomain|slug}.baljia.app. Founder apps deploy on Render after
    // engineering approval; onboarding owns the initial Cloudflare landing page.
    // If there's no subdomain/slug yet, the company
    // hasn't been provisioned, so skip.
    const cfHost = company.subdomain ?? company.slug;
    const liveUrl = company.custom_domain
      ? `https://${company.custom_domain}`
      : cfHost
      ? `https://${cfHost}.baljia.app`
      : null;

    if (!liveUrl) return []; // not provisioned yet — skip

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

// ══════════════════════════════════════════════
// CONTEXTUAL PRIORITY PICKER
// Reads real signals (documents, recent task outcomes, deployment state,
// activity counts, learnings) and asks Haiku to pick at most 2 next
// priorities. Replaces the previous stage-keyed gap analysis.
// ══════════════════════════════════════════════

interface ContextPriority {
  title: string;
  tag: string;
  description: string;
  reasoning: string;
}

interface ContextPickerResult {
  priorities: ContextPriority[];
  judgment: string | null;
}

const KNOWN_TAGS = [
  'landing-page', 'seo', 'seo-meta', 'billing', 'tweet', 'outreach',
  'email-template', 'meta-ads', 'analytics', 'tracking', 'automation',
  'performance', 'security', 'bug-fix', 'fix', 'content', 'research',
  'css', 'favicon', 'error-page', 'monitoring',
];

async function pickPrioritiesFromContext(
  companyId: string,
  tasks: Task[],
): Promise<ContextPickerResult> {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [companyRow, docRows, learningRows, emailCountRow, adCountRow] = await Promise.all([
    db.select({
      name: companies.name, slug: companies.slug, one_liner: companies.one_liner,
      original_idea: companies.original_idea,
      custom_domain: companies.custom_domain, subdomain: companies.subdomain,
    }).from(companies).where(eq(companies.id, companyId)).limit(1),
    db.select({ doc_type: documents.doc_type, title: documents.title, content: documents.content })
      .from(documents)
      .where(and(eq(documents.company_id, companyId), eq(documents.is_empty, false)))
      .limit(8),
    db.select({ category: learnings.category, content: learnings.content, confidence: learnings.confidence })
      .from(learnings)
      .where(and(eq(learnings.company_id, companyId), eq(learnings.status, 'active')))
      .orderBy(desc(learnings.created_at))
      .limit(5),
    db.select({ count: sql<number>`count(*)` }).from(emailThreads)
      .where(and(eq(emailThreads.company_id, companyId), eq(emailThreads.direction, 'outbound'), gte(emailThreads.created_at, new Date(sevenDaysAgoIso)))),
    db.select({ count: sql<number>`count(*)` }).from(adCampaigns)
      .where(and(eq(adCampaigns.company_id, companyId), eq(adCampaigns.status, 'active'))),
  ]);

  const company = companyRow[0];
  if (!company) return { priorities: [], judgment: null };

  const cfHost = company.subdomain ?? company.slug;
  const liveUrl = company.custom_domain
    ? `https://${company.custom_domain}`
    : cfHost
    ? `https://${cfHost}.baljia.app`
    : null;

  const completed = tasks.filter((t) => t.status === 'completed' && t.completed_at);
  const recentCompleted = completed.filter(
    (t) => new Date(t.completed_at!).getTime() >= Date.parse(sevenDaysAgoIso),
  );
  const last5Completed = [...completed]
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
    .slice(0, 5);
  const last3Failed = tasks
    .filter((t) => (t.status === 'failed' || t.status === 'failed_permanent'))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3);
  const todoTitles = tasks.filter((t) => t.status === 'todo').map((t) => t.title);

  const docSnippets = docRows
    .map((d) => `- **${d.title ?? d.doc_type}** (${d.doc_type}): ${(d.content ?? '').replace(/\s+/g, ' ').slice(0, 240)}`)
    .join('\n') || '(no documents populated yet)';

  const learningSnippets = learningRows
    .map((l) => `- [${l.category ?? 'general'} · ${l.confidence}] ${l.content.replace(/\s+/g, ' ').slice(0, 200)}`)
    .join('\n') || '(no learnings captured yet)';

  const recentEmails = Number(emailCountRow[0]?.count ?? 0);
  const activeAds = Number(adCountRow[0]?.count ?? 0);

  const prompt = `You are the night-shift planner for an autonomous SaaS founder platform. Your job: read the company's real situation and pick at most 2 next priorities. There are NO fixed lifecycle stages — judge from real signals only.

## Company
- Name: ${company.name}
- One-liner: ${company.one_liner ?? '(not set)'}
- Original idea: ${(company.original_idea ?? '(not set)').slice(0, 400)}
- Live URL: ${liveUrl ?? 'NOT DEPLOYED YET'}

## Documents (what the company has captured about itself)
${docSnippets}

## Recent activity (last 7 days)
- Tasks completed: ${recentCompleted.length}
- Outbound emails sent: ${recentEmails}
- Active ad campaigns: ${activeAds}

## Last 5 completed tasks
${last5Completed.map((t) => `- ${t.title} [${t.tag}]`).join('\n') || '(none)'}

## Last 3 failures
${last3Failed.map((t) => `- ${t.title}${t.failure_class ? ` [${t.failure_class}]` : ''}`).join('\n') || '(none)'}

## Top learnings
${learningSnippets}

## Currently in queue (do NOT duplicate)
${todoTitles.slice(0, 10).map((t) => `- ${t}`).join('\n') || '(empty queue)'}

---

Pick at most 2 priorities. Each priority must be a single concrete task one agent can finish in one shot. Output STRICT JSON:

{
  "judgment": "one sentence — what you read about this company and why these priorities matter NOW (max 200 chars)",
  "priorities": [
    {
      "title": "string — concrete imperative under 80 chars",
      "tag": "string — must be one of: ${KNOWN_TAGS.join(', ')}",
      "description": "string — what the agent should do, 2-3 sentences",
      "reasoning": "string — one sentence on why this matters NOW for THIS company"
    }
  ]
}

If nothing meaningfully needs doing right now, return {"judgment": "...", "priorities": []}. Output JSON only — no prose, no markdown fences.`;

  let raw: string;
  try {
    raw = await callSmallLLM(prompt, 800);
  } catch (err) {
    log.warn('callSmallLLM failed in pickPrioritiesFromContext', { companyId, error: err instanceof Error ? err.message : 'unknown' });
    return { priorities: [], judgment: null };
  }

  // Strip markdown fences if the model added them despite the instruction
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    log.warn('Failed to parse LLM JSON in pickPrioritiesFromContext', { companyId, raw: cleaned.slice(0, 300), error: err instanceof Error ? err.message : 'unknown' });
    return { priorities: [], judgment: null };
  }

  const obj = parsed as { judgment?: unknown; priorities?: unknown };
  const judgment = typeof obj.judgment === 'string' ? obj.judgment.slice(0, 240) : null;
  const priorities: ContextPriority[] = [];

  if (Array.isArray(obj.priorities)) {
    for (const p of obj.priorities) {
      if (!p || typeof p !== 'object') continue;
      const pp = p as Record<string, unknown>;
      const title = typeof pp.title === 'string' ? pp.title.trim() : '';
      const tag = typeof pp.tag === 'string' ? pp.tag.trim().toLowerCase() : '';
      const description = typeof pp.description === 'string' ? pp.description.trim() : '';
      const reasoning = typeof pp.reasoning === 'string' ? pp.reasoning.trim() : '';
      if (!title || !tag || !description) continue;
      // Tag whitelist defense — fall back to 'fix' if model hallucinates an unknown tag
      const safeTag = KNOWN_TAGS.includes(tag) ? tag : 'fix';
      priorities.push({ title: title.slice(0, 100), tag: safeTag, description: description.slice(0, 600), reasoning: reasoning.slice(0, 240) });
    }
  }

  return { priorities, judgment };
}

interface NightShiftPlan {
  companyId: string;
  tasks_to_execute: string[];
  tasks_to_create: Array<{ title: string; tag: string; description: string }>;
  skipped_reasons: string[];
  /** One-line summary of what the planner judged. Surfaced in the night-shift report. */
  judgment: string | null;
}

async function planNightShift(companyId: string): Promise<NightShiftPlan> {
  const tasks = await taskService.getTasks(companyId);
  const todoTasks = tasks.filter((t) => t.status === 'todo');
  const failedTasks = tasks.filter((t) => t.status === 'failed');

  const plan: NightShiftPlan = {
    companyId,
    tasks_to_execute: [],
    tasks_to_create: [],
    skipped_reasons: [],
    judgment: null,
  };

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

  // Contextual priority picker (replaces stage-keyed gap analysis).
  // Reads documents, recent task outcomes, deployment state, activity counts,
  // and learnings, then asks Haiku to pick at most 2 next priorities.
  // No fixed stages, no templated requirement tables — pure judgment from context.
  try {
    const suggestions = await pickPrioritiesFromContext(companyId, tasks);
    plan.judgment = suggestions.judgment;
    const existingTags = new Set(tasks.map((t) => t.tag.toLowerCase()));

    for (const sugg of suggestions.priorities.slice(0, 2)) {
      if (existingTags.has(sugg.tag.toLowerCase())) {
        plan.skipped_reasons.push(`Auto-suggested "${sugg.title}" skipped: tag "${sugg.tag}" already in queue`);
        continue;
      }
      if (activeTitles.has(sugg.title.toLowerCase())) {
        plan.skipped_reasons.push(`Auto-suggested "${sugg.title}" skipped: duplicate title`);
        continue;
      }
      const a = checkAdmissibility(sugg.tag, sugg.title);
      if (a.admissible) {
        plan.tasks_to_create.push({
          title: sugg.title,
          tag: sugg.tag,
          description: `${sugg.description}\n\n[Why now] ${sugg.reasoning}`,
        });
      } else {
        plan.skipped_reasons.push(`Auto-suggested "${sugg.title}" needs your approval: ${a.reason}`);
      }
    }
  } catch (err) {
    log.warn('Contextual priority picker failed, continuing without', { companyId, error: err instanceof Error ? err.message : 'Unknown' });
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

  // Night-shift cycles are funded by the subscription's night_shifts_remaining
  // allowance, not by founder credit balance. Task creation and execution here
  // do NOT deduct from credit_ledger — see worker-launcher's subscriptionFunded
  // path. Per-cycle decrement of the allowance happens in runNightShift.
  const createdDraftIds: string[] = [];
  let finalizedDraftTaskCount = 0;
  for (const newTask of plan.tasks_to_create) {
    try {
      const draft = await createTaskDraft({
        company_id: plan.companyId,
        title: newTask.title,
        tag: newTask.tag,
        description: newTask.description,
        priority: 80,
        source: 'night_shift_generated',
        status: 'pending_ceo_review',
        suggestion_reasoning: plan.judgment ?? null,
        proposed_task: {
          queue_order: 1,
          estimated_credits: 1,
          max_turns: 200,
          executability_type: 'can_run_now',
          authorized_by: 'night_shift',
          authorization_reason: plan.judgment ? `Night shift auto-created: ${plan.judgment}` : 'Night shift auto-created from company context',
        },
      });
      createdDraftIds.push(draft.id);
    } catch (error) { log.error('Failed to create night-shift task', { title: newTask.title }, error); }
  }

  if (createdDraftIds.length > 0) {
    const finalized = await finalizeTaskDraftIds(plan.companyId, createdDraftIds, {
      authorizedBy: 'night_shift',
      authorizationReason: plan.judgment ? `Night shift finalized: ${plan.judgment}` : 'Night shift finalized from company context',
    });
    finalizedDraftTaskCount = finalized.finalized;
    if (finalized.skipped.length > 0) {
      log.warn('Night-shift draft finalization skipped some drafts', {
        companyId: plan.companyId,
        skipped: finalized.skipped,
      });
    }
  }

  // SPEC-CTRL-001: One execution slot per company. A night-shift cycle runs
  // at most one task through the queue; remaining queued work drains on
  // subsequent cycles or manual triggers.
  const maxTasks = Math.min(plan.tasks_to_execute.length + finalizedDraftTaskCount, 1);
  for (let i = 0; i < maxTasks; i++) {
    try {
      const processed = await processQueue(plan.companyId, { subscriptionFunded: true });
      if (processed > 0) completed++; else break;
    } catch (error) {
      log.error('Task execution failed', { companyId: plan.companyId }, error);
      failed++;
    }
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
    plan.judgment ? `**Judgment:** ${plan.judgment}` : `**Judgment:** (no LLM judgment — running on retries/roadmap only)`,
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
  const mkSkipped = (reason: string) => ({ id: crypto.randomUUID(), company_id: companyId, cycle_number: null, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), planned_tasks: null, executed_tasks: null, summary: reason, trust_score: null, created_at: new Date().toISOString() }) as NightShiftCycle;

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
    company_id: companyId, summary,
  }).returning();

  // Consume one night-shift allowance slot from the active subscription.
  // GREATEST clamps at 0 — defense-in-depth, but the cron gate should already
  // prevent cycles when remaining=0.
  try {
    await db.execute(sql`
      UPDATE subscriptions
      SET night_shifts_remaining = GREATEST(0, COALESCE(night_shifts_remaining, 0) - 1)
      WHERE company_id = ${companyId} AND status = 'active'
    `);
  } catch (err) {
    log.warn('Failed to decrement night_shifts_remaining', { companyId, error: err instanceof Error ? err.message : 'unknown' });
  }

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
