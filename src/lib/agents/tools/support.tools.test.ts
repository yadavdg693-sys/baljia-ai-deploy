import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertCalls: Array<{ table: unknown; values: unknown }> = [];

vi.mock('@/lib/db', () => {
  const makeInsertChain = (table: unknown) => {
    const chain = {
      values: vi.fn((values: unknown) => {
        insertCalls.push({ table, values });
        return chain;
      }),
      returning: vi.fn(async () => [{ id: 'engineering-task-1' }]),
      onConflictDoUpdate: vi.fn(async () => undefined),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
    };
    return chain;
  };

  return {
    db: {
      insert: vi.fn((table: unknown) => makeInsertChain(table)),
      select: vi.fn(),
      update: vi.fn(),
    },
    emailThreads: {},
    platformEvents: { name: 'platformEvents' },
    companies: {},
    users: {},
    tasks: { name: 'tasks' },
    contacts: {},
  };
});

vi.mock('@/lib/services/email.service', () => ({
  sendEmail: vi.fn(),
  sendEscalationEmail: vi.fn(),
}));

describe('support tools', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    vi.clearAllMocks();
  });

  it('emits a support engineering escalation event when creating an engineering task', async () => {
    const { handleSupportTool } = await import('./support.tools');
    const { platformEvents } = await import('@/lib/db');

    const output = await handleSupportTool('escalate_to_engineering', {
      title: 'Dashboard tasks disappear',
      description: 'Three customers report approved tasks vanish from the dashboard.',
      priority: 80,
    }, {
      id: 'support-task-1',
      company_id: 'company-1',
    } as never);

    expect(output).toContain('Engineering task created');
    expect(insertCalls).toContainEqual(expect.objectContaining({
      table: platformEvents,
      values: expect.objectContaining({
        company_id: 'company-1',
        event_type: 'support_engineering_escalation',
        payload: expect.objectContaining({
          type: 'support_engineering_escalation',
          title: 'Dashboard tasks disappear',
          summary: 'Three customers report approved tasks vanish from the dashboard.',
          engineering_task_id: 'engineering-task-1',
          from_task: 'support-task-1',
        }),
      }),
    }));
  });
});
