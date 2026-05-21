import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ github_repo: 'BALAJIapps/company-owned-app' }],
        }),
      }),
    }),
  },
  companies: {
    github_repo: 'github_repo',
    id: 'id',
  },
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

const task = {
  id: 'task-1',
  company_id: 'company-1',
  title: 'Patch app',
  description: 'Patch the company repo.',
} as never;

describe('github ownership engineering tools', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    process.env.GITHUB_TOKEN = 'ghp_test';
    process.env.GITHUB_ORG = 'BALAJIapps';
  });

  it('defaults github_create_commit to the company-owned repo when repo is omitted', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 'base-tree' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'new-tree' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abcdef1234567890' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('github_create_commit', {
      message: 'Fix landing copy',
      files: [{ path: 'app/page.tsx', content: 'export default function Page() { return null; }\n' }],
    }, task);

    expect(result).toContain('Committed 1 file(s) to BALAJIapps/company-owned-app/main');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/repos/BALAJIapps/company-owned-app/git/ref/heads/main');
  });

  it('still blocks explicit cross-tenant github_create_commit repos', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('github_create_commit', {
      repo: 'BALAJIapps/not-this-company',
      message: 'Bad write',
      files: [{ path: 'app/page.tsx', content: 'export default function Page() { return null; }\n' }],
    }, task);

    expect(result).toContain('company owns "BALAJIapps/company-owned-app" but you passed "BALAJIapps/not-this-company"');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
