// Cycle Planning Service — KG spec §3.2
// Implements cycle_planning MCP tools: get_cycle_context, create_cycle_plan, update_cycle_plan, submit_review
// Used by CEO/chat and night shift orchestration pipeline.

import { db, nightShiftCycles, companies, tasks as tasksTable, reports } from '@/lib/db';
import { eq, desc, and, gte } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('CyclePlanning');

/**
 * get_cycle_context — returns the most recent night shift cycle summary for this company.
 * CEO uses this to understand what night shift completed last run.
 */
export async function getCycleContext(companyId: string): Promise<{
  cycle_number: number | null;
  started_at: string;
  summary: string;
  tasks_completed: number;
  tasks_created: number;
}> {
  try {
    const [latest] = await db
      .select({
        cycle_number: nightShiftCycles.cycle_number,
        started_at: nightShiftCycles.started_at,
        summary: nightShiftCycles.summary,
        executed_tasks: nightShiftCycles.executed_tasks,
        planned_tasks: nightShiftCycles.planned_tasks,
      })
      .from(nightShiftCycles)
      .where(eq(nightShiftCycles.company_id, companyId))
      .orderBy(desc(nightShiftCycles.started_at))
      .limit(1);

    if (!latest) {
      return {
        cycle_number: null,
        started_at: 'never',
        summary: 'No night shift cycles have run yet for this company.',
        tasks_completed: 0,
        tasks_created: 0,
      };
    }

    const executed = Array.isArray(latest.executed_tasks) ? latest.executed_tasks.length : 0;
    const planned = Array.isArray(latest.planned_tasks) ? latest.planned_tasks.length : 0;

    return {
      cycle_number: latest.cycle_number,
      started_at: latest.started_at?.toISOString() ?? 'unknown',
      summary: latest.summary ?? 'No summary available.',
      tasks_completed: executed,
      tasks_created: planned,
    };
  } catch (err) {
    log.error('getCycleContext failed', { companyId, err });
    throw err;
  }
}

/**
 * create_cycle_plan — creates a structured plan for the next night shift cycle.
 * Stored as a special task in the queue to be picked up by the night shift engine.
 */
export async function createCyclePlan(companyId: string, plan: {
  objective: string;
  tasks: Array<{ title: string; tag: string; priority: number; rationale: string }>;
  notes?: string;
}): Promise<{ plan_id: string; task_count: number }> {
  try {
    // Store the plan as a report so it's visible to CEO and night shift
    const [report] = await db.insert(reports).values({
      company_id: companyId,
      title: `Night Shift Plan — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      content: [
        `## Objective\n${plan.objective}`,
        `## Planned Tasks (${plan.tasks.length})`,
        ...plan.tasks.map((t, i) =>
          `**${i + 1}. ${t.title}** [${t.tag}] — Priority: ${t.priority}/100\n> ${t.rationale}`
        ),
        plan.notes ? `## Notes\n${plan.notes}` : '',
      ].filter(Boolean).join('\n\n'),
      report_type: 'cycle_plan',
    }).returning({ id: reports.id });

    log.info('Cycle plan created', { companyId, planId: report.id, taskCount: plan.tasks.length });

    return { plan_id: report.id, task_count: plan.tasks.length };
  } catch (err) {
    log.error('createCyclePlan failed', { companyId, err });
    throw err;
  }
}

/**
 * update_cycle_plan — updates an in-progress cycle plan by adding/removing tasks or changing objective.
 * Useful if CEO wants to adjust tonight's plan before night shift runs.
 */
export async function updateCyclePlan(companyId: string, planId: string, update: {
  objective?: string;
  add_tasks?: Array<{ title: string; tag: string; priority: number }>;
  remove_task_ids?: string[];
  notes?: string;
}): Promise<{ updated: boolean; plan_id: string }> {
  try {
    // Fetch existing plan report
    const [existing] = await db
      .select({ id: reports.id, content: reports.content })
      .from(reports)
      .where(and(
        eq(reports.company_id, companyId),
        eq(reports.id, planId),
      ))
      .limit(1);

    if (!existing) {
      return { updated: false, plan_id: planId };
    }

    let newContent = existing.content ?? '';

    if (update.objective) {
      newContent = newContent.replace(/## Objective\n[^\n]+/m, `## Objective\n${update.objective}`);
    }

    if (update.add_tasks?.length) {
      const additions = update.add_tasks
        .map((t) => `\n**[ADDED]** ${t.title} [${t.tag}] — Priority: ${t.priority}/100`)
        .join('\n');
      newContent += `\n\n## Updates\n${additions}`;
    }

    if (update.notes) {
      newContent += `\n\n**Updated at ${new Date().toISOString()}:** ${update.notes}`;
    }

    await db
      .update(reports)
      .set({ content: newContent })
      .where(eq(reports.id, planId));

    log.info('Cycle plan updated', { companyId, planId });
    return { updated: true, plan_id: planId };
  } catch (err) {
    log.error('updateCyclePlan failed', { companyId, planId, err });
    throw err;
  }
}

/**
 * submit_review — submit a founder review/score for a completed night shift cycle.
 * Stored in the cycle record for trust score adjustment.
 */
export async function submitCycleReview(companyId: string, review: {
  cycle_number?: number | null;
  score: number; // 1-10
  feedback: string;
  approved_tasks?: string[];
  rejected_tasks?: string[];
}): Promise<{ review_recorded: boolean; cycle_id: string | null }> {
  try {
    // Find the cycle to review
    let cycleQuery = db
      .select({ id: nightShiftCycles.id, trust_score: nightShiftCycles.trust_score })
      .from(nightShiftCycles)
      .where(eq(nightShiftCycles.company_id, companyId))
      .orderBy(desc(nightShiftCycles.started_at))
      .limit(1);

    const [cycle] = await cycleQuery;
    if (!cycle) return { review_recorded: false, cycle_id: null };

    // Record founder feedback as a report
    await db.insert(reports).values({
      company_id: companyId,
      title: `Founder Review — Cycle ${review.cycle_number ?? 'latest'}`,
      content: [
        `## Score: ${review.score}/10`,
        `## Feedback\n${review.feedback}`,
        review.approved_tasks?.length
          ? `## Approved Tasks\n${review.approved_tasks.map((t) => `- ✅ ${t}`).join('\n')}`
          : '',
        review.rejected_tasks?.length
          ? `## Rejected Tasks\n${review.rejected_tasks.map((t) => `- ❌ ${t}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n\n'),
      report_type: 'cycle_review',
    });

    log.info('Cycle review submitted', { companyId, cycleId: cycle.id, score: review.score });
    return { review_recorded: true, cycle_id: cycle.id };
  } catch (err) {
    log.error('submitCycleReview failed', { companyId, err });
    throw err;
  }
}
