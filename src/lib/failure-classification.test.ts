import { describe, expect, it } from 'vitest';
import { classifyFailureMessage, hasRenderPipelineQuotaSignal } from './failure-classification';

describe('failure classification', () => {
  it('classifies Render pipeline-minute exhaustion as external_block', () => {
    expect(classifyFailureMessage(
      'RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted\nRender rejected the build before app build logs were produced.',
    )).toBe('external_block');

    expect(classifyFailureMessage(
      'RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED\nRender service srv-test has a recent pipeline_minutes_exhausted event, so render_deploy is refusing to trigger another build attempt.',
    )).toBe('external_block');

    expect(hasRenderPipelineQuotaSignal('Render build minutes quota exhausted for this workspace.')).toBe(true);
  });

  it('does not collapse ordinary policy blockers into external_block', () => {
    expect(classifyFailureMessage('Policy guardrail blocked this unsafe request.')).toBe('policy_violation');
  });
});
