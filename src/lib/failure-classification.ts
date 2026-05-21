import type { FailureClass } from '@/types';

export function hasRenderPipelineQuotaSignal(message: string): boolean {
  return /RENDER_INFRASTRUCTURE_BLOCKER:\s*pipeline_minutes_exhausted/i.test(message) ||
    /RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED/i.test(message) ||
    /\bpipeline[-_\s]?minutes[-_\s]?exhausted\b/i.test(message) ||
    /\bRender\b.*\b(?:build|pipeline)[-\s]?minutes?\b.*\b(?:exhausted|quota|limit)\b/i.test(message);
}

export function classifyFailureMessage(errorMessage: string): FailureClass {
  const msg = errorMessage.toLowerCase();

  if (hasRenderPipelineQuotaSignal(errorMessage)) return 'external_block';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('idle') || msg.includes('stall')) return 'timeout';
  if (msg.includes('credential') || msg.includes('oauth') || msg.includes('api key') || msg.includes('token expired') || msg.includes('auth')) return 'connector_failure';
  if (msg.includes('external') || msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('503') || msg.includes('502')) return 'external_block';
  if (msg.includes('scope') || msg.includes('too large') || msg.includes('split') || msg.includes('decompos')) return 'scope_overflow';
  if (msg.includes('tool') || msg.includes('rpc') || msg.includes('not supported') || msg.includes('capability')) return 'capability_miss';
  if (msg.includes('policy') || msg.includes('content safety') || msg.includes('guardrail') || msg.includes('blocked')) return 'policy_violation';
  if (msg.includes('verification') || msg.includes('verifier') || msg.includes('quality check')) return 'verification_reject';

  return 'infra_error';
}
