import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  company: {
    github_repo: 'BALAJIapps/careerops',
  } as Record<string, unknown>,
  fetch: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({ kind: 'eq' })),
  desc: vi.fn(() => ({ kind: 'desc' })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [mocks.company]),
        })),
      })),
    })),
  },
  companies: {
    id: 'id',
    github_repo: 'github_repo',
  },
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

vi.mock('@/lib/services/neon.service', () => ({
  getCompanyDatabase: vi.fn(),
  provisionCompanyDatabase: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Engineering protected runtime file guardrails', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.fetch.mockReset();
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.GITHUB_ORG = 'BALAJIapps';
    mocks.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const rawUrl = String(url);
      const method = init?.method ?? 'GET';
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/ref/heads/main') {
        return jsonResponse({ object: { sha: 'base-sha' } });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/commits/base-sha') {
        return jsonResponse({ tree: { sha: 'tree-sha' } });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/trees' && method === 'POST') {
        return jsonResponse({ sha: 'new-tree-sha' });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/commits' && method === 'POST') {
        return jsonResponse({ sha: 'new-commit-sha' });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/refs/heads/main' && method === 'PATCH') {
        return jsonResponse({ ref: 'refs/heads/main' });
      }
      return jsonResponse({ message: `unhandled ${method} ${rawUrl}` }, 500);
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('blocks protected runtime edits unless execution_contract.runtime_change is true', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('github_create_commit', {
      repo: 'BALAJIapps/careerops',
      message: 'edit runtime',
      files: [{ path: 'src/baljia/ai.ts', content: 'export const x = 1;' }],
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Build feature',
      description: 'Do not change runtime.',
      execution_contract: {},
    } as never);

    expect(result).toContain('protected runtime file');
    expect(result).toContain('runtime_change');
  });

  it('allows protected runtime edits when runtime_change is explicitly true', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('github_create_commit', {
      repo: 'BALAJIapps/careerops',
      message: 'runtime change',
      files: [{ path: 'src/baljia/ai.ts', content: 'export const x = 1;' }],
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Update runtime',
      description: 'Runtime task.',
      execution_contract: { runtime_change: true },
    } as never);

    expect(result).toContain('Committed 1 file');
  });
});
