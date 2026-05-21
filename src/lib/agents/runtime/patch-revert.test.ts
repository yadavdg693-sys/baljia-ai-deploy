import { describe, expect, it } from 'vitest';
import { decideRevertStrategy } from './patch-revert';

describe('patch and revert strategy', () => {
  it('prefers repair unless failure is severe and rollback confidence is high', () => {
    expect(decideRevertStrategy({
      severeVerificationFailure: false,
      checkpoint: { rollback_available: true, rollback_confidence: 'high' },
    }).action).toBe('repair_first');

    expect(decideRevertStrategy({
      severeVerificationFailure: true,
      checkpoint: { rollback_available: true, rollback_confidence: 'low' },
    }).action).toBe('rollback_blocked');

    expect(decideRevertStrategy({
      severeVerificationFailure: true,
      checkpoint: { rollback_available: true, rollback_confidence: 'high' },
    }).action).toBe('rollback_allowed');
  });
});
