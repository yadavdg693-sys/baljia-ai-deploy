import { describe, expect, it } from 'vitest';
import { getEngineeringToolDomain, getRegisteredEngineeringToolNames } from './engineering.registry';

describe('engineering tool domain registry', () => {
  it('keeps current tool names stable while assigning domain ownership', () => {
    const names = getRegisteredEngineeringToolNames();
    expect(names).toContain('github_create_commit');
    expect(names).toContain('render_deploy');
    expect(names).toContain('verify_browser_ui');
    expect(names).toContain('query_code_graph');
    expect(names).toContain('stripe_create_payment_link');
    expect(names).toContain('github_fork_skeleton');

    expect(getEngineeringToolDomain('github_create_commit')).toBe('github');
    expect(getEngineeringToolDomain('render_deploy')).toBe('render');
    expect(getEngineeringToolDomain('query_code_graph')).toBe('codegraph');
  });
});
