// Unit tests for the Browser Agent domain-skills tool handlers.
// Mocks @/lib/db (Drizzle fluent API), drizzle-orm, and @/lib/logger so handlers
// can be exercised without a real DB connection.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock chains ─────────────────────────────────────────────────────────
const insertChain = {
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
};
const selectChain = {
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
};
const deleteChain = {
  where: vi.fn().mockResolvedValue(undefined),
};
const updateChain = {
  set: vi.fn(),
  where: vi.fn().mockResolvedValue(undefined),
};

insertChain.values.mockReturnValue(insertChain);
insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
selectChain.from.mockReturnValue(selectChain);
selectChain.where.mockReturnValue(selectChain);
selectChain.orderBy.mockReturnValue(selectChain);
selectChain.limit.mockResolvedValue([]);
updateChain.set.mockReturnValue(updateChain);

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => selectChain),
    delete: vi.fn(() => deleteChain),
    update: vi.fn(() => updateChain),
  },
  domainSkills: {
    company_id: 'company_id',
    site_domain: 'site_domain',
    skill_kind: 'skill_kind',
    key: 'key',
    value: 'value',
    confidence: 'confidence',
    last_used_at: 'last_used_at',
  },
  browserCredentials: {
    company_id: 'company_id',
    site_domain: 'site_domain',
    username: 'username',
    password_encrypted: 'password_encrypted',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  and: (...args: unknown[]) => ({ __and: args }),
  desc: (a: unknown) => ({ __desc: a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => ({ __sql: strings.raw }),
    { raw: (s: string) => ({ __sqlRaw: s }) },
  ),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Browserbase env vars unset by default — handlers gate on them but our two
// new handlers don't, so this doesn't affect tests.

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-uuid-1',
    company_id: 'company-uuid-1',
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([]);
});

describe('record_domain_skill', () => {
  it('records a valid skill and reports success', async () => {
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('record_domain_skill', {
      domain: 'hunter.io',
      kind: 'selector',
      key: 'login_button',
      value: 'button[type=submit]',
    }, makeTask());
    expect(result).toContain('Recorded skill for hunter.io');
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: 'company-uuid-1',
        site_domain: 'hunter.io',
        skill_kind: 'selector',
        key: 'login_button',
        value: 'button[type=submit]',
      }),
    );
  });

  it('rejects an invalid kind', async () => {
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('record_domain_skill', {
      domain: 'hunter.io',
      kind: 'banana',
      key: 'x',
      value: 'y',
    }, makeTask());
    expect(result).toContain('Invalid kind');
    expect(insertChain.values).not.toHaveBeenCalled();
  });

  it('normalises the domain (strips www, lowercases)', async () => {
    const { handleBrowserTool } = await import('./browser.tools');
    await handleBrowserTool('record_domain_skill', {
      domain: 'WWW.Hunter.IO',
      kind: 'note',
      key: 'k',
      value: 'v',
    }, makeTask());
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ site_domain: 'hunter.io' }),
    );
  });

  it('accepts all 5 valid kinds', async () => {
    const { handleBrowserTool } = await import('./browser.tools');
    for (const kind of ['selector', 'url_pattern', 'wait', 'trap', 'note']) {
      const result = await handleBrowserTool('record_domain_skill', {
        domain: 'example.com',
        kind,
        key: 'k',
        value: 'v',
      }, makeTask());
      expect(result).toContain('Recorded skill');
    }
  });
});

describe('read_domain_skills', () => {
  it('returns a friendly message when no skills exist', async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('read_domain_skills', {
      domain: 'hunter.io',
    }, makeTask());
    expect(result).toContain('No prior skills recorded for hunter.io');
  });

  it('formats stored skills with confidence and kind labels', async () => {
    selectChain.limit.mockResolvedValueOnce([
      { kind: 'selector', key: 'login', value: '#login-btn', confidence: 70, last_used_at: new Date() },
      { kind: 'note', key: 'gotcha', value: 'rejects gmail', confidence: 50, last_used_at: new Date() },
    ]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('read_domain_skills', {
      domain: 'hunter.io',
    }, makeTask());
    expect(result).toContain('Skills for hunter.io (2 entries)');
    expect(result).toContain('[selector] login (confidence 70): #login-btn');
    expect(result).toContain('[note] gotcha (confidence 50): rejects gmail');
  });

  it('applies the kind filter when provided', async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const { handleBrowserTool } = await import('./browser.tools');
    await handleBrowserTool('read_domain_skills', {
      domain: 'hunter.io',
      kind: 'selector',
    }, makeTask());
    const whereCallArgs = (selectChain.where as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { __and: unknown[] };
    // 3 conditions when kind filter given (company_id + site_domain + kind), 2 without
    expect(whereCallArgs.__and).toHaveLength(3);
  });

  it('uses 2-condition where when kind filter is omitted', async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const { handleBrowserTool } = await import('./browser.tools');
    await handleBrowserTool('read_domain_skills', {
      domain: 'hunter.io',
    }, makeTask());
    const whereCallArgs = (selectChain.where as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { __and: unknown[] };
    expect(whereCallArgs.__and).toHaveLength(2);
  });

  it('normalises domain (strips www, lowercases) before querying', async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('read_domain_skills', {
      domain: 'WWW.Hunter.IO',
    }, makeTask());
    expect(result).toContain('hunter.io');
  });
});
