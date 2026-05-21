import { db, taskDrafts } from '@/lib/db';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { sanitizeForFounder } from '@/lib/founder-safety/sanitize';
import { stripLlmArtifacts } from '@/lib/text/llm-artifacts';
import * as taskService from '@/lib/services/task.service';
import * as eventService from '@/lib/services/event.service';
import { routeTaskStrict } from '@/lib/services/router.service';
import {
  requiresExecutionContractForEngineering,
  validateExecutionContract,
} from '@/lib/agents/execution-contract';
import type { ExecutabilityType, TaskSource } from '@/types';

export type TaskDraftStatus = 'pending_ceo_review' | 'finalized' | 'discarded';
export type TaskDraftSource = 'onboarding' | 'night_shift_generated' | 'recurring';

export interface CreateTaskDraftInput {
  company_id: string;
  title: string;
  description?: string | null;
  tag: string;
  priority?: number;
  source: TaskDraftSource;
  status?: TaskDraftStatus;
  suggestion_reasoning?: string | null;
  proposed_task?: Record<string, unknown> | null;
  proposed_execution_contract?: Record<string, unknown> | null;
}

export async function createTaskDraft(input: CreateTaskDraftInput) {
  const safeTitle = stripLlmArtifacts(sanitizeForFounder(input.title, {
    mode: 'soft',
    context: { callsite: 'createTaskDraft.title', companyId: input.company_id, source: input.source },
  }).clean);

  const safeDescription = input.description
    ? stripLlmArtifacts(sanitizeForFounder(input.description, {
        mode: 'soft',
        context: { callsite: 'createTaskDraft.description', companyId: input.company_id, source: input.source },
      }).clean, { keepLineStructure: true })
    : null;

  const safeReasoning = input.suggestion_reasoning
    ? stripLlmArtifacts(input.suggestion_reasoning)
    : null;

  const [draft] = await db.insert(taskDrafts).values({
    company_id: input.company_id,
    title: safeTitle,
    description: safeDescription,
    tag: input.tag,
    priority: input.priority ?? 50,
    source: input.source,
    status: input.status ?? 'pending_ceo_review',
    suggestion_reasoning: safeReasoning,
    proposed_task: input.proposed_task ?? null,
    proposed_execution_contract: input.proposed_execution_contract ?? null,
  }).returning();

  if (!draft) throw new Error('Failed to create task draft');
  return draft;
}

export async function getPendingTaskDrafts(companyId: string) {
  return db.select()
    .from(taskDrafts)
    .where(and(eq(taskDrafts.company_id, companyId), eq(taskDrafts.status, 'pending_ceo_review')))
    .orderBy(desc(taskDrafts.created_at));
}

export async function getPendingTaskDraftsForSources(companyId: string, sources: TaskDraftSource[]) {
  if (sources.length === 0) return [];
  return db.select()
    .from(taskDrafts)
    .where(and(
      eq(taskDrafts.company_id, companyId),
      eq(taskDrafts.status, 'pending_ceo_review'),
      inArray(taskDrafts.source, sources),
    ))
    .orderBy(desc(taskDrafts.created_at));
}

export async function getTaskDraft(draftId: string) {
  const [draft] = await db.select()
    .from(taskDrafts)
    .where(eq(taskDrafts.id, draftId))
    .limit(1);
  return draft ?? null;
}

