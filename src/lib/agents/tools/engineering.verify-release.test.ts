import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  company: {
    github_repo: 'BALAJIapps/careerops',
    render_service_id: 'srv-existing',
    custom_domain: 'careerops.baljia.app',
    slug: 'careerops',
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
    render_service_id: 'render_service_id',
    custom_domain: 'custom_domain',
    slug: 'slug',
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

describe('verify_release', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GITHUB_TOKEN = 'test-github-token';
    process.env.RENDER_API_KEY = 'test-render-key';
    delete process.env.GEMINI_API_KEY;
    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => {
      const rawUrl = String(url);
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing/deploys?limit=1') {
        return jsonResponse([{ deploy: { id: 'dep-1', status: 'live', finishedAt: 'now', commitMessage: 'test' } }]);
      }
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing') {
        return jsonResponse({ ownerId: 'owner-1', service: { serviceDetails: { url: 'careerops.onrender.com' } } });
      }
      if (rawUrl.startsWith('https://api.render.com/v1/logs?')) {
        return jsonResponse({ logs: [{ message: 'server started', timestamp: 'now' }] });
      }
      if (rawUrl === 'https://careerops.onrender.com/' || rawUrl === 'https://careerops.baljia.app/' || rawUrl === 'https://careerops.invalid/') {
        return new Response('<html><head><title>CareerOps</title></head><body><main><h1>CareerOps</h1><p>Automatic job applications with tailored resumes.</p></main></body></html>', { status: 200 });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/trees/main?recursive=1') {
        return jsonResponse({ tree: [{ path: 'app/page.tsx', type: 'blob', sha: 'sha-page', size: 80 }] });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/blobs/sha-page') {
        return jsonResponse({ encoding: 'base64', content: Buffer.from('export default function Page(){ return <main>CareerOps</main>; }').toString('base64') });
      }
      return jsonResponse({ message: `unhandled ${rawUrl}` }, 500);
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('returns VERIFY_RELEASE_PASS with structured check output when release checks pass', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('verify_release', {
      companyId: 'company-1',
      renderUrl: 'https://careerops.onrender.com',
      baljiaUrl: 'https://careerops.baljia.app',
      journeys: [],
      dbAssertions: [],
      uiAssertions: [],
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Verify release',
      description: 'Verify a release.',
    } as never);

    expect(result).toContain('VERIFY_RELEASE_PASS');
    const parsed = JSON.parse(result.replace(/^VERIFY_RELEASE_PASS\s*/, ''));
    expect(parsed).toMatchObject({
      passed: true,
      selectedVerificationUrl: 'https://careerops.onrender.com',
      finalFounderUrl: 'https://careerops.baljia.app',
    });
    expect(parsed.checks.length).toBeGreaterThan(0);
    expect(parsed.blockers).toEqual([]);
  });

  it('runs design proof when requested and records critique availability', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('verify_release', {
      companyId: 'company-1',
      renderUrl: 'https://careerops.onrender.com',
      baljiaUrl: 'https://careerops.baljia.app',
      requireDesignProof: true,
      requireUiProof: false,
      journeys: [],
      dbAssertions: [],
      uiAssertions: [],
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Verify backend release',
      description: 'Verify a backend release.',
    } as never);

    const parsed = JSON.parse(result.replace(/^VERIFY_RELEASE_PASS\s*/, ''));
    expect(parsed.checks.map((check: { name: string }) => check.name)).toContain('design_audit');
    expect(parsed.checks.map((check: { name: string }) => check.name)).toContain('design_critique');
    expect(parsed.blockers).toEqual([]);
  });

  it('does not allow user-facing releases to opt out of UI and design proof', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('verify_release', {
      companyId: 'company-1',
      renderUrl: 'https://careerops.invalid',
      baljiaUrl: 'https://careerops.baljia.app',
      requireDesignProof: false,
      requireUiProof: false,
      journeys: [],
      dbAssertions: [],
      uiAssertions: [],
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Verify landing page release',
      description: 'Verify a user-facing landing page release.',
    } as never);

    expect(result).toContain('VERIFY_RELEASE_FAIL');
    const parsed = JSON.parse(result.replace(/^VERIFY_RELEASE_FAIL\s*/, ''));
    expect(parsed.checks.map((check: { name: string }) => check.name)).toEqual(expect.arrayContaining([
      'browser_ui_1',
      'design_audit',
      'design_critique',
    ]));
  });

  it('fails static scan when source evidence cannot be collected', async () => {
    mocks.fetch.mockImplementation(async (url: string | URL | Request) => {
      const rawUrl = String(url);
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing/deploys?limit=1') {
        return jsonResponse([{ deploy: { id: 'dep-1', status: 'live', finishedAt: 'now', commitMessage: 'test' } }]);
      }
      if (rawUrl === 'https://api.render.com/v1/services/srv-existing') {
        return jsonResponse({ ownerId: 'owner-1', service: { serviceDetails: { url: 'careerops.onrender.com' } } });
      }
      if (rawUrl.startsWith('https://api.render.com/v1/logs?')) {
        return jsonResponse({ logs: [{ message: 'server started', timestamp: 'now' }] });
      }
      if (rawUrl === 'https://careerops.onrender.com/' || rawUrl === 'https://careerops.baljia.app/') {
        return new Response('ok', { status: 200 });
      }
      if (rawUrl === 'https://api.github.com/repos/BALAJIapps/careerops/git/trees/main?recursive=1') {
        return jsonResponse({ tree: [] });
      }
      return jsonResponse({ message: `unhandled ${rawUrl}` }, 500);
    });
    vi.stubGlobal('fetch', mocks.fetch);
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('verify_release', {
      companyId: 'company-1',
      renderUrl: 'https://careerops.onrender.com',
      baljiaUrl: 'https://careerops.baljia.app',
      journeys: [],
      dbAssertions: [],
      uiAssertions: [],
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Verify release',
      description: 'Verify a release.',
    } as never);

    expect(result).toContain('VERIFY_RELEASE_FAIL');
    const parsed = JSON.parse(result.replace(/^VERIFY_RELEASE_FAIL\s*/, ''));
    expect(parsed.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'static_scan' }),
    ]));
  });
});
