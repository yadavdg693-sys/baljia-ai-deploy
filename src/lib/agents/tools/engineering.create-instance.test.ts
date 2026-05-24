import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  company: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  fetchCalls: [] as Array<{ url: string; method: string; body?: unknown }>,
  getCompanyDatabase: vi.fn(),
  provisionCompanyDatabase: vi.fn(),
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
          limit: vi.fn(async () => mocks.company ? [mocks.company] : []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        mocks.updates.push(value);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  },
  companies: {
    id: 'id',
    name: 'name',
    slug: 'slug',
    github_repo: 'github_repo',
    neon_database_id: 'neon_database_id',
    render_service_id: 'render_service_id',
    custom_domain: 'custom_domain',
    hosting_state: 'hosting_state',
  },
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

vi.mock('@/lib/services/neon.service', () => ({
  getCompanyDatabase: mocks.getCompanyDatabase,
  provisionCompanyDatabase: mocks.provisionCompanyDatabase,
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
}));

vi.mock('@/lib/services/domain.service', () => ({
  provisionSubdomain: vi.fn(),
  attachCustomDomain: vi.fn(),
  verifyCustomDomain: vi.fn(),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('create_instance canonical infra reuse', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.company = {
      name: 'CareerOps',
      slug: 'careerops',
      github_repo: 'BALAJIapps/careerops',
      neon_database_id: 'restless-frost-43305364',
      render_service_id: 'srv-existing',
      custom_domain: null,
    };
    mocks.updates = [];
    mocks.fetchCalls = [];
    mocks.getCompanyDatabase.mockReset();
    mocks.provisionCompanyDatabase.mockReset();
    mocks.fetch.mockReset();
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.GITHUB_ORG = 'BALAJIapps';
    process.env.RENDER_API_KEY = 'test-render-token';

    mocks.getCompanyDatabase.mockResolvedValue({
      projectId: 'restless-frost-43305364',
      connectionUri: 'postgres://user:pass@careerops.neon.tech/neondb',
      host: 'careerops.neon.tech',
      name: 'neondb',
    });
    mocks.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const rawUrl = String(url);
      const method = init?.method ?? 'GET';
      let parsedBody: unknown;
      if (typeof init?.body === 'string') {
        try { parsedBody = JSON.parse(init.body); } catch { parsedBody = init.body; }
      }
      mocks.fetchCalls.push({ url: rawUrl, method, body: parsedBody });

      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops') {
        return jsonResponse({ default_branch: 'main', full_name: 'BALAJIapps/careerops' });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/contents/') {
        return jsonResponse([
          { name: 'app' },
          { name: 'components' },
          { name: 'db' },
          { name: 'lib' },
          { name: 'package.json' },
          { name: 'next.config.ts' },
        ]);
      }
      if (rawUrl.includes('https://api.github.com/repos/BALAJIapps/careerops/contents/')) {
        return jsonResponse({ message: 'not found' }, 404);
      }
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
        return jsonResponse({ sha: 'runtime-commit-sha' });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/refs/heads/main' && method === 'PATCH') {
        return jsonResponse({ ref: 'refs/heads/main' });
      }
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing') {
        return jsonResponse({
          service: {
            serviceDetails: { url: 'careerops-34eu.onrender.com' },
          },
        });
      }
      if (rawUrl.startsWith('https://api.render.com/v1/services/srv-existing/env-vars/')) {
        return jsonResponse({ key: decodeURIComponent(rawUrl.split('/').pop() ?? ''), value: 'updated' });
      }
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing/deploys' && method === 'POST') {
        return jsonResponse({ id: 'dep-runtime-env' });
      }

      return jsonResponse({ message: `unhandled ${method} ${rawUrl}` }, 500);
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('ensure_founder_app_instance reuses saved infra, writes runtime files, and returns structured JSON', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('ensure_founder_app_instance', {
      companyId: 'company-1',
      capabilities: ['auth', 'ai'],
      preferredStack: 'nextjs',
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Build CareerOps auth',
      description: 'Build a user-facing full-stack auth flow.',
    } as never);

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      repo: 'BALAJIapps/careerops',
      repoStatus: 'reused',
      neonProjectId: 'restless-frost-43305364',
      dbStatus: 'reused',
      renderServiceId: 'srv-existing',
      renderStatus: 'reused',
      renderUrl: 'https://careerops-34eu.onrender.com',
      baljiaUrl: 'https://careerops.baljia.app',
    });
    expect(mocks.provisionCompanyDatabase).not.toHaveBeenCalled();
    expect(mocks.updates).toContainEqual({ github_repo: 'BALAJIapps/careerops' });
    expect(mocks.fetchCalls.some((call) => call.url.endsWith('/forks'))).toBe(false);
    expect(mocks.fetchCalls.some((call) => call.url === 'https://api.render.com/v1/services' && call.method === 'POST')).toBe(false);
    const runtimeCommit = mocks.fetchCalls.find((call) =>
      call.url === 'https://api.github.com/repos/BALAJIapps/careerops/git/trees' && call.method === 'POST'
    );
    expect(JSON.stringify(runtimeCommit?.body)).toContain('baljia.runtime.json');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('src/baljia/runtime.ts');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('src/baljia/ai.ts');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('/api/runtime/ai/embed-text');
    expect(JSON.stringify(runtimeCommit?.body)).not.toContain('embedText endpoint not enabled yet');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('withCheckoutEvent');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('withWebhookEvent');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('withSubscriptionEvent');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('withObjectUploadEvent');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('withEmailEvent');
    expect(JSON.stringify(runtimeCommit?.body)).toContain('withSendEmailEvent');
    expect(mocks.fetchCalls.some((call) => call.url.includes('/env-vars/BALJIA_RUNTIME_TOKEN'))).toBe(true);
    expect(mocks.fetchCalls.some((call) => call.url.includes('/env-vars/BETTER_AUTH_SECRET'))).toBe(false);
    expect(mocks.fetchCalls.some((call) => call.url.includes('/env-vars/STRIPE_SECRET_KEY'))).toBe(false);
  });

  it('fails reused Render setup when runtime env injection fails', async () => {
    mocks.fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const rawUrl = String(url);
      const method = init?.method ?? 'GET';
      let parsedBody: unknown;
      if (typeof init?.body === 'string') {
        try { parsedBody = JSON.parse(init.body); } catch { parsedBody = init.body; }
      }
      mocks.fetchCalls.push({ url: rawUrl, method, body: parsedBody });

      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops') {
        return jsonResponse({ default_branch: 'main', full_name: 'BALAJIapps/careerops' });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/contents/') {
        return jsonResponse([
          { name: 'app' },
          { name: 'components' },
          { name: 'db' },
          { name: 'lib' },
          { name: 'package.json' },
        ]);
      }
      if (rawUrl.includes('https://api.github.com/repos/BALAJIapps/careerops/contents/')) {
        return jsonResponse({ message: 'not found' }, 404);
      }
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
        return jsonResponse({ sha: 'runtime-commit-sha' });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/refs/heads/main' && method === 'PATCH') {
        return jsonResponse({ ref: 'refs/heads/main' });
      }
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing') {
        return jsonResponse({ service: { serviceDetails: { url: 'careerops-34eu.onrender.com' } } });
      }
      if (rawUrl.includes('/env-vars/BALJIA_RUNTIME_TOKEN')) {
        return jsonResponse({ message: 'forbidden' }, 403);
      }
      if (rawUrl.startsWith('https://api.render.com/v1/services/srv-existing/env-vars/')) {
        return jsonResponse({ key: decodeURIComponent(rawUrl.split('/').pop() ?? ''), value: 'updated' });
      }
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing/deploys' && method === 'POST') {
        return jsonResponse({ id: 'dep-runtime-env' });
      }
      return jsonResponse({ message: `unhandled ${method} ${rawUrl}` }, 500);
    });

    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('ensure_founder_app_instance', {
      companyId: 'company-1',
      capabilities: ['auth', 'ai'],
      preferredStack: 'nextjs',
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Build CareerOps auth',
      description: 'Build a user-facing full-stack auth flow.',
    } as never);

    expect(result).toContain('runtime env injection failed');
    expect(result).toContain('BALJIA_RUNTIME_TOKEN');
  });

  it('keeps create_instance as a backward-compatible alias', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('create_instance', {
      app_name: 'careerops',
      description: 'Automatic job application platform',
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Build CareerOps auth',
      description: 'Build a user-facing full-stack auth flow.',
    } as never);

    expect(result).toContain('Step 4/4: Instance ready');
    expect(result).toContain('Repo mode: reused onboarding repo');
    expect(result).toContain('Service ID: srv-existing');
  });
});
