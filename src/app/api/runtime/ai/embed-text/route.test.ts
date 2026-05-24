import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordUsageEvent: vi.fn(),
  verifyRuntimeToken: vi.fn(),
  createEmbedding: vi.fn(),
  embeddingGuidanceForGateway: vi.fn(),
}));

vi.mock('@/lib/runtime/runtime.service', () => ({
  bearerTokenFromHeader: vi.fn((header: string | null) => header?.replace(/^Bearer\s+/i, '') ?? null),
  recordUsageEvent: mocks.recordUsageEvent,
  verifyRuntimeToken: mocks.verifyRuntimeToken,
}));

vi.mock('@/lib/services/openai.service', () => ({
  createEmbedding: mocks.createEmbedding,
  embeddingGuidanceForGateway: mocks.embeddingGuidanceForGateway,
}));

describe('/api/runtime/ai/embed-text', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.recordUsageEvent.mockReset();
    mocks.verifyRuntimeToken.mockReset();
    mocks.createEmbedding.mockReset();
    mocks.embeddingGuidanceForGateway.mockReset();
    mocks.verifyRuntimeToken.mockResolvedValue({
      companyId: 'company-1',
      appSlug: 'careerops',
      runtimeVersion: '2.0.0',
      capabilities: ['ai'],
    });
    mocks.createEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mocks.embeddingGuidanceForGateway.mockReturnValue({
      model: 'gemini-embedding-001',
      dimensions: 3072,
    });
  });

  it('returns embeddings through the platform path and records usage centrally', async () => {
    const { POST } = await import('./route');

    const response = await POST(new Request('http://localhost/api/runtime/ai/embed-text', {
      method: 'POST',
      headers: { authorization: 'Bearer runtime-token' },
      body: JSON.stringify({
        feature: 'resume_search',
        text: 'senior operations manager',
        userId: 'user-1',
      }),
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      embedding: [0.1, 0.2, 0.3],
      model: 'gemini-embedding-001',
      dimensions: 3072,
    });
    expect(mocks.createEmbedding).toHaveBeenCalledWith('senior operations manager');
    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1',
      userId: 'user-1',
      appSlug: 'careerops',
      packageName: '@baljia/ai',
      feature: 'resume_search',
      status: 'success',
      metadata: expect.objectContaining({ endpoint: 'embed-text', model: 'gemini-embedding-001' }),
    }));
  });
});
