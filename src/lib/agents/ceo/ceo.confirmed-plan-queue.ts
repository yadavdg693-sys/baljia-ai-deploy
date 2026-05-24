import type { ChatAction, ChatMessage, Task } from '@/types';
import { handleToolCall } from './ceo.tools';
import type { ToolResult } from './ceo.tools';
import * as taskService from '@/lib/services/task.service';
import * as taskDraftService from '@/lib/services/task-draft.service';
import { getCeoRollingTaskLimit } from './ceo.loop-config';
import { activeQueueCount, CEO_ROLLING_PLAN_SOURCE } from './ceo.rolling-plan';

interface ParsedPlanTask {
  index: number;
  title: string;
  description: string;
  estimatedHours: number;
  dependsOnIndexes: number[];
}

interface ConfirmedPlanQueueResult {
  text: string;
  actions: ChatAction[];
}

interface RollingPlanMetadata {
  key: string;
  product_name: string;
  one_liner: string;
  plan_index: number;
  total_tasks: number;
}

interface ExtractedBuildPlan {
  productName: string;
  oneLiner: string;
  planKey: string;
  tasks: ParsedPlanTask[];
}

type PendingPlanConfirmationAction = Extract<ChatAction, { type: 'pending_plan_confirmation' }>;

const AFFIRMATIVE_START_RE = /^(yes|yep|yeah|ok|okay|approve|approved)\b/i;
const SHORT_ACTION_CONFIRMATION_RE = /^(go|go ahead|start|start it|build it|do it|execute it|run it|launch it|proceed|continue)(?:\s+(?:please|now|then))?[.!]*$/i;
const EXPLICIT_QUEUE_RE = /\b(queue|que|queued)\b/i;
const QUEUE_TARGET_RE = /\b(tasks?|plan|batch|it|this|that|them|those|all|first|\d+)\b/i;
const PLAN_ACTION_RE = /\b(start|create|build|execute|run|launch|proceed)\b/i;
const PLAN_TARGET_RE = /\b(tasks?|plan|batch|it|this|that|them|those)\b/i;
const DO_REFERENCE_RE = /\bdo\s+(it|this|that|them|those)\b/i;
const SHORT_NUDGE_RE = /^(hey|hi|hello|\?|what happened|what happend|again|retry|try again|continue)$/i;
const QUEUE_TIMEOUT_RE = /\bqueu(?:e|ing).{0,80}\btasks?\b/i;
const QUESTION_START_RE = /^(why|what|when|where|who|how|is|are|do|does|did|will|would|should|can|could)\b/i;

function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePlanTitle(content: string): string {
  const heading = content.match(/^##\s+(.+)$/m)?.[1] ?? 'Product';
  return stripMarkdown(heading).split(/\s+(?:\u2014|\u2013|-)\s+/)[0]?.trim() || 'Product';
}

function parseOneLiner(content: string): string {
  return stripMarkdown(content.match(/\*\*One-liner:\*\*\s*(.+)/)?.[1] ?? '');
}

function parseTaskTitleAndDescription(cell: string): { title: string; description: string } {
  const cleaned = stripMarkdown(cell);
  const [titlePart, ...descriptionParts] = cleaned.split(/\s+(?:\u2014|\u2013|-)\s+/);
  const title = titlePart?.trim() || 'Build product slice';
  const description = descriptionParts.join(' - ').trim() || title;
  return { title, description };
}

function parseDependsOnIndexes(cell: string): number[] {
  const cleaned = stripMarkdown(cell);
  if (!cleaned || /^[-\u2013\u2014]+$/.test(cleaned)) return [];
  return [...cleaned.matchAll(/\d+/g)]
    .map((match) => Number(match[0]))
    .filter((index) => Number.isInteger(index) && index > 0);
}

function parseBuildPlanTasks(content: string): ParsedPlanTask[] {
  const tasks: ParsedPlanTask[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!/^\|\s*\d+\s*\|/.test(trimmed)) continue;

    const cells = trimmed.split('|').slice(1, -1).map(stripMarkdown);
    if (cells.length < 4) continue;

    const index = Number(cells[0]);
    const hours = Number(cells[2]?.match(/\d+(?:\.\d+)?/)?.[0] ?? 4);
    if (!Number.isInteger(index) || index <= 0) continue;

    const { title, description } = parseTaskTitleAndDescription(cells[1] ?? '');
    tasks.push({
      index,
      title: title.slice(0, 180),
      description,
      estimatedHours: Math.max(0.5, Math.min(4, hours)),
      dependsOnIndexes: parseDependsOnIndexes(cells[3] ?? ''),
    });
  }

  return tasks;
}

