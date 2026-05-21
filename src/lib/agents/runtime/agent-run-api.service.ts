import { and, desc, eq } from 'drizzle-orm';
import {
  agentGateDecisions,
  agentRunControls,
  agentRunEvents,
  agentRunMessages,
  agentToolCalls,
  agentVerificationResults,
  companies,
  db,
  runs,
  tasks,
} from '@/lib/db';

export async function getOwnedAgentRun(runId: string, userId: string) {
  const [row] = await db.select({
    id: runs.id,
    session_id: runs.session_id,
    task_id: runs.task_id,
    status: runs.status,
    agent_id: runs.agent_id,
    execution_mode: runs.execution_mode,
    started_at: runs.started_at,
    ended_at: runs.ended_at,
    turn_count: runs.turn_count,
    error_summary: runs.error_summary,
    company_id: tasks.company_id,
    task_title: tasks.title,
    task_description: tasks.description,
    task_tag: tasks.tag,
    task_status: tasks.status,
    task_priority: tasks.priority,
    task_max_turns: tasks.max_turns,
    task_estimated_credits: tasks.estimated_credits,
    task_verification_level: tasks.verification_level,
  })
    .from(runs)
    .innerJoin(tasks, eq(runs.task_id, tasks.id))
    .innerJoin(companies, eq(tasks.company_id, companies.id))
    .where(and(eq(runs.id, runId), eq(companies.owner_id, userId)))
    .limit(1);
  return row ?? null;
}

export async function listOwnedAgentRuns(userId: string, limit = 20) {
  return db.select({
    id: runs.id,
    task_id: runs.task_id,
    status: runs.status,
    agent_id: runs.agent_id,
    execution_mode: runs.execution_mode,
    started_at: runs.started_at,
    ended_at: runs.ended_at,
    turn_count: runs.turn_count,
    company_id: tasks.company_id,
    task_title: tasks.title,
  })
    .from(runs)
    .innerJoin(tasks, eq(runs.task_id, tasks.id))
    .innerJoin(companies, eq(tasks.company_id, companies.id))
    .where(eq(companies.owner_id, userId))
    .orderBy(desc(runs.started_at))
    .limit(limit);
}

export async function listRunEvents(runId: string) {
  return db.select().from(agentRunEvents)
    .where(eq(agentRunEvents.run_id, runId))
    .orderBy(agentRunEvents.sequence);
}

export async function listRunMessages(runId: string) {
  return db.select().from(agentRunMessages)
    .where(eq(agentRunMessages.run_id, runId))
    .orderBy(agentRunMessages.created_at);
}

export async function listRunToolCalls(runId: string) {
  return db.select().from(agentToolCalls)
    .where(eq(agentToolCalls.run_id, runId))
    .orderBy(agentToolCalls.created_at);
}

export async function listRunGateDecisions(runId: string) {
  return db.select().from(agentGateDecisions)
    .where(eq(agentGateDecisions.run_id, runId))
    .orderBy(desc(agentGateDecisions.created_at));
}

export async function listRunVerificationResults(runId: string) {
  return db.select().from(agentVerificationResults)
    .where(eq(agentVerificationResults.run_id, runId))
    .orderBy(desc(agentVerificationResults.created_at));
}

export async function requestRunControl(input: {
  runId: string;
  taskId: string;
  action: 'abort' | 'resume' | 'replay_from_tool' | 'fork_from_event' | 'verify';
  requestedBy?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}) {
  const [control] = await db.insert(agentRunControls).values({
    run_id: input.runId,
    task_id: input.taskId,
    action: input.action,
    status: 'requested',
    requested_by: input.requestedBy ?? null,
    reason: input.reason ?? null,
    payload: input.payload ?? null,
  }).returning();
  return control;
}

export async function markRunControlHandled(controlId: string, payload?: Record<string, unknown>) {
  const update: Partial<typeof agentRunControls.$inferInsert> = {
    status: 'handled',
    handled_at: new Date(),
  };
  if (payload !== undefined) update.payload = payload;
  const [control] = await db.update(agentRunControls).set(update).where(eq(agentRunControls.id, controlId)).returning();
  return control;
}
