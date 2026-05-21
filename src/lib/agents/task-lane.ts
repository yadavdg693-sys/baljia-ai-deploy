import type { ExecutionMode, Task, VerificationLevel } from '@/types';
import { classifyPlanningDepth, type PlanningDepth } from './planning-depth';
import { stripPlanningHarnessMetadata } from './planning-text';
import { classifyTaskIntent, type TaskIntent } from './task-intent';

export type TaskLane = 'fast' | 'standard' | 'strict' | 'canary';

export const TASK_LANE_HARD_MAX_TURNS = 200;

export interface TaskLanePolicy {
  lane: TaskLane;
  rank: number;
  defaultComplexity: number;
  defaultExecutionMode: ExecutionMode;
  defaultVerificationLevel: VerificationLevel;
  defaultEstimatedCredits: number;
  maxTurns: number;
  maxRepairAttempts: number;
  costCeilingUsd: number | 'complexity';
  completion: {
    maxTotalFinalizationContinuations: number;
    maxSameGateReasonContinuations: number;
    requireReferenceRetrieval: boolean;
    requireDesignCritique: boolean;
    requireFinalReport: boolean;
  };
}

type TaskLaneInput = Pick<Task,
  'title' | 'description' | 'tag' | 'source' |
  'complexity' | 'execution_mode' | 'verification_level' |
  'estimated_credits' | 'max_turns'
> | {
  title?: string | null;
  description?: string | null;
  tag?: string | null;
  source?: string | null;
  complexity?: number | null;
  execution_mode?: ExecutionMode | null;
  verification_level?: VerificationLevel | null;
  estimated_credits?: number | null;
  max_turns?: number | null;
};

export interface TaskLaneContext {
  logEntries?: Array<Record<string, unknown>>;
  selectedCapabilities?: string[];
  riskSignals?: string[];
  planningDepth?: PlanningDepth | null;
  taskIntent?: TaskIntent | null;
}

export const TASK_LANE_POLICIES: Record<TaskLane, TaskLanePolicy> = {
  fast: {
    lane: 'fast',
    rank: 0,
    defaultComplexity: 1,
    defaultExecutionMode: 'template_plus_params',
    defaultVerificationLevel: 'deterministic',
    defaultEstimatedCredits: 1,
    maxTurns: 150,
    maxRepairAttempts: 1,
    costCeilingUsd: 0.35,
    completion: {
      maxTotalFinalizationContinuations: 3,
      maxSameGateReasonContinuations: 1,
      requireReferenceRetrieval: false,
      requireDesignCritique: false,
      requireFinalReport: false,
    },
  },
  standard: {
    lane: 'standard',
    rank: 1,
    defaultComplexity: 3,
    defaultExecutionMode: 'full_agent',
    defaultVerificationLevel: 'browser_flow',
    defaultEstimatedCredits: 1,
    maxTurns: 150,
    maxRepairAttempts: 2,
    costCeilingUsd: 2.5,
    completion: {
      maxTotalFinalizationContinuations: 8,
      maxSameGateReasonContinuations: 2,
      requireReferenceRetrieval: false,
      requireDesignCritique: false,
      requireFinalReport: true,
    },
  },
  strict: {
    lane: 'strict',
    rank: 2,
    defaultComplexity: 6,
    defaultExecutionMode: 'full_agent',
    defaultVerificationLevel: 'hybrid',
    defaultEstimatedCredits: 2,
    maxTurns: 150,
    maxRepairAttempts: 3,
    costCeilingUsd: 7,
    completion: {
      maxTotalFinalizationContinuations: 16,
      maxSameGateReasonContinuations: 3,
      requireReferenceRetrieval: true,
      requireDesignCritique: true,
      requireFinalReport: true,
    },
  },
  canary: {
    lane: 'canary',
    rank: 3,
    defaultComplexity: 10,
    defaultExecutionMode: 'full_agent',
    defaultVerificationLevel: 'hybrid',
    defaultEstimatedCredits: 3,
    maxTurns: 150,
    maxRepairAttempts: 100,
    costCeilingUsd: 'complexity',
    completion: {
      maxTotalFinalizationContinuations: 24,
      maxSameGateReasonContinuations: 5,
      requireReferenceRetrieval: true,
      requireDesignCritique: true,
      requireFinalReport: true,
    },
  },
};

