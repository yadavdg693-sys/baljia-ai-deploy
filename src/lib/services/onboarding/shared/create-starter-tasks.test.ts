// Verifies the Bug 2 fix: when the LLM returns a malformed StarterTasksResult
// (empty outreach.title), createStarterTasks must NOT throw and instead emit
// a journey-aware fallback. Pre-fix, the bottom-of-file `validateTask` threw
// "createStarterTasks: outreach task missing title or description" and killed
// the entire onboarding pipeline (Lichora resume scenario).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createTaskMock, createTaskDraftMock, finalizeTaskDraftIdsMock, llmJsonMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(async (input: unknown) => ({ id: 'fake', ...(input as object) })),
  createTaskDraftMock: vi.fn(async (input: unknown) => ({ id: 'draft', ...(input as object) })),
  finalizeTaskDraftIdsMock: vi.fn(async () => ({ finalized: 3, skipped: [], task_ids: ['t1', 't2', 't3'] })),
  llmJsonMock: vi.fn(),
}));

vi.mock('@/lib/services/task.service', () => ({
  createTask: createTaskMock,
}));

vi.mock('@/lib/services/task-draft.service', () => ({
  createTaskDraft: createTaskDraftMock,
  finalizeTaskDraftIds: finalizeTaskDraftIdsMock,
}));

vi.mock('@/lib/services/onboarding/stage-runner', () => ({
  emitActivity: vi.fn(async () => undefined),
  recordOnboardingIssue: vi.fn(async () => undefined),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/platform-capabilities', () => ({
  getCapabilitiesBulletsOnly: () => '(capabilities elided for test)',
}));

vi.mock('@/lib/agents/ceo/ceo-framework', () => ({
  ONBOARDING_TASK_FRAMEWORK: '(onboarding task framework elided)',
}));

vi.mock('@/lib/services/onboarding/shared/json-mode', () => ({
  callSmallLLMJson: (...a: unknown[]) => llmJsonMock(...a),
}));

import { createStarterTasks } from './create-starter-tasks';
import type { PipelineContext } from '../types';

function makeCtx(over: Partial<PipelineContext> = {}): PipelineContext {
  return {
    companyId: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000099',
    journey: 'build_my_idea',
    input: 'appointment reminders for clinics',
    requestIp: null,
    browserTimezone: null,
    browserLocale: null,
    userAgent: null,
    founderName: null,
    founderEmail: '',
    founderEnrichment: null,
    enrichedBusinessSummary: null,
    enrichedFounderSummary: null,
    founderAngle: null,
    strategy: 'build_my_idea',
    companyName: 'Lichora',
    slug: 'lichora',
    oneLiner: 'Reminders for clinics',
    mission: '',
    marketResearch: null,
    startedAt: Date.now(),
    ...over,
  };
}