function createRollingPlanKey(productName: string, oneLiner: string, tasks: ParsedPlanTask[]): string {
  const source = [
    productName,
    oneLiner,
    ...tasks.map((task) => `${task.index}:${task.title}`),
  ].join('|');
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return `plan_${Math.abs(hash).toString(36)}`;
}

function extractBuildPlan(content: string): ExtractedBuildPlan | null {
  if (!/Build Order \(\d+ tasks/i.test(content)) return null;
  const tasks = parseBuildPlanTasks(content).sort((a, b) => a.index - b.index);
  if (tasks.length === 0) return null;

  const productName = parsePlanTitle(content);
  const oneLiner = parseOneLiner(content);
  return {
    productName,
    oneLiner,
    tasks,
    planKey: createRollingPlanKey(productName, oneLiner, tasks),
  };
}

function latestAssistantBuildPlan(sessionHistory: ChatMessage[]): ChatMessage | null {
  for (let i = sessionHistory.length - 1; i >= 0; i--) {
    const message = sessionHistory[i];
    if (message.role === 'assistant' && extractBuildPlan(message.content)) return message;
  }
  return null;
}

function hasRecentQueueTimeoutAfterPlan(sessionHistory: ChatMessage[], planMessage: ChatMessage): boolean {
  const planIndex = sessionHistory.findIndex((message) => message.id === planMessage.id);
  if (planIndex < 0) return false;
  return sessionHistory.slice(planIndex + 1).some((message) =>
    message.role === 'assistant'
    && (message.content.includes('Response timed out') || QUEUE_TIMEOUT_RE.test(message.content))
  );
}

function isClarifyingQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (/\b(right|correct)\s*\??$/.test(normalized)) return true;
  const directQueueRequest = isDirectPlanQueueRequest(normalized);
  if (directQueueRequest) return false;
  return /[?？]\s*$/.test(normalized)
    || QUESTION_START_RE.test(normalized);
}

function isDirectPlanQueueRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(queue|que)(?:[\s.!]*)$/.test(normalized)) return true;
  if (EXPLICIT_QUEUE_RE.test(normalized) && QUEUE_TARGET_RE.test(normalized)) return true;
  if (DO_REFERENCE_RE.test(normalized)) return true;
  return PLAN_ACTION_RE.test(normalized) && PLAN_TARGET_RE.test(normalized);
}

function shouldQueuePlanFromText(message: string, sessionHistory: ChatMessage[], planMessage: ChatMessage): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (isClarifyingQuestion(normalized)) return false;
  if (AFFIRMATIVE_START_RE.test(normalized)) return true;
  if (SHORT_ACTION_CONFIRMATION_RE.test(normalized)) return true;
  if (isDirectPlanQueueRequest(normalized)) return true;
  if (SHORT_NUDGE_RE.test(normalized) && hasRecentQueueTimeoutAfterPlan(sessionHistory, planMessage)) return true;
  return false;
}

function shouldOfferPlanAction(message: string, sessionHistory: ChatMessage[], planMessage: ChatMessage): boolean {
  return shouldQueuePlanFromText(message, sessionHistory, planMessage);
}

