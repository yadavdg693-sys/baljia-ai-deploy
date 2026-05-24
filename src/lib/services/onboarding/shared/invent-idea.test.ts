import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/platform-capabilities', () => ({
  getCapabilityConstraint: () => 'Buildable on the platform.',
}));

vi.mock('./json-mode', () => ({
  callSmallLLMJson: vi.fn(),
}));

vi.mock('./onboarding-brief', () => ({
  saveOnboardingBrief: vi.fn(),
}));

vi.mock('../stage-runner', () => ({
  emitActivity: vi.fn(),
  recordOnboardingIssue: vi.fn(),
}));

vi.mock('./memory-sections', () => ({
  appendMemorySection: vi.fn(),
}));

describe('surprise idea invention module', () => {
  it('loads without the retired external idea bucket', async () => {
    const { inventIdea } = await import('./invent-idea');

    expect(typeof inventIdea).toBe('function');
  });
});
