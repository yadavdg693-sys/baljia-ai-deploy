import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbWhere = vi.fn();
const dbFrom = vi.fn(() => ({ where: dbWhere }));
const dbSelect = vi.fn(() => ({ from: dbFrom }));
const getBalance = vi.fn();
const callOpenAI = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: dbSelect,
  },
  failureFingerprints: {
    affected_agents: 'failureFingerprints.affected_agents',
    fix_status: 'failureFingerprints.fix_status',
    last_seen_at: 'failureFingerprints.last_seen_at',
    category: 'failureFingerprints.category',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ op: 'and', args })),
  gte: vi.fn((...args) => ({ op: 'gte', args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock('./credit.service', () => ({
  getBalance,
}));

vi.mock('@/lib/llm-provider', () => ({
  isAnthropicAvailable: vi.fn(() => true),
  isOpenAIAvailable: vi.fn(() => true),
  callOpenAI,
  OPENAI_MODELS: { GPT_5_4: 'gpt-5.4' },
  getPreferredProvider: vi.fn(() => 'openai'),
}));

vi.mock('@/lib/llm-safety', () => ({
  callAnthropicWithTimeout: vi.fn(async () => {
    throw new Error('LLM classifier should not run for known tags');
  }),
  callGeminiWithTimeout: vi.fn(async () => {
    throw new Error('LLM classifier should not run for known tags');
  }),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('governance evaluateTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBalance.mockResolvedValue(10);
    dbWhere.mockResolvedValue([{ count: 0 }]);
    callOpenAI.mockRejectedValue(new Error('LLM classifier should not run for known tags'));
  });

  it('classifies engineering tasks deterministically without LLM fallback', async () => {
    const { evaluateTask } = await import('./governance.service');

    const decision = await evaluateTask({
      companyId: 'company-1',
      title: 'Build user auth',
      description: 'Create signup, login, sessions, and secure auth screens.',
      tag: 'engineering',
    });

    expect(decision).toMatchObject({
      can_execute: true,
      execution_mode: 'full_agent',
      verification_level: 'browser_flow',
    });
    expect(callOpenAI).not.toHaveBeenCalled();
  });
});
