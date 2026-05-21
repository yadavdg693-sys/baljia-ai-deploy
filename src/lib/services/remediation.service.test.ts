import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {},
  tasks: {},
  taskExecutions: {},
}));

vi.mock('@/lib/services/task.service', () => ({}));
vi.mock('@/lib/services/failure.service', () => ({}));
vi.mock('@/lib/services/event.service', () => ({}));
vi.mock('@/lib/services/credit.service', () => ({}));

import { isRenderPipelineQuotaRemediationBlocked } from './remediation.service';

describe('remediation strategy guards', () => {
  it('skips auto-remediation for Render pipeline-minute quota blockers', () => {
    expect(isRenderPipelineQuotaRemediationBlocked(
      'external_block',
      'RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED\nRender service srv-test has a recent pipeline_minutes_exhausted event.',
    )).toBe(true);

    expect(isRenderPipelineQuotaRemediationBlocked(
      'external_block',
      'RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted',
    )).toBe(true);
  });

  it('does not skip ordinary external failures or non-external blocker text', () => {
    expect(isRenderPipelineQuotaRemediationBlocked('external_block', 'fetch failed ECONNRESET')).toBe(false);
    expect(isRenderPipelineQuotaRemediationBlocked('policy_violation', 'RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED')).toBe(false);
  });
});