const CANARY_TAG_RE = /\b(engineering-canary|canary-eval|canary-runner|render-canary)\b/i;
const STRICT_RE = /\b(auth|oauth|sign[- ]?in|signup|login|session|password|permission|role|security|stripe|payment|billing|checkout|subscription|invoice|refund|migration|schema change|drop table|delete data|destructive|personal data|pii|webhook|external api|integration|rag|embedding|vector|multi[- ]?tenant|workspace|organization|production incident)\b/i;
const STANDARD_RE = /\b(app|portal|dashboard|crm|store|shop|website|booking|scheduler|cms|inventory|course|admin panel|full[- ]?stack|mvp|deploy|render|database|postgres|crud|upload|notification|analytics|ai)\b/i;
const FAST_RE = /\b(copy|text|label|style|color|spacing|button|small|single|one|narrow|typo|css|visual|polish|endpoint|api route|field|form|bug|fix|repair)\b/i;
const BROAD_REPAIR_RE = /\b(rebuild|redesign|refactor|architecture|multiple pages|all pages|whole app|end-to-end|full flow|platform)\b/i;
const EXPLICIT_REPORT_RE = /\b(report|write[- ]?up|summary artifact|create_report)\b/i;
const EXPLICIT_REFERENCE_RE = /\b(reference repo|github reference|retrieve reference|component examples|world[- ]class)\b/i;
const EXPLICIT_CRITIQUE_RE = /\b(design_critique|vision critique|critique the design|visual critique)\b/i;

const RISK_CAPABILITIES = new Set([
  'auth',
  'roles',
  'payments_stripe',
  'uploads_storage',
  'ai_openai',
  'rag_search',
  'marketplace',
  'admin_workflow',
  'email_notifications',
  'analytics',
  'realtime',
  'cron_jobs',
  'background_jobs',
  'external_api',
]);

const STANDARD_CAPABILITIES = new Set([
  'crud',
  'dashboard',
  'booking',
  'deployment_render',
]);

export function classifyTaskLane(input: TaskLaneInput | undefined, context: TaskLaneContext = {}): TaskLane {
  const text = laneText(input, context);
  const explicitCanaryScope = `${input?.tag ?? ''}\n${input?.source ?? ''}`;
  if (CANARY_TAG_RE.test(explicitCanaryScope) || context.planningDepth === 'canary_world_class') return 'canary';
  const description = stripPlanningHarnessMetadata(input?.description);

  const taskIntent = context.taskIntent ?? classifyTaskIntent({
    title: input?.title,
    description,
    tag: input?.tag,
  }).intent;
  const taskIntentLane = classifyTaskIntent({
    title: input?.title,
    description,
    tag: input?.tag,
  }).lane;
  const planningDepth = context.planningDepth ?? classifyPlanningDepth({
    title: input?.title,
    description,
    tag: input?.tag,
    taskIntent,
    taskIntentLane,
    selectedCapabilities: context.selectedCapabilities,
  }).depth;

  const capabilities = new Set([
    ...(context.selectedCapabilities ?? []),
    ...extractCapabilityMarkers(context.logEntries ?? []),
  ]);
  const hasRiskCapability = [...capabilities].some((capability) => RISK_CAPABILITIES.has(capability));
  const hasStandardCapability = [...capabilities].some((capability) => STANDARD_CAPABILITIES.has(capability));
  const riskSignalCount = new Set([
    ...(context.riskSignals ?? []),
    ...extractRiskMarkers(context.logEntries ?? []),
  ]).size;

  if (
    STRICT_RE.test(text) ||
    hasRiskCapability ||
    riskSignalCount >= 2 ||
    planningDepth === 'mixed_complex_app' ||
    (typeof input?.complexity === 'number' && input.complexity >= 6)
  ) {
    return 'strict';
  }

  const focusedFastIntent =
    taskIntent === 'focused_repair' ||
    taskIntent === 'ui_polish' ||
    taskIntent === 'api_contract_fix' ||
    taskIntent === 'verification_only';

  if (
    planningDepth === 'simple_feature' &&
    !BROAD_REPAIR_RE.test(text) &&
    (focusedFastIntent || FAST_RE.test(text) || (typeof input?.complexity === 'number' && input.complexity <= 2)) &&
    !hasStandardCapability
  ) {
    return 'fast';
  }

  if (planningDepth === 'existing_app_extension' || planningDepth === 'standard_app' || STANDARD_RE.test(text) || hasStandardCapability) {
    return 'standard';
  }

  return FAST_RE.test(text) ? 'fast' : 'standard';
}

