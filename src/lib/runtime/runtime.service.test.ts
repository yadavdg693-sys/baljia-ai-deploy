import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        mocks.inserted.push(value);
        return { returning: vi.fn(async () => [{ id: 'usage-1', ...value }]) };
      }),
    })),
  },
  usageEvents: {},
}));

describe('Baljia runtime service', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.inserted = [];
    process.env.BALJIA_RUNTIME_SIGNING_SECRET = 'test-runtime-secret';
  });

  it('signs and verifies company-scoped runtime tokens', async () => {
    const { signRuntimeToken, verifyRuntimeToken } = await import('./runtime.service');

    const token = await signRuntimeToken({
      companyId: 'company-1',
      appSlug: 'careerops',
      runtimeVersion: '2.0.0',
    });

    await expect(verifyRuntimeToken(token)).resolves.toMatchObject({
      companyId: 'company-1',
      appSlug: 'careerops',
      runtimeVersion: '2.0.0',
    });
    await expect(verifyRuntimeToken('bad-token')).rejects.toThrow(/invalid runtime token/i);
  });

  it('records usage events with company/user/package/feature/cost fields', async () => {
    const { recordUsageEvent } = await import('./runtime.service');

    await recordUsageEvent({
      companyId: 'company-1',
      userId: 'user-1',
      appSlug: 'careerops',
      packageName: '@baljia/ai',
      feature: 'resume_tailoring',
      units: 42,
      costUsd: '0.0123',
      status: 'success',
      metadata: { model: 'gpt-test' },
    });

    expect(mocks.inserted).toContainEqual(expect.objectContaining({
      company_id: 'company-1',
      user_id: 'user-1',
      app_slug: 'careerops',
      package_name: '@baljia/ai',
      feature: 'resume_tailoring',
      units: 42,
      cost_usd: '0.0123',
      status: 'success',
      metadata: { model: 'gpt-test' },
    }));
  });
});
