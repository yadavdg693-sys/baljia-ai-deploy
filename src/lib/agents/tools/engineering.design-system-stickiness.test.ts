import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  company: { design_system: 'linear-app' } as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
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
    design_system: 'design_system',
    updated_at: 'updated_at',
  },
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

describe('company design-system stickiness', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.company = { design_system: 'linear-app' };
    mocks.updates = [];
  });

  it('reuses the existing company design system instead of rematching each UI task', async () => {
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('match_design_system', {
      product_context: 'Build a polished fintech billing dashboard with invoices, payments, and revenue analytics.',
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Add billing dashboard',
      description: 'Add a user-facing billing dashboard.',
    } as never);

    expect(result).toContain('DESIGN_SYSTEM_MATCH_EVIDENCE selected=linear-app');
    expect(result).toContain('existing company design system');
    expect(result).toContain('get_design_system with name="linear-app"');
    expect(mocks.updates).toEqual([]);
  });

  it('persists the first selected design system for future company tasks', async () => {
    mocks.company = { design_system: null };
    const { handleEngineeringTool } = await import('./engineering.tools');

    const result = await handleEngineeringTool('match_design_system', {
      product_context: 'Build an AI agent copilot dashboard for engineering teams with chat, runs, and deployment status.',
    }, {
      id: 'task-1',
      company_id: 'company-1',
      title: 'Build AI agent dashboard',
      description: 'Build a user-facing AI agent dashboard.',
    } as never);

    const selected = result.match(/DESIGN_SYSTEM_MATCH_EVIDENCE selected=([a-z0-9-]+)/)?.[1];
    expect(selected).toBeTruthy();
    expect(mocks.updates).toContainEqual(expect.objectContaining({ design_system: selected }));
  });
});