function queueButtonLabel(taskCount: number, limit: number): string {
  const count = Math.min(taskCount, limit);
  return count === taskCount
    ? `Queue ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`
    : `Queue first ${count} tasks`;
}

export function createPendingPlanConfirmationAction(content: string): PendingPlanConfirmationAction | null {
  const plan = extractBuildPlan(content);
  if (!plan) return null;
  const queueLimit = getCeoRollingTaskLimit();

  return {
    type: 'pending_plan_confirmation',
    data: {
      plan_id: plan.planKey,
      product_name: plan.productName,
      one_liner: plan.oneLiner,
      task_count: plan.tasks.length,
      queue_limit: queueLimit,
      button_label: queueButtonLabel(plan.tasks.length, queueLimit),
    },
  };
}

function isPendingPlanConfirmationAction(action: ChatAction): action is PendingPlanConfirmationAction {
  if (action.type !== 'pending_plan_confirmation') return false;
  const data = recordValue((action as { data?: unknown }).data);
  const planId = data.plan_id;
  return typeof planId === 'string' && Boolean(planId.trim());
}

export function findPendingPlanMessage(
  messages: ChatMessage[],
  planId: string,
): { message: ChatMessage; action: PendingPlanConfirmationAction } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant' || !Array.isArray(message.actions)) continue;
    const action = message.actions.find((item): item is PendingPlanConfirmationAction =>
      isPendingPlanConfirmationAction(item) && item.data.plan_id === planId
    );
    if (!action) continue;

    const plan = extractBuildPlan(message.content);
    if (plan?.planKey === planId) return { message, action };
  }
  return null;
}

export function tryOfferPendingPlanConfirmation(input: {
  message: string;
  sessionHistory: ChatMessage[];
}): ConfirmedPlanQueueResult | null {
  const planMessage = latestAssistantBuildPlan(input.sessionHistory);
  if (!planMessage) return null;
  if (!shouldOfferPlanAction(input.message, input.sessionHistory, planMessage)) return null;

  const action = createPendingPlanConfirmationAction(planMessage.content);
  if (!action) return null;

  return {
    text: `I have the ${action.data.product_name} build plan ready. Reply go or use the button below to queue the rolling batch.`,
    actions: [action],
  };
}

function contractForPlanTask(
  task: ParsedPlanTask,
  productName: string,
  oneLiner: string,
  totalTasks: number,
  rollingPlan: RollingPlanMetadata,
) {
  const scope = `${productName}: ${task.title}. ${task.description}`;
  return {
    version: 1,
    intent: task.index === 1 ? 'new_app' : 'feature',
    assigned_agent_id: 30,
    confirmation_source: 'founder_confirmed',
    founder_visible_summary: task.title,
    product_scope: scope,
    assumptions: [
      oneLiner || `${productName} is the product the founder confirmed in chat.`,
      `This is task ${task.index} of ${totalTasks} in the confirmed build plan.`,
      'Follow the existing Baljia generated-app skeleton, repo layout, auth, database, and deploy conventions.',
    ],
    open_questions: [],
    user_flow: [
      `A target user can complete the ${task.title.toLowerCase()} flow from the app UI.`,
      'The founder can verify the feature from the deployed dashboard or product route.',
    ],
    screens: [
      'Public/product landing surface',
      'Authenticated app dashboard',
      `${task.title} screen or section`,
    ],
    data_fields: [
      'user_id',
      'company_id',
      'created_at',
      'updated_at',
      `${task.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'feature'}_state`,
    ],
    api_actions: [
      `Create or update persisted records needed for ${task.title}.`,
      `Read persisted records needed to render ${task.title}.`,
      'Return typed errors for missing auth, invalid input, and failed persistence.',
    ],
    integrations: inferIntegrations(task),
    acceptance_criteria: [
      `${task.title} is implemented end-to-end in the app, not only mocked UI.`,
      'The feature persists the required state in the database where persistence is in scope.',
      'The deployed or local app path is verified through a browser/user-flow check.',
      'The engineering report includes what changed, how it was verified, and any remaining limitations.',
    ],
    out_of_scope: [
      'Do not broaden this task beyond its row in the confirmed build plan.',
      'Do not implement unrelated product modules from later dependent tasks.',
    ],
    ui_freedom: true,
    rolling_plan: rollingPlan,
    repo_layout: {
      stack: 'nextjs',
      pages: ['app/page.tsx', 'app/dashboard/page.tsx or app/<feature>/page.tsx'],
      api_routes: ['app/api/<feature>/route.ts', 'app/api/<feature>/<id>/route.ts when needed'],
      components: ['components/ui/', 'components/<feature>/'],
      shared_logic: ['lib/<feature>/', 'lib/auth.ts and lib/db.ts only when extending existing patterns'],
      database: ['db/schema.ts for Drizzle schema changes'],
      tests: ['tests/e2e/ when existing test structure is present', 'deployed URL + DB proof for final verification'],
      docs: ['memory/PRD.md or README.md only if needed for handoff'],
    },
  };
}