export async function markTaskDraftFinalized(draftId: string, taskId: string) {
  const [draft] = await db.update(taskDrafts)
    .set({
      status: 'finalized',
      reviewed_task_id: taskId,
      reviewed_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(taskDrafts.id, draftId))
    .returning();
  return draft ?? null;
}

export async function discardTaskDraft(draftId: string) {
  const [draft] = await db.update(taskDrafts)
    .set({
      status: 'discarded',
      reviewed_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(taskDrafts.id, draftId))
    .returning();
  return draft ?? null;
}

export interface FinalizeTaskDraftOptions {
  authorizedBy: string;
  authorizationReason: string;
}

export interface FinalizeTaskDraftResult {
  finalized: number;
  skipped: Array<{ draft_id: string; reason: string }>;
  task_ids: string[];
}

export async function finalizeTaskDraftIds(
  companyId: string,
  draftIds: string[],
  options: FinalizeTaskDraftOptions,
): Promise<FinalizeTaskDraftResult> {
  const result: FinalizeTaskDraftResult = { finalized: 0, skipped: [], task_ids: [] };

  for (const draftId of draftIds) {
    const draft = await getTaskDraft(draftId);
    if (!draft || draft.company_id !== companyId || draft.status !== 'pending_ceo_review') {
      result.skipped.push({ draft_id: draftId, reason: 'draft not found or already reviewed' });
      continue;
    }

    const finalized = await finalizeOneDraft(draft as TaskDraftRow, options);
    if (finalized.ok) {
      result.finalized++;
      result.task_ids.push(finalized.task_id);
    } else {
      result.skipped.push({ draft_id: draftId, reason: finalized.reason });
    }
  }

  return result;
}

export async function finalizePendingTaskDraftsForSources(
  companyId: string,
  sources: TaskDraftSource[],
  options: FinalizeTaskDraftOptions,
): Promise<FinalizeTaskDraftResult> {
  const drafts = await getPendingTaskDraftsForSources(companyId, sources);
  return finalizeTaskDraftIds(companyId, drafts.map((draft) => draft.id), options);
}

type TaskDraftRow = typeof taskDrafts.$inferSelect;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function executabilityValue(value: unknown): ExecutabilityType | undefined {
  return value === 'can_run_now' || value === 'needs_new_connection' || value === 'manual_task'
    ? value
    : undefined;
}

function buildExecutionContractFromDraft(draft: TaskDraftRow, agentId: number): Record<string, unknown> {
  const title = draft.title.trim();
  const description = (draft.description ?? title).trim();
  return {
    version: 1,
    intent: 'feature',
    assigned_agent_id: agentId,
    confirmation_source: 'founder_confirmed',
    founder_visible_summary: title,
    product_scope: description,
    assumptions: [
      'CEO finalized this from an internal onboarding/night-shift/recurring draft.',
      'Engineering may choose implementation details inside this exact scope.',
    ],
    open_questions: [],
    user_flow: [
      `User opens the relevant product surface for ${title}.`,
      'User completes the primary action described in the task.',
      'User sees a clear saved result, output, or success readback.',
    ],
    screens: ['Primary feature screen', 'Result or confirmation state'],
    data_fields: ['Primary input fields from the task scope', 'Status/result readback', 'Created/updated timestamp when data is persisted'],
    api_actions: ['Load the feature state', 'Submit the primary action', 'Read back the saved/result state'],
    integrations: [],
    acceptance_criteria: [
      'The implemented flow matches the task title and description.',
      'The primary user action works in the deployed UI.',
      'Any data written by the flow is visible again after refresh or readback.',
    ],
    out_of_scope: ['Unmentioned payments, booking, admin, or multi-user workflows'],
    ui_freedom: true,
    repo_layout: {
      stack: 'nextjs',
      pages: ['app/page.tsx or app/<route>/page.tsx for the feature surface'],
      api_routes: ['app/api/<feature>/route.ts for the primary action/readback'],
      components: ['components/<feature>/ for reusable UI'],
      shared_logic: ['lib/<feature>/ for business logic and provider calls'],
      database: ['db/schema.ts when persisted data is required'],
      tests: ['verify_user_journey or verify_interaction_contract plus verify_db_state for writes'],
      docs: ['README.md or memory/PRD.md only when handoff notes are required'],
    },
  };
}

async function finalizeOneDraft(
  draft: TaskDraftRow,
  options: FinalizeTaskDraftOptions,
): Promise<{ ok: true; task_id: string } | { ok: false; reason: string }> {
  const agentId = routeTaskStrict(draft.tag);
  if (agentId === null) return { ok: false, reason: `unknown task tag "${draft.tag}"` };

  const proposed = recordValue(draft.proposed_task);
  let executionContract = recordValue(draft.proposed_execution_contract);
  if (Object.keys(executionContract).length === 0) executionContract = {};

  const taskLike = {
    title: draft.title,
    description: draft.description,
    tag: draft.tag,
    source: draft.source,
    assigned_to_agent_id: agentId,
    execution_contract: executionContract,
  };

  if (requiresExecutionContractForEngineering(taskLike, agentId)) {
    if (Object.keys(executionContract).length === 0) {
      executionContract = buildExecutionContractFromDraft(draft, agentId);
    }
    const validation = validateExecutionContract(executionContract, { expectedAgentId: agentId });
    if (!validation.ok) return { ok: false, reason: validation.reason };
  }

  const task = await taskService.createTask({
    company_id: draft.company_id,
    title: draft.title,
    description: draft.description ?? undefined,
    tag: draft.tag,
    priority: draft.priority ?? 50,
    source: draft.source as TaskSource,
    status: 'todo',
    queue_order: numberValue(proposed.queue_order),
    assigned_to_agent_id: agentId,
    estimated_credits: numberValue(proposed.estimated_credits) ?? 1,
    max_turns: numberValue(proposed.max_turns) ?? 200,
    executability_type: executabilityValue(proposed.executability_type) ?? 'can_run_now',
    complexity: numberValue(proposed.complexity),
    estimated_hours: numberValue(proposed.estimated_hours) ?? 1,
    authorized_by: stringValue(proposed.authorized_by) ?? options.authorizedBy,
    authorization_reason: stringValue(proposed.authorization_reason) ?? options.authorizationReason,
    execution_contract: Object.keys(executionContract).length > 0 ? executionContract : null,
  });

  await markTaskDraftFinalized(draft.id, task.id);
  await eventService.emit(draft.company_id, 'task_created', {
    task_id: task.id,
    title: task.title,
    tag: task.tag,
    source: draft.source,
    draft_id: draft.id,
  });

  return { ok: true, task_id: task.id };
}