export function getTaskLanePolicy(input: TaskLaneInput | undefined, context: TaskLaneContext = {}): TaskLanePolicy {
  return TASK_LANE_POLICIES[classifyTaskLane(input, context)];
}

export function getTaskLaneLabel(input: TaskLaneInput | undefined, context: TaskLaneContext = {}): string {
  const policy = getTaskLanePolicy(input, context);
  return `${policy.lane} lane`;
}

export function applyTaskLaneCreateDefaults<T extends {
  title?: string | null;
  description?: string | null;
  tag?: string | null;
  source?: string | null;
  assigned_to_agent_id?: number | null;
  complexity?: number | null;
  execution_mode?: ExecutionMode | null;
  verification_level?: VerificationLevel | null;
  estimated_credits?: number | null;
  max_turns?: number | null;
}>(input: T): T {
  if (!shouldApplyEngineeringLaneDefaults(input)) return input;
  const policy = getTaskLanePolicy(input);
  return {
    ...input,
    complexity: input.complexity ?? policy.defaultComplexity,
    execution_mode: input.execution_mode ?? policy.defaultExecutionMode,
    verification_level: input.verification_level ?? policy.defaultVerificationLevel,
    estimated_credits: input.estimated_credits ?? policy.defaultEstimatedCredits,
    max_turns: capLaneMaxTurns(input.max_turns ?? policy.maxTurns),
  };
}

export function applyTaskLaneRuntimePolicy<T extends TaskLaneInput>(input: T, agentId: number): T {
  if (agentId !== 30) return input;
  const policy = getTaskLanePolicy(input);
  return {
    ...input,
    complexity: input.complexity ?? policy.defaultComplexity,
    execution_mode: input.execution_mode ?? policy.defaultExecutionMode,
    verification_level: input.verification_level ?? policy.defaultVerificationLevel,
    estimated_credits: input.estimated_credits ?? policy.defaultEstimatedCredits,
    max_turns: capLaneMaxTurns(policy.lane === 'canary'
      ? (input.max_turns ?? policy.maxTurns)
      : Math.min(input.max_turns ?? policy.maxTurns, policy.maxTurns)),
  };
}

export function formatTaskLaneBriefing(input: TaskLaneInput): string {
  const policy = getTaskLanePolicy(input);
  const lines = [
    '## Task Lane Policy',
    `- Lane: ${policy.lane}`,
    `- Max turns: ${policy.maxTurns}`,
    `- Repair attempts: ${policy.maxRepairAttempts}`,
  ];

  if (policy.lane === 'fast') {
    lines.push(
      '- Focus: patch the requested surface and prove the targeted behavior.',
      '- Do not run reference retrieval, design_critique, or create_report unless this task explicitly asks for them or the lane is promoted by risk evidence.',
      '- Completion proof: latest code/deploy evidence plus the relevant health, journey, browser UI, DB, scan, or review check for the changed surface.',
    );
  } else if (policy.lane === 'standard') {
    lines.push(
      '- Focus: normal app/feature delivery with deploy, logs, health, user journey, and UI/DB proof when relevant.',
      '- Use reference retrieval or design_critique only when the task shape actually needs it.',
    );
  } else if (policy.lane === 'strict') {
    lines.push(
      '- Focus: high-risk delivery. Auth, payments, security, migrations, external integrations, RAG, and broad repairs require stricter planning and verification.',
      '- Keep full quality gates, but stop after clean evidence instead of adding optional polish.',
    );
  } else {
    lines.push(
      '- Focus: canary/world-class run. Keep the full current canary gates, replay discipline, final report, and no fake success.',
    );
  }

  return lines.join('\n');
}

