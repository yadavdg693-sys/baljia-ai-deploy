import { describe, expect, it } from 'vitest';
import { createLocalRepoModePlan, shouldUseLocalRepoMode } from './local-repo-mode';

describe('engineering local-repo mode', () => {
  it('turns existing-app extension work into local inspect, patch, verify, push flow', () => {
    expect(shouldUseLocalRepoMode('Extend the existing app dashboard with billing')).toBe(true);
    const plan = createLocalRepoModePlan('Extend existing app route and schema');
    expect(plan.requiresLocalVerification).toBe(true);
    expect(plan.steps).toContain('inspect_with_lsp_or_code_graph');
    expect(plan.steps).toContain('push_after_local_verification');
  });
});
