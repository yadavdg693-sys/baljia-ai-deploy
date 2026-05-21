import { describe, expect, it, vi } from 'vitest';

import { runPlatformOpsFixCycle } from './platform-ops-fix-cycle.service';

describe('platform ops fix cycle', () => {
  it('aggregates and debates support escalations before running the PR writer', async () => {
    const calls: string[] = [];
    const result = await runPlatformOpsFixCycle({
      aggregateSupportEscalations: vi.fn(async () => {
        calls.push('aggregate');
        return [{ fingerprint: 'support:dashboard:x', feedbackId: 'feedback-1', status: 'created' as const, occurrenceCount: 3 }];
      }),
      debateOpenSupportFeedback: vi.fn(async () => {
        calls.push('debate');
        return [{ feedbackId: 'feedback-1', runId: 'run-1', status: 'done' as const, costCents: 2, wallClockSeconds: 1 }];
      }),
      processApprovedBugs: vi.fn(async () => {
        calls.push('writer');
        return [{ feedbackId: 'feedback-1', runId: 'writer-1', status: 'done' as const, prUrl: 'https://github.com/x/y/pull/1', costCents: 5, turns: 3, wallClockSeconds: 10 }];
      }),
      loadPrOpenFeedbackIds: vi.fn(async () => {
        calls.push('load-prs');
        return ['feedback-1'];
      }),
      hasVerifierVote: vi.fn(async () => false),
      verifyOpenPr: vi.fn(async () => {
        calls.push('verifier');
        return { feedbackId: 'feedback-1', runId: 'verifier-1', status: 'done' as const, vote: 'approve', costCents: 1, turns: 1, wallClockSeconds: 3 };
      }),
    });

    expect(calls).toEqual(['aggregate', 'debate', 'writer', 'load-prs', 'verifier']);
    expect(result.support_aggregation.processed).toBe(1);
    expect(result.support_debate.processed).toBe(1);
    expect(result.writer.processed).toBe(1);
    expect(result.verifier.processed).toBe(1);
  });

  it('skips the support auto-PR stages when disabled', async () => {
    const aggregateSupportEscalations = vi.fn();
    const debateOpenSupportFeedback = vi.fn();

    const result = await runPlatformOpsFixCycle({
      supportAutoPrDisabled: true,
      aggregateSupportEscalations,
      debateOpenSupportFeedback,
      processApprovedBugs: vi.fn(async () => []),
      loadPrOpenFeedbackIds: vi.fn(async () => []),
      hasVerifierVote: vi.fn(async () => false),
      verifyOpenPr: vi.fn(),
    });

    expect(aggregateSupportEscalations).not.toHaveBeenCalled();
    expect(debateOpenSupportFeedback).not.toHaveBeenCalled();
    expect(result.support_aggregation.skipped).toBe(1);
    expect(result.support_aggregation.skipped_reason).toBe('PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED');
    expect(result.support_debate.skipped).toBe(1);
    expect(result.support_debate.skipped_reason).toBe('PLATFORM_OPS_SUPPORT_AUTOPR_DISABLED');
  });
});
