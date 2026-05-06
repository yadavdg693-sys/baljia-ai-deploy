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
  providerPacks: {
    provider_id: 'provider_id',
    display_name: 'display_name',
    category: 'category',
    signup_url: 'signup_url',
    api_key_url: 'api_key_url',
    api_key_env_var: 'api_key_env_var',
    steps: 'steps',
    notes: 'notes',
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

// ── OCR engine mock ────────────────────────────────────────────────────────
const mockRunOcr = vi.fn();
const mockFindTextOnPage = vi.fn();
const mockFetchImageBuffer = vi.fn();

vi.mock('./ocr-engine', () => ({
  runOcr: (...args: unknown[]) => mockRunOcr(...args),
  findTextOnPage: (...args: unknown[]) => mockFindTextOnPage(...args),
  fetchImageBuffer: (...args: unknown[]) => mockFetchImageBuffer(...args),
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

describe('list_provider_packs', () => {
  it('returns "no packs" when none exist', async () => {
    // list_provider_packs uses .from(...).where(undefined) — terminal Promise resolves the chain
    selectChain.where.mockResolvedValueOnce([]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('list_provider_packs', {}, makeTask());
    expect(result).toContain('No provider packs available');
  });

  it('formats packs grouped output', async () => {
    selectChain.where.mockResolvedValueOnce([
      { provider_id: 'openai', display_name: 'OpenAI', category: 'llm', signup_url: 'https://platform.openai.com/signup', api_key_env_var: 'OPENAI_API_KEY' },
      { provider_id: 'stripe', display_name: 'Stripe', category: 'payments', signup_url: 'https://dashboard.stripe.com/register', api_key_env_var: 'STRIPE_SECRET_KEY' },
    ]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('list_provider_packs', {}, makeTask());
    expect(result).toContain('Available provider packs (2)');
    expect(result).toContain('openai (llm)');
    expect(result).toContain('stripe (payments)');
    expect(result).toContain('OPENAI_API_KEY');
  });

  it('reports category-specific empty result', async () => {
    selectChain.where.mockResolvedValueOnce([]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('list_provider_packs', { category: 'storage' }, makeTask());
    expect(result).toContain('No provider packs in category "storage"');
  });
});

describe('start_provider_pack', () => {
  it('returns helpful error when provider not found', async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('start_provider_pack', { provider_id: 'fakeprovider' }, makeTask());
    expect(result).toContain('No provider pack found for "fakeprovider"');
  });

  it('formats the pack recipe with numbered steps', async () => {
    selectChain.limit.mockResolvedValueOnce([{
      provider_id: 'openai',
      display_name: 'OpenAI',
      category: 'llm',
      signup_url: 'https://platform.openai.com/signup',
      api_key_url: 'https://platform.openai.com/api-keys',
      api_key_env_var: 'OPENAI_API_KEY',
      steps: [
        { kind: 'navigate', instruction: 'Go to signup page' },
        { kind: 'fill', instruction: 'Enter email', selector: 'input[type=email]' },
        { kind: 'capture', instruction: 'Copy the key', expected: 'starts with sk-' },
      ],
      notes: 'Phone verification required.',
    }]);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('start_provider_pack', { provider_id: 'openai' }, makeTask());
    expect(result).toContain('Provider Pack: OpenAI');
    expect(result).toContain('Save the obtained key as: OPENAI_API_KEY');
    expect(result).toContain('1. [navigate] Go to signup page');
    expect(result).toContain('2. [fill] Enter email [selector: input[type=email]]');
    expect(result).toContain('3. [capture] Copy the key (expected: starts with sk-)');
    expect(result).toContain('Phone verification required.');
  });
});

describe('ocr_image', () => {
  beforeEach(() => {
    mockRunOcr.mockReset();
    mockFetchImageBuffer.mockReset();
  });

  it('OCRs a fetched image and returns the text + word count', async () => {
    mockFetchImageBuffer.mockResolvedValueOnce(Buffer.from('fake-image'));
    mockRunOcr.mockResolvedValueOnce({
      fullText: 'Hello World',
      words: [
        { text: 'Hello', bbox: { x0: 0, y0: 0, x1: 50, y1: 20 }, confidence: 95 },
        { text: 'World', bbox: { x0: 60, y0: 0, x1: 110, y1: 20 }, confidence: 92 },
      ],
    });
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('ocr_image', { image_url: 'https://example.com/img.png' }, makeTask());
    expect(result).toContain('OCR of https://example.com/img.png (2 words)');
    expect(result).toContain('Hello World');
    expect(mockFetchImageBuffer).toHaveBeenCalledWith('https://example.com/img.png');
  });

  it('reports a friendly error when fetch fails', async () => {
    mockFetchImageBuffer.mockRejectedValueOnce(new Error('Failed to fetch image (404)'));
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('ocr_image', { image_url: 'https://example.com/missing.png' }, makeTask());
    expect(result).toContain('OCR failed for https://example.com/missing.png');
    expect(result).toContain('Failed to fetch image (404)');
  });

  it('truncates very long OCR output', async () => {
    mockFetchImageBuffer.mockResolvedValueOnce(Buffer.from('fake'));
    mockRunOcr.mockResolvedValueOnce({
      fullText: 'a'.repeat(5000),
      words: [{ text: 'a', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 }, confidence: 80 }],
    });
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('ocr_image', { image_url: 'https://example.com/long.png' }, makeTask());
    expect(result).toContain('…(truncated)');
  });
});

describe('ocr_current_page', () => {
  beforeEach(() => {
    mockRunOcr.mockReset();
    mockFetchImageBuffer.mockReset();
  });

  it('OCRs from a provided screenshot URL', async () => {
    mockFetchImageBuffer.mockResolvedValueOnce(Buffer.from('img'));
    mockRunOcr.mockResolvedValueOnce({
      fullText: 'Page text here',
      words: [{ text: 'Page', bbox: { x0: 0, y0: 0, x1: 30, y1: 15 }, confidence: 90 }],
    });
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('ocr_current_page', { screenshot_url: 'https://cdn.example.com/shot.png' }, makeTask());
    expect(result).toContain('OCR result (1 words detected)');
    expect(result).toContain('Page text here');
  });

  it('falls back to error message when no screenshot_url and no Browserbase', async () => {
    // BROWSERBASE_API_KEY not set in test env → isBrowserbaseConfigured returns false
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('ocr_current_page', {}, makeTask());
    expect(result).toContain('Browserbase not configured');
  });
});

describe('ocr_click_text', () => {
  beforeEach(() => {
    mockFindTextOnPage.mockReset();
    mockFetchImageBuffer.mockReset();
  });

  it('reports the click coordinates when text is found (no Browserbase to actually click)', async () => {
    mockFetchImageBuffer.mockResolvedValueOnce(Buffer.from('img'));
    mockFindTextOnPage.mockResolvedValueOnce({
      x: 120, y: 240, matched: 'Continue', confidence: 88.5,
    });
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('ocr_click_text', {
      target_text: 'Continue with Google',
      screenshot_url: 'https://cdn.example.com/shot.png',
    }, makeTask());
    expect(result).toContain('Found "Continue" at (120, 240)');
    expect(result).toContain('Browserbase not configured to click');
  });

  it('reports a not-found message when OCR finds nothing', async () => {
    mockFetchImageBuffer.mockResolvedValueOnce(Buffer.from('img'));
    mockFindTextOnPage.mockResolvedValueOnce(null);
    const { handleBrowserTool } = await import('./browser.tools');
    const result = await handleBrowserTool('ocr_click_text', {
      target_text: 'Fake Button',
      screenshot_url: 'https://cdn.example.com/shot.png',
    }, makeTask());
    expect(result).toContain('Text "Fake Button" not found on page via OCR');
  });
});
