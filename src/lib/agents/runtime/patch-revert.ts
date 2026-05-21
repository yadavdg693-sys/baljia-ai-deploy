export interface PatchCheckpoint {
  starting_commit?: string | null;
  last_good_commit?: string | null;
  task_commit_range?: string | null;
  failed_commit?: string | null;
  rollback_available: boolean;
  rollback_confidence: 'none' | 'low' | 'medium' | 'high';
}

export interface RevertDecision {
  action: 'repair_first' | 'rollback_allowed' | 'rollback_blocked';
  reason: string;
}

export function decideRevertStrategy(input: {
  checkpoint: PatchCheckpoint;
  severeVerificationFailure: boolean;
  touchedSharedSchema?: boolean;
}): RevertDecision {
  if (!input.severeVerificationFailure) {
    return {
      action: 'repair_first',
      reason: 'Verification did not fail severely; prefer a focused repair plan before rollback.',
    };
  }
  if (!input.checkpoint.rollback_available || input.checkpoint.rollback_confidence !== 'high') {
    return {
      action: 'rollback_blocked',
      reason: 'Rollback metadata is incomplete or low-confidence; produce a repair plan instead of reverting automatically.',
    };
  }
  if (input.touchedSharedSchema) {
    return {
      action: 'repair_first',
      reason: 'Shared schema changed; partial rollback may corrupt app state, so repair must be attempted first.',
    };
  }
  return {
    action: 'rollback_allowed',
    reason: 'Severe verification failure with high-confidence rollback metadata.',
  };
}