function inferIntegrations(task: ParsedPlanTask): string[] {
  const text = `${task.title} ${task.description}`.toLowerCase();
  const integrations: string[] = [];
  if (/\blinkedin|indeed|glassdoor|greenhouse|lever|workable|job board|job portal/.test(text)) {
    integrations.push('Job board or ATS integration where allowed by terms and available APIs.');
  }
  if (/\bpayment|paid|subscription|stripe|razorpay|free tier|billing/.test(text)) {
    integrations.push('Payment provider integration using the founder-connected account.');
  }
  if (/\bai|tailor|resume|cover letter|parse|matching/.test(text)) {
    integrations.push('AI provider for parsing, matching, and generation with timeout/fallback handling.');
  }
  return integrations;
}

function toolActions(result: ToolResult): ChatAction[] {
  return [
    ...(result.action ? [result.action] : []),
    ...(result.actions ?? []),
  ];
}

function taskProposalActions(actions: ChatAction[]): Extract<ChatAction, { type: 'task_proposal' }>[] {
  return actions.filter((action): action is Extract<ChatAction, { type: 'task_proposal' }> =>
    action.type === 'task_proposal'
  );
}

function taskInputForPlanTask(
  task: ParsedPlanTask,
  productName: string,
  oneLiner: string,
  totalTasks: number,
  planKey: string,
) {
  const rollingPlan: RollingPlanMetadata = {
    key: planKey,
    product_name: productName,
    one_liner: oneLiner,
    plan_index: task.index,
    total_tasks: totalTasks,
  };

  return {
    title: task.title,
    description: `${task.description}\n\nProduct context: ${oneLiner || productName}`,
    tag: 'engineering',
    source: CEO_ROLLING_PLAN_SOURCE,
    complexity: task.estimatedHours >= 4 ? 8 : 6,
    estimated_hours: task.estimatedHours,
    priority: task.index === 1 ? 'high' : 'medium',
    depends_on_indexes: task.dependsOnIndexes,
    execution_contract: contractForPlanTask(task, productName, oneLiner, totalTasks, rollingPlan),
    rolling_plan: rollingPlan,
  };
}

