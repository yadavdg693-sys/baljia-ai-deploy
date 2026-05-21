import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ render_service_id: 'srv-test' }],
        }),
      }),
    }),
  },
  companies: {
    render_service_id: 'render_service_id',
  },
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

const task = {
  id: 'task-1',
  company_id: 'company-1',
  title: 'Existing app extension',
  description: 'Push a fix and redeploy.',
} as never;

describe('render_deploy engineering tool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    process.env.RENDER_API_KEY = 'test-render-token';
  });

  it('turns accepted/no-id deploy responses into deterministic status-poll instructions', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          deploy: {
            id: 'dep-123',
            status: 'build_in_progress',
            finishedAt: null,
            commitMessage: 'Fix search insert race',
          },
        },
      ]), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_deploy', { service_id: 'srv-test' }, task);

    expect(result).toContain('RENDER_DEPLOY_ACCEPTED_NO_ID service_id=srv-test http_status=202');
    expect(result).toContain('Latest deploy status: build_in_progress');
    expect(result).toContain('Latest deploy id: dep-123');
    expect(result).toContain('NEXT_REQUIRED_TOOL: render_get_deploy_status service_id=srv-test deploy_id=dep-123 wait_for_terminal=true');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/srv-test/events?limit=20');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/services/srv-test/deploys?limit=1');
  });

  it('instructs agents to poll the exact deploy id returned by Render', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'dep-new',
        status: 'build_in_progress',
      }), { status: 201 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_deploy', { service_id: 'srv-test' }, task);

    expect(result).toContain('Deployment triggered! Deploy ID: dep-new');
    expect(result).toContain('NEXT_REQUIRED_TOOL: render_get_deploy_status service_id=srv-test deploy_id=dep-new wait_for_terminal=true');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/srv-test/events?limit=20');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/services/srv-test/deploys');
  });

  it('blocks repeated deploy attempts after recent Render pipeline-minute exhaustion', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        event: {
          type: 'pipeline_minutes_exhausted',
          timestamp: new Date().toISOString(),
          details: { buildId: 'bld-quota', deployId: 'dep-quota' },
        },
      },
    ]), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_deploy', { service_id: 'srv-test' }, task);

    expect(result).toContain('RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED');
    expect(result).toContain('Circuit breaker window: 1440 minute(s)');
    expect(result).toContain('Earliest automatic retry after:');
    expect(result).toContain('force_after_quota_restored=true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/srv-test/events?limit=20');
  });

  it('blocks env var updates that would trigger redeploys after recent Render pipeline-minute exhaustion', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        event: {
          type: 'pipeline_minutes_exhausted',
          timestamp: new Date().toISOString(),
          details: { buildId: 'bld-quota', deployId: 'dep-quota' },
        },
      },
    ]), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_set_env_vars', {
      service_id: 'srv-test',
      env_vars: [{ key: 'DATABASE_URL', value: 'postgres://example' }],
    }, task);

    expect(result).toContain('RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED');
    expect(result).toContain('render_set_env_vars is refusing to trigger another build attempt');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/srv-test/events?limit=20');
  });

  it('blocks service config updates that would trigger redeploys after recent Render pipeline-minute exhaustion', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        event: {
          type: 'pipeline_minutes_exhausted',
          timestamp: new Date().toISOString(),
          details: { buildId: 'bld-quota', deployId: 'dep-quota' },
        },
      },
    ]), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_update_service_config', {
      service_id: 'srv-test',
      health_check_path: '/api/health',
    }, task);

    expect(result).toContain('RENDER_DEPLOY_BLOCKED_RECENT_PIPELINE_MINUTES_EXHAUSTED');
    expect(result).toContain('render_update_service_config is refusing to trigger another build attempt');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/srv-test/events?limit=20');
  });

  it('allows one explicit deploy retry after operator-confirmed quota restoration', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'dep-forced',
      status: 'build_in_progress',
    }), { status: 201 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_deploy', {
      service_id: 'srv-test',
      force_after_quota_restored: true,
    }, task);

    expect(result).toContain('Deployment triggered! Deploy ID: dep-forced');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/srv-test/deploys');
  });

  it('polls an exact deploy id instead of the latest deploy when deploy_id is supplied', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'dep-new',
      status: 'live',
      finishedAt: '2026-05-15T11:10:00Z',
      commitMessage: 'Build marketplace app',
    }), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_get_deploy_status', {
      service_id: 'srv-test',
      deploy_id: 'dep-new',
      wait_for_terminal: true,
      poll_interval_seconds: 10,
      timeout_seconds: 20,
    }, task);

    expect(result).toContain('Deploy dep-new status: live');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/services/srv-test/deploys/dep-new');
  });

  it('retries transient Render status fetch failures before returning deploy status', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          deploy: {
            id: 'dep-456',
            status: 'live',
            finishedAt: '2026-05-14T17:05:00Z',
            commitMessage: 'Fix final UI',
          },
        },
      ]), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_get_deploy_status', {
      service_id: 'srv-test',
      wait_for_terminal: true,
      poll_interval_seconds: 10,
      timeout_seconds: 20,
    }, task);

    expect(result).toContain('Latest deploy status: live');
    expect(result).toContain('Waited:');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tells the agent to retry after exhausted transient Render status failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_get_deploy_status', {
      service_id: 'srv-test',
      wait_for_terminal: true,
    }, task);

    expect(result).toContain('Render deploy status transient error');
    expect(result).toContain('NEXT_REQUIRED_TOOL: render_get_deploy_status wait_for_terminal=true');
  });

  it('surfaces Render pipeline-minute exhaustion as infrastructure instead of app build failure', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'dep-quota',
        status: 'build_failed',
        finishedAt: '2026-05-15T12:30:12Z',
        commitMessage: 'Build marketplace app',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          event: {
            type: 'pipeline_minutes_exhausted',
            timestamp: '2026-05-15T12:30:12Z',
            details: { buildId: 'bld-quota' },
          },
        },
      ]), { status: 200 }));

    const { handleEngineeringTool } = await import('./engineering.tools');
    const result = await handleEngineeringTool('render_get_deploy_status', {
      service_id: 'srv-test',
      deploy_id: 'dep-quota',
      wait_for_terminal: true,
      poll_interval_seconds: 10,
      timeout_seconds: 20,
    }, task);

    expect(result).toContain('Deploy dep-quota status: build_failed');
    expect(result).toContain('RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted');
    expect(result).toContain('not an app-code or Render command failure');
    expect(result).not.toContain('fix the build/runtime error');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/services/srv-test/events?limit=20');
  });

  it('summarizes Render pipeline-minute events for empty build-log responses', async () => {
    const { summarizeRenderInfrastructureBlocker } = await import('./engineering.tools');

    const result = summarizeRenderInfrastructureBlocker([
      {
        type: 'pipeline_minutes_exhausted',
        timestamp: '2026-05-15T12:30:12Z',
        details: { buildId: 'bld-quota' },
      },
    ], 'dep-quota');

    expect(result).toContain('RENDER_INFRASTRUCTURE_BLOCKER: pipeline_minutes_exhausted');
    expect(result).toContain('Build ID: bld-quota');
    expect(result).toContain('Deploy ID: dep-quota');
    expect(result).toContain('Earliest automatic retry after: 2026-05-16T12:30:12.000Z');
    expect(result).toContain('Do not change package.json, render.yaml, build/start commands');
  });
});
