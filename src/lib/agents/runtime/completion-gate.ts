import type { Task } from '@/types';
import { getTaskLanePolicy } from '../task-lane';

export const MAX_FORCED_CONTINUATIONS = 8;
export const MAX_TOTAL_FINALIZATION_CONTINUATIONS = 24;
export const MAX_SAME_GATE_REASON_CONTINUATIONS = 5;

export interface GateState {
  forcedContinuations: number;
  totalForcedContinuations?: number;
  lastGateReasonKey?: string;
  sameGateReasonContinuations?: number;
}

export interface GateEvaluationInput {
  agentId: number;
  logEntries: Record<string, unknown>[];
  task: Task;
  turnCount: number;
  state: GateState;
  gate: (agentId: number, logEntries: Record<string, unknown>[], task: Task) => string | null;
  pushLog: (logs: Record<string, unknown>[], entry: Record<string, unknown>) => void;
}

export function evaluateGateOnExit(input: GateEvaluationInput): { shouldBreak: boolean; gateMessage: string | null } {
  const gateReason = input.gate(input.agentId, input.logEntries, input.task);
  if (!gateReason) return { shouldBreak: true, gateMessage: null };

  const policy = getTaskLanePolicy(input.task, { logEntries: input.logEntries });
  const maxTotalContinuations = policy.completion.maxTotalFinalizationContinuations;
  const maxSameReasonContinuations = policy.completion.maxSameGateReasonContinuations;

  input.state.forcedContinuations += 1;
  input.state.totalForcedContinuations = (input.state.totalForcedContinuations ?? 0) + 1;

  const reasonKey = completionGateReasonKey(gateReason);
  input.state.sameGateReasonContinuations = input.state.lastGateReasonKey === reasonKey
    ? (input.state.sameGateReasonContinuations ?? 0) + 1
    : 1;
  input.state.lastGateReasonKey = reasonKey;

  const keepGoing =
    input.state.totalForcedContinuations <= maxTotalContinuations &&
    input.state.sameGateReasonContinuations <= maxSameReasonContinuations;

  if (keepGoing) {
    input.pushLog(input.logEntries, {
      turn: input.turnCount,
      event: 'completion_gate_block',
      reason: gateReason.slice(0, 300),
      attempt: input.state.totalForcedContinuations,
      reason_key: reasonKey,
      lane: policy.lane,
      max_attempts: maxTotalContinuations,
    });
    return { shouldBreak: false, gateMessage: formatGateContinuation(gateReason) };
  }

  input.pushLog(input.logEntries, {
    turn: input.turnCount,
    event: 'completion_gate_exhausted',
    reason: gateReason.slice(0, 300),
    attempts: input.state.totalForcedContinuations,
    reason_key: reasonKey,
    lane: policy.lane,
    max_attempts: maxTotalContinuations,
  });
  return { shouldBreak: true, gateMessage: null };
}

function completionGateReasonKey(reason: string): string {
  if (/match_capabilities|capability plan/i.test(reason)) return 'match_capabilities';
  if (/list_skills|read_skill/i.test(reason)) return 'skill_discovery';
  if (/static_code_scan/i.test(reason)) return 'static_code_scan';
  if (/review_pushed_code/i.test(reason)) return 'review_pushed_code';
  if (/render_get_logs/i.test(reason)) return 'render_get_logs';
  if (/check_url_health/i.test(reason)) return 'check_url_health';
  if (/verify_user_journey/i.test(reason)) return 'verify_user_journey';
  if (/verify_db_state/i.test(reason)) return 'verify_db_state';
  if (/verify_browser_ui/i.test(reason)) return 'verify_browser_ui';
  if (/verify_interaction_contract|interaction contract/i.test(reason)) return 'verify_interaction_contract';
  if (/design_audit/i.test(reason)) return 'design_audit';
  if (/design_critique/i.test(reason)) return 'design_critique';
  if (/write_codebase_map/i.test(reason)) return 'write_codebase_map';
  if (/create_report/i.test(reason)) return 'create_report';
  if (/get_capability_pack|capability pack/i.test(reason)) return 'capability_pack';
  if (/compose_app_architecture/i.test(reason)) return 'architecture_plan';
  return reason.toLowerCase().replace(/`[^`]+`/g, '').replace(/[^a-z0-9]+/g, '_').slice(0, 80) || 'unknown';
}

function formatGateContinuation(reason: string): string {
  const nextTool = suggestedToolForGateReason(reason);
  return [
    'COMPLETION_GATE_BLOCKED.',
    nextTool
      ? `Your next assistant response must call the \`${nextTool}\` tool. Do not answer in prose and do not repeat earlier discovery tools.`
      : 'Your next assistant response must call the missing verification/planning tool named below. Do not answer in prose.',
    `Blocker: ${reason}`,
  ].join('\n');
}

function suggestedToolForGateReason(reason: string): string | null {
  const explicitTool = reason.match(/`([a-z][a-z0-9_]+)`/i)?.[1];
  if (explicitTool) return explicitTool;
  const knownTools = [
    'match_capabilities',
    'get_capability_pack',
    'compose_app_architecture',
    'render_get_logs',
    'check_url_health',
    'verify_user_journey',
    'verify_db_state',
    'verify_browser_ui',
    'verify_interaction_contract',
    'static_code_scan',
    'review_pushed_code',
    'design_audit',
    'design_critique',
    'write_codebase_map',
    'create_report',
  ];
  return knownTools.find((tool) => reason.includes(tool)) ?? null;
}