describe('createStarterTasks — Bug 2 fallback', () => {
  beforeEach(() => {
    createTaskMock.mockClear();
    createTaskDraftMock.mockClear();
    finalizeTaskDraftIdsMock.mockClear();
    llmJsonMock.mockReset();
  });

  it('does NOT throw when LLM returns empty outreach.title', async () => {
    llmJsonMock.mockResolvedValueOnce({
      engineering: {
        title: 'Ship MVP',
        description: 'A reasonable description with enough length to pass length checks.',
        reasoning: 'Reason.',
        complexity: 6,
      },
      research: {
        title: 'Scout competitors',
        description: 'A reasonable research description.',
        reasoning: 'Reason.',
      },
      outreach: { title: '', description: '', reasoning: '' },
    });

    await expect(createStarterTasks(makeCtx())).resolves.not.toThrow();
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(createTaskDraftMock).toHaveBeenCalledTimes(3);
    expect(finalizeTaskDraftIdsMock).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      ['draft', 'draft', 'draft'],
      expect.objectContaining({ authorizedBy: 'system' }),
    );
    for (const [draft] of createTaskDraftMock.mock.calls) {
      expect(draft).toMatchObject({
        company_id: '00000000-0000-0000-0000-000000000001',
        source: 'onboarding',
        status: 'pending_ceo_review',
      });
    }

    const outreachCall = createTaskDraftMock.mock.calls.find(([arg]) => (arg as { tag: string }).tag === 'outreach');
    expect(outreachCall).toBeTruthy();
    const arg = outreachCall![0] as { title: string; description: string };
    expect(arg.title.length).toBeGreaterThan(0);
    expect(arg.description.length).toBeGreaterThan(50);
    // Build journey ⇒ "User discovery: Find 15 prospects" template
    expect(arg.title).toMatch(/^User discovery: Find 15 prospects/);
  });

  it('does NOT throw when the LLM call itself rejects after retry', async () => {
    llmJsonMock.mockRejectedValueOnce(new Error('LLM unavailable'));

    await expect(createStarterTasks(makeCtx())).resolves.not.toThrow();
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(createTaskDraftMock).toHaveBeenCalledTimes(3);
    expect(finalizeTaskDraftIdsMock).toHaveBeenCalledTimes(1);

    // every slot now uses fallback
    const tags = createTaskDraftMock.mock.calls.map(([arg]) => (arg as { tag: string }).tag).sort();
    expect(tags).toEqual(['engineering', 'outreach', 'research']);

    for (const [arg] of createTaskDraftMock.mock.calls) {
      const t = arg as { title: string; description: string };
      expect(t.title.trim().length).toBeGreaterThan(0);
      expect(t.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses Cold-outreach template for grow journey', async () => {
    llmJsonMock.mockResolvedValueOnce({
      engineering: { title: 'eng', description: 'desc desc desc desc desc desc desc desc desc.', reasoning: 'r' },
      research: { title: 'res', description: 'desc desc desc desc desc desc.', reasoning: 'r' },
      outreach: { title: '', description: '', reasoning: '' },
    });

    await createStarterTasks(makeCtx({ journey: 'grow_my_company', strategy: 'grow_my_company' }));
    const outreachCall = createTaskDraftMock.mock.calls.find(([arg]) => (arg as { tag: string }).tag === 'outreach')!;
    const arg = outreachCall[0] as { title: string };
    expect(arg.title).toMatch(/^Cold outreach: Find 20 prospects/);
  });

  it('uses Validation-outreach template for surprise journey', async () => {
    llmJsonMock.mockResolvedValueOnce({
      engineering: { title: 'eng', description: 'desc desc desc desc desc desc desc desc desc.', reasoning: 'r' },
      research: { title: 'res', description: 'desc desc desc desc desc desc.', reasoning: 'r' },
      outreach: { title: '', description: '', reasoning: '' },
    });

    await createStarterTasks(makeCtx({ journey: 'surprise_me', strategy: 'surprise_me' }));
    const outreachCall = createTaskDraftMock.mock.calls.find(([arg]) => (arg as { tag: string }).tag === 'outreach')!;
    const arg = outreachCall[0] as { title: string };
    expect(arg.title).toMatch(/^Validation outreach: Gauge interest/);
  });

  it('preserves partially-good LLM response (only patches missing fields)', async () => {
    llmJsonMock.mockResolvedValueOnce({
      engineering: { title: 'Custom eng title', description: 'Custom eng description '.repeat(5), reasoning: 'Custom reason' },
      research: { title: 'Custom research title', description: 'Custom research description '.repeat(5), reasoning: 'Custom reason' },
      outreach: { title: '', description: 'Custom outreach description that is long enough', reasoning: 'Custom reason' },
    });

    await createStarterTasks(makeCtx());
    const outreachCall = createTaskDraftMock.mock.calls.find(([arg]) => (arg as { tag: string }).tag === 'outreach')!;
    const arg = outreachCall[0] as { title: string; description: string };
    // title was empty → fallback. description was non-empty → preserved.
    expect(arg.title).toMatch(/^User discovery: Find 15 prospects/);
    expect(arg.description).toMatch(/Custom outreach description/);
  });
});