async function createQueuedPlanTasks(input: {
  companyId: string;
  tasks: ParsedPlanTask[];
  productName: string;
  oneLiner: string;
  totalTasks: number;
  planKey: string;
}): Promise<{
  result: ToolResult;
  createdPlanIds: Map<number, string>;
  uncreatedTasks: ParsedPlanTask[];
}> {
  const actions: ChatAction[] = [];
  const content: string[] = [];
  const createdPlanIds = new Map<number, string>();
  const uncreatedTasks: ParsedPlanTask[] = [];

  for (const task of input.tasks) {
    const taskInput = taskInputForPlanTask(
      task,
      input.productName,
      input.oneLiner,
      input.totalTasks,
      input.planKey,
    );
    const relatedTaskIds = task.dependsOnIndexes
      .map((index) => createdPlanIds.get(index))
      .filter((id): id is string => Boolean(id));

    const result = await handleToolCall('create_task', {
      ...taskInput,
      related_task_ids: relatedTaskIds.length > 0 ? relatedTaskIds : undefined,
    }, input.companyId);
    if (result.content) content.push(result.content);

    const taskActions = toolActions(result);
    actions.push(...taskActions);
    const createdAction = taskProposalActions(taskActions)[0];
    if (createdAction) {
      createdPlanIds.set(task.index, createdAction.data.task_id);
    } else {
      uncreatedTasks.push(task);
    }
  }

  return {
    result: {
      content: content.join('\n\n'),
      actions: actions.length > 0 ? actions : undefined,
    },
    createdPlanIds,
    uncreatedTasks,
  };
}

