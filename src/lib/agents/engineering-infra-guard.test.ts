import { describe, expect, it, vi } from 'vitest';

import {
  detectHardEngineeringInfraBlocker,
  ensureEngineeringGithubRepoReady,
} from './engineering-infra-guard';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('detectHardEngineeringInfraBlocker', () => {
  it('does not block on one transient GitHub Not Found', () => {
    const reason = detectHardEngineeringInfraBlocker([
      { turn: 4, tool: 'github_list_files', result: 'GitHub list failed: Not Found' },
    ]);

    expect(reason).toBeNull();
  });

  it('blocks repeated GitHub Not Found failures before the agent burns the full turn budget', () => {
    const reason = detectHardEngineeringInfraBlocker([
      { turn: 4, tool: 'github_list_files', result: 'GitHub list failed: Not Found' },
      { turn: 12, tool: 'github_push_file', result: 'GitHub push failed: Not Found' },
      { turn: 28, tool: 'github_create_commit', result: 'Could not get branch ref: Not Found' },
    ]);

    expect(reason).toContain('GitHub repo is not reachable');
  });

  it('blocks cross-tenant wrong-repo loops', () => {
    const result = 'github_read: this task\'s company owns "BALAJIapps/careerops" but you passed "BALAJIapps/careerops-012f21". Cross-tenant access is blocked.';

    const reason = detectHardEngineeringInfraBlocker([
      { turn: 9, tool: 'github_list_files', result },
      { turn: 15, tool: 'render_create_service', result },
    ]);

    expect(reason).toContain('wrong GitHub repo');
  });

  it('blocks after admin-required repo creation plus GitHub 404 evidence', () => {
    const reason = detectHardEngineeringInfraBlocker([
      { turn: 10, tool: 'github_list_files', result: 'GitHub list failed: Not Found' },
      { turn: 11, tool: 'github_create_repo', result: 'GitHub repo creation failed: You need admin access to create repos in this organization.' },
    ]);

    expect(reason).toContain('admin access');
  });
});

describe('ensureEngineeringGithubRepoReady', () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_TOKEN: 'gh_pat_' + 'A'.repeat(60),
    GITHUB_ORG: 'BALAJIapps',
  };

  it('passes when the configured repo is reachable and writable', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      full_name: 'BALAJIapps/careerops',
      permissions: { push: true },
    }));

    const result = await ensureEngineeringGithubRepoReady({
      companyId: 'company-1',
      githubRepo: 'BALAJIapps/careerops',
      slug: 'careerops',
      env,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/BALAJIapps/careerops',
      expect.any(Object),
    );
  });

  it('auto-provisions a missing repo before launching the full Engineering agent', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Not Found' }, 404));
    const persistRepo = vi.fn(async () => undefined);
    const provisionRepo = vi.fn(async () => ({
      id: 1,
      name: 'careerops',
      full_name: 'BALAJIapps/careerops',
      html_url: 'https://github.com/BALAJIapps/careerops',
      clone_url: 'https://github.com/BALAJIapps/careerops.git',
      ssh_url: 'git@github.com:BALAJIapps/careerops.git',
      default_branch: 'main',
    }));

    const result = await ensureEngineeringGithubRepoReady({
      companyId: 'company-1',
      githubRepo: 'BALAJIapps/careerops',
      slug: 'careerops',
      env,
      fetchImpl,
      persistRepo,
      provisionRepo,
    });

    expect(result.ok).toBe(true);
    expect(result.repaired).toBe(true);
    expect(provisionRepo).toHaveBeenCalledWith('company-1', 'careerops');
    expect(persistRepo).toHaveBeenCalledWith('BALAJIapps/careerops');
  });

  it('blocks cheaply when the repo is missing and the token cannot create it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Not Found' }, 404));
    const provisionRepo = vi.fn(async () => {
      throw new Error('GitHub repo creation failed: You need admin access to create repos in this organization.');
    });

    const result = await ensureEngineeringGithubRepoReady({
      companyId: 'company-1',
      githubRepo: 'BALAJIapps/careerops',
      slug: 'careerops',
      env,
      fetchImpl,
      provisionRepo,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('admin access');
    expect(result.reason).toContain('before launching Engineering');
  });
});