export function engineeringLaneToolGate(
  toolName: string,
  logEntries: Record<string, unknown>[],
  task?: TaskLaneInput,
): string | null {
  const policy = getTaskLanePolicy(task, { logEntries });
  if (policy.lane !== 'fast') return null;

  const text = laneText(task);
  const hasExternalBlocker = logEntries.some((entry) =>
    typeof entry.result === 'string' &&
    /RENDER_INFRASTRUCTURE_BLOCKER|pipeline[-_\s]?minutes[-_\s]?exhausted|external blocker/i.test(entry.result)
  );
  const previousCritiqueBlocker = logEntries.some((entry) =>
    entry.tool === 'design_critique' &&
    typeof entry.result === 'string' &&
    /\bBLOCKER\b/i.test(entry.result)
  );

  if (
    (toolName === 'match_reference_repos' || toolName === 'get_reference_repo_patterns' || toolName === 'retrieve_component_examples') &&
    !EXPLICIT_REFERENCE_RE.test(text)
  ) {
    return [
      `LANE_TOOL_GATE: fast lane blocked optional reference retrieval tool \`${toolName}\`.`,
      'Use existing-code context, the one relevant capability pack, and a narrow architecture/repair plan instead.',
      'If the task has promoted to standard/strict/canary, make that risk explicit in match_capabilities or the task description.',
    ].join('\n');
  }

  if (toolName === 'design_critique' && !previousCritiqueBlocker && !EXPLICIT_CRITIQUE_RE.test(text)) {
    return [
      'LANE_TOOL_GATE: fast lane does not require `design_critique`.',
      'Use `verify_browser_ui` and `design_audit` for the changed UI surface. Finish after the required checks pass.',
    ].join('\n');
  }

  if (toolName === 'create_report' && !EXPLICIT_REPORT_RE.test(text) && !hasExternalBlocker) {
    return [
      'LANE_TOOL_GATE: fast lane does not require `create_report`.',
      'Do not spend turns creating a report for a narrow repair. Finish once the targeted verification evidence is clean.',
    ].join('\n');
  }

  return null;
}

function shouldApplyEngineeringLaneDefaults(input: {
  tag?: string | null;
  assigned_to_agent_id?: number | null;
}): boolean {
  if (input.assigned_to_agent_id === 30) return true;
  const tag = (input.tag ?? '').toLowerCase().trim();
  return [
    'engineering',
    'feature',
    'complex-feature',
    'mvp',
    'full-crud',
    'auth',
    'landing-page',
    'dashboard',
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
    'pricing-page',
    'billing',
    'payment',
    'integration',
    'deploy',
    'engineering-canary',
  ].includes(tag);
}

function capLaneMaxTurns(maxTurns: number): number {
  return Math.min(maxTurns, TASK_LANE_HARD_MAX_TURNS);
}

function laneText(input?: TaskLaneInput, context: TaskLaneContext = {}): string {
  const taskText = `${input?.title ?? ''}\n${stripPlanningHarnessMetadata(input?.description)}\n${input?.tag ?? ''}\n${input?.source ?? ''}`;
  const logText = (context.logEntries ?? [])
    .map((entry) => `${String(entry.tool ?? '')}\n${typeof entry.result === 'string' ? entry.result : ''}`)
    .join('\n');
  return `${taskText}\n${logText}`;
}

function extractCapabilityMarkers(logEntries: Array<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const entry of logEntries) {
    const result = typeof entry.result === 'string' ? entry.result : '';
    const lines = result.match(/(?:CAPABILITY_MATCH_EVIDENCE|ARCHITECTURE_PLAN_EVIDENCE)[^\n]*/g) ?? [];
    for (const line of lines) {
      const fields = line.match(/(?:selected|required|capabilities)=([a-z0-9_, -]+)/gi) ?? [];
      for (const field of fields) {
        const value = field.split('=').slice(1).join('=');
        ids.push(...value.split(',').map((part) => part.trim()).filter(Boolean));
      }
    }
  }
  return [...new Set(ids)];
}

function extractRiskMarkers(logEntries: Array<Record<string, unknown>>): string[] {
  const risks: string[] = [];
  for (const entry of logEntries) {
    const result = typeof entry.result === 'string' ? entry.result : '';
    const line = result.match(/PLANNING_DEPTH_EVIDENCE[^\n]*/i)?.[0];
    if (!line) continue;
    const riskPart = line.match(/\brisks=([a-z0-9_, -]+)/i)?.[1];
    if (riskPart) risks.push(...riskPart.split(',').map((part) => part.trim()).filter(Boolean));
  }
  return [...new Set(risks)];
}