async function parkRollingPlanTasks(input: {
  companyId: string;
  tasks: ParsedPlanTask[];
  productName: string;
  oneLiner: string;
  totalTasks: number;
  planKey: string;
  createdPlanIds: Map<number, string>;
}): Promise<number> {
  let parked = 0;
  for (const task of input.tasks) {
    const taskInput = taskInputForPlanTask(
      task,
      input.productName,
      input.oneLiner,
      input.totalTasks,
      input.planKey,
    );
    const existingRelatedIds = task.dependsOnIndexes
      .map((index) => input.createdPlanIds.get(index))
      .filter((id): id is string => Boolean(id));

    await taskDraftService.createTaskDraft({
      company_id: input.companyId,
      title: taskInput.title,
      description: taskInput.description,
      tag: taskInput.tag,
      priority: taskInput.priority === 'high' ? 80 : 50,
      source: CEO_ROLLING_PLAN_SOURCE,
      status: 'pending_ceo_review',
      suggestion_reasoning: `CEO rolling plan parked task ${task.index} of ${input.totalTasks} until the active queue has capacity.`,
      proposed_task: {
        title: taskInput.title,
        description: taskInput.description,
        tag: taskInput.tag,
        complexity: taskInput.complexity,
        estimated_hours: taskInput.estimated_hours,
        priority: taskInput.priority === 'high' ? 80 : 50,
        related_task_ids: existingRelatedIds,
        depends_on_plan_indexes: task.dependsOnIndexes,
        authorized_by: 'founder',
        authorization_reason: 'CEO rolling plan queued after founder confirmation.',
        rolling_plan: taskInput.rolling_plan,
      },
      proposed_execution_contract: taskInput.execution_contract,
    });
    parked++;
  }
  return parked;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function rollingPlanKeyFromTask(task: Pick<Task, 'execution_contract'> | Record<string, unknown>): string | undefined {
  const contract = recordValue('execution_contract' in task ? task.execution_contract : undefined);
  const rollingPlan = recordValue(contract.rolling_plan);
  return stringValue(rollingPlan.key);
}

function rollingPlanKeyFromDraft(draft: { proposed_task?: unknown }): string | undefined {
  const proposed = recordValue(draft.proposed_task);
  const rollingPlan = recordValue(proposed.rolling_plan);
  return stringValue(rollingPlan.key);
}

function actionForExistingTask(task: Task | Record<string, unknown>): ChatAction {
  return {
    type: 'task_proposal',
    data: {
      task_id: String('id' in task ? task.id : ''),
      title: String('title' in task ? task.title : 'Queued task'),
      description: ('description' in task && typeof task.description === 'string') ? task.description : null,
      tag: ('tag' in task && typeof task.tag === 'string') ? task.tag : 'engineering',
      estimated_credits: ('estimated_credits' in task && typeof task.estimated_credits === 'number') ? task.estimated_credits : 1,
      priority: ('priority' in task && typeof task.priority === 'number') ? task.priority : 50,
      agent_name: 'Engineering',
    },
  };
}

export async function queueConfirmedBuildPlan(input: {
  companyId: string;
  planContent: string;
}): Promise<ConfirmedPlanQueueResult | null> {
  const plan = extractBuildPlan(input.planContent);
  if (!plan) return null;

  const rollingLimit = getCeoRollingTaskLimit();
  const currentTasks = await taskService.getTasks(input.companyId);
  const pendingRollingDrafts = await taskDraftService.getPendingTaskDraftsForSources(input.companyId, [CEO_ROLLING_PLAN_SOURCE]);
  const existingPlanTasks = currentTasks.filter((task) => rollingPlanKeyFromTask(task) === plan.planKey);
  const existingPlanDrafts = pendingRollingDrafts.filter((draft) => rollingPlanKeyFromDraft(draft) === plan.planKey);

  if (existingPlanTasks.length > 0 || existingPlanDrafts.length > 0) {
    const taskWord = existingPlanTasks.length === 1 ? 'task' : 'tasks';
    const draftWord = existingPlanDrafts.length === 1 ? 'draft' : 'drafts';
    return {
      text: `${plan.productName} is already in the rolling queue: ${existingPlanTasks.length} ${taskWord} active/created and ${existingPlanDrafts.length} parked ${draftWord}. I did not create duplicates.`,
      actions: existingPlanTasks.map(actionForExistingTask),
    };
  }

  const activeCount = activeQueueCount(currentTasks);
  const availableSlots = Math.max(0, rollingLimit - activeCount);
  const tasksToQueue = plan.tasks.slice(0, availableSlots);
  const tasksToPark = plan.tasks.slice(tasksToQueue.length);

  let result: ToolResult = { content: '' };
  let createdPlanIds = new Map<number, string>();
  let uncreatedTasks: ParsedPlanTask[] = [];
  if (tasksToQueue.length > 0) {
    const queuedResult = await createQueuedPlanTasks({
      companyId: input.companyId,
      tasks: tasksToQueue,
      productName: plan.productName,
      oneLiner: plan.oneLiner,
      totalTasks: plan.tasks.length,
      planKey: plan.planKey,
    });
    result = queuedResult.result;
    createdPlanIds = queuedResult.createdPlanIds;
    uncreatedTasks = queuedResult.uncreatedTasks;
  }

  const actions = toolActions(result);
  const createdCount = taskProposalActions(actions).length;
  const parkedCount = await parkRollingPlanTasks({
    companyId: input.companyId,
    tasks: [...uncreatedTasks, ...tasksToPark],
    productName: plan.productName,
    oneLiner: plan.oneLiner,
    totalTasks: plan.tasks.length,
    planKey: plan.planKey,
    createdPlanIds,
  });

  const activeNote = activeCount > 0
    ? ` ${activeCount} tasks already active, so I used ${tasksToQueue.length} of ${rollingLimit} rolling slots.`
    : ` Rolling queue cap is ${rollingLimit}.`;
  const parkedNote = parkedCount > 0
    ? ` I parked ${parkedCount} for the next batch.`
    : '';
  const prefix = createdCount > 0
    ? `${parkedCount > 0 ? 'Queued first' : 'Queued'} ${createdCount} ${plan.productName} tasks.`
    : `No new ${plan.productName} tasks queued right now.`;

  return {
    text: `${prefix}${activeNote}${parkedNote}${result.content ? `\n\n${result.content}` : ''}`,
    actions,
  };
}

export async function tryQueueConfirmedBuildPlan(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): Promise<ConfirmedPlanQueueResult | null> {
  const planMessage = latestAssistantBuildPlan(input.sessionHistory);
  if (!planMessage) return null;
  if (!shouldQueuePlanFromText(input.message, input.sessionHistory, planMessage)) return null;

  return queueConfirmedBuildPlan({
    companyId: input.companyId,
    planContent: planMessage.content,
  });
}

export const __confirmedPlanQueueTest = {
  parseBuildPlanTasks,
  extractBuildPlan,
};
