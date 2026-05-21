import { describe, expect, it } from 'vitest';

import {
  adjudicateDebate,
  parseDebatePerspective,
  type DebatePerspective,
} from './platform-ops-debate.service';

const perspective = (overrides: Partial<DebatePerspective> = {}): DebatePerspective => ({
  model: 'gpt-5.5',
  vote: 'fix_now',
  confidence: 0.86,
  estimatedRisk: 'medium',
  filesToModify: ['src/lib/services/task.service.ts'],
  rootCause: 'Approved tasks are not being refreshed after launch.',
  recommendedFix: 'Refresh the dashboard task query after approval.',
  concerns: [],
  ...overrides,
});

describe('platform ops debate adjudication', () => {
  it('auto-approves when GPT-5.5 and Opus 4.7 agree on an allowed fix', () => {
    const decision = adjudicateDebate({
      feedbackId: 'feedback-1',
      gpt: perspective({ model: 'gpt-5.5' }),
      opus: perspective({ model: 'claude-opus-4-7', confidence: 0.82 }),
    });

    expect(decision).toMatchObject({
      outcome: 'auto_approve',
      status: 'approved_to_fix',
      approvedBy: 'auto:gpt-5.5+opus-4.7',
      estimatedRisk: 'medium',
    });
    expect(decision.filesToModify).toEqual(['src/lib/services/task.service.ts']);
    expect(decision.summary).toContain('Both models voted fix_now');
  });

  it('requires manual review when the models disagree', () => {
    const decision = adjudicateDebate({
      feedbackId: 'feedback-1',
      gpt: perspective({ model: 'gpt-5.5', vote: 'fix_now' }),
      opus: perspective({ model: 'claude-opus-4-7', vote: 'manual_review', concerns: ['Needs a repro first'] }),
    });

    expect(decision.outcome).toBe('manual_review');
    expect(decision.status).toBe('awaiting_approval');
    expect(decision.summary).toContain('disagreed');
  });

  it('requires manual review when either proposed fix touches off-limits files', () => {
    const decision = adjudicateDebate({
      feedbackId: 'feedback-1',
      gpt: perspective({ filesToModify: ['src/lib/db/schema.ts'] }),
      opus: perspective({ model: 'claude-opus-4-7', filesToModify: ['src/lib/db/schema.ts'] }),
    });

    expect(decision.outcome).toBe('manual_review');
    expect(decision.summary).toContain('off-limits');
  });

  it('parses fenced JSON model responses into normalized perspectives', () => {
    const raw = [
      '```json',
      '{',
      '  "vote": "fix_now",',
      '  "confidence": 0.91,',
      '  "estimated_risk": "low",',
      '  "files_to_modify": ["src/lib/services/router.service.ts"],',
      '  "root_cause": "Routing maps escalation to the wrong agent.",',
      '  "recommended_fix": "Update the support escalation route.",',
      '  "concerns": []',
      '}',
      '```',
    ].join('\n');

    expect(parseDebatePerspective(raw, 'gpt-5.5')).toEqual({
      model: 'gpt-5.5',
      vote: 'fix_now',
      confidence: 0.91,
      estimatedRisk: 'low',
      filesToModify: ['src/lib/services/router.service.ts'],
      rootCause: 'Routing maps escalation to the wrong agent.',
      recommendedFix: 'Update the support escalation route.',
      concerns: [],
    });
  });
});
