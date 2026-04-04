// Night Shift Engine — migrated to Drizzle + Neon
import * as taskService from '@/lib/services/task.service';
import * as creditService from '@/lib/services/credit.service';
import * as eventService from '@/lib/services/event.service';
import { sendNightShiftSummaryEmail } from '@/lib/services/email.service';
import { processQueue } from '@/lib/agents/worker-launcher';
import { db, companies, nightShiftCycles, users } from '@/lib/db';
import { eq } from 'drizzle-orm';
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

  for (const failed of failedTasks.slice(0, 3)) {
    const a = checkAdmissibility(failed.tag, failed.title);
    if (a.admissible) {
      plan.tasks_to_create.push({ title: `[Retry] ${failed.title}`, tag: failed.tag, description: `Auto-retry. Failure: ${failed.failure_class ?? 'unknown'}. ${failed.description ?? ''}` });
    } else {
      plan.skipped_reasons.push(`Skipped retry of "${failed.title}": ${a.reason}`);
    }
  }

  for (const todo of todoTasks) {
    const a = checkAdmissibility(todo.tag, todo.title);
    if (a.admissible) plan.tasks_to_execute.push(todo.id);
    else plan.skipped_reasons.push(`Skipped "${todo.title}": ${a.reason}`);
  }

  return plan;
}

async function executeNightShift(plan: NightShiftPlan): Promise<{ completed: number; failed: number }> {
  let completed = 0; let failed = 0;
  const balance = await creditService.getBalance(plan.companyId);

  for (const newTask of plan.tasks_to_create) {
    if (balance - completed <= 0) { log.warn('Out of credits', { companyId: plan.companyId }); break; }
    try {
      await taskService.createTask({ company_id: plan.companyId, title: newTask.title, tag: newTask.tag, description: newTask.description, priority: 80, source: 'auto_remediation', status: 'todo', queue_order: 1, estimated_credits: 1, max_turns: 200, executability_type: 'can_run_now' });
    } catch (error) { log.error('Failed to create retry task', { title: newTask.title }, error); }
  }

  const maxTasks = Math.min(plan.tasks_to_execute.length, balance, 5);
  for (let i = 0; i < maxTasks; i++) {
    try { const processed = await processQueue(plan.companyId); if (processed > 0) completed++; else break; }
    catch (error) { log.error('Task execution failed', { companyId: plan.companyId }, error); failed++; }
  }

  return { completed, failed };
}

function generateSummary(plan: NightShiftPlan, results: { completed: number; failed: number }): string {
  const lines = [`## Night Shift Report`, `**Stage:** ${plan.stage} | **Objective:** ${plan.objective}`, '', `### Results`, `- Tasks completed: ${results.completed}`, `- Tasks failed: ${results.failed}`, `- Retry tasks created: ${plan.tasks_to_create.length}`];
  if (plan.skipped_reasons.length > 0) { lines.push('', '### Skipped (needs your approval)'); for (const r of plan.skipped_reasons) lines.push(`- ${r}`); }
  return lines.join('\n');
}

export async function runNightShift(companyId: string): Promise<NightShiftCycle> {
  log.info('Starting night shift', { companyId });

  const [company] = await db.select({ lifecycle: companies.lifecycle, execution_state: companies.execution_state })
    .from(companies).where(eq(companies.id, companyId)).limit(1);

  const activeLifecycles = ['trial_active', 'full_active', 'keep_live_active'];
  const mkSkipped = (reason: string) => ({ id: crypto.randomUUID(), company_id: companyId, cycle_number: null, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), planned_tasks: null, executed_tasks: null, summary: reason, company_stage: 'early', trust_score: null, created_at: new Date().toISOString() }) as NightShiftCycle;

  if (!company || !activeLifecycles.includes(company.lifecycle ?? '')) return mkSkipped(`Night shift skipped: lifecycle is ${company?.lifecycle ?? 'unknown'}`);
  if (company.execution_state === 'suspended') return mkSkipped('Night shift skipped: execution suspended');

  await eventService.emit(companyId, 'night_shift_started', {});
  const plan = await planNightShift(companyId);
  const results = await executeNightShift(plan);
  const summary = generateSummary(plan, results);

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

  log.info('Night shift complete', { companyId, completed: results.completed, failed: results.failed });
  return (cycle ?? mkSkipped(summary)) as unknown as NightShiftCycle;
}
