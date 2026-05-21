import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic OAuth helper so we don't actually hit the API.
vi.mock('@/lib/anthropic-oauth', () => ({
  createAnthropicWithOAuthAsync: vi.fn(),
  withClaudeCodeIdentity: (prompt: string) => prompt,
}));

import { reviewDiff, summarizeReview } from './code-review.service';
import { createAnthropicWithOAuthAsync } from '@/lib/anthropic-oauth';

function mockClaudeReturning(text: string) {
  const create = vi.fn(async () => ({ content: [{ type: 'text', text }] }));
  vi.mocked(createAnthropicWithOAuthAsync).mockResolvedValue({
    client: { messages: { create } } as never,
    isOAuth: false,
  });
  return create;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reviewDiff — happy paths', () => {
  it('returns parsed findings when LLM returns clean JSON', async () => {
    mockClaudeReturning(JSON.stringify({
      summary: '2 issues found',
      findings: [
        { severity: 'high',   file: 'server.js', line: 42, category: 'auth',   issue: 'Missing requireAuth on /admin', suggested_fix: 'Add requireAuth middleware' },
        { severity: 'medium', file: 'server.js', line: 99, category: 'sql',    issue: 'Missing input validation' },
      ],
    }));
    const result = await reviewDiff('--- a/server.js\n+++ b/server.js\n+app.get(\'/admin\', ...)', 'org/repo');
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].severity).toBe('high');
    expect(result.summary).toMatch(/2 issues/);
  });

  it('handles code-fence-wrapped JSON', async () => {
    mockClaudeReturning('```json\n{"summary":"clean","findings":[]}\n```');
    const result = await reviewDiff('--- a/x\n+++ b/x\n+console.log(1)', 'org/repo');
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns clean result when LLM returns empty findings array', async () => {
    mockClaudeReturning('{"summary":"All good","findings":[]}');
    const result = await reviewDiff('--- a/x\n+++ b/x\n+1', 'org/repo');
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});

describe('reviewDiff — defensive paths', () => {
  it('skips review when diff is too small', async () => {
    const create = mockClaudeReturning('{"summary":"x","findings":[]}');
    const result = await reviewDiff('   ', 'org/repo');
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/too small/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('skips review when no Anthropic provider available', async () => {
    vi.mocked(createAnthropicWithOAuthAsync).mockRejectedValue(new Error('no provider'));
    const result = await reviewDiff('a-real-diff-with-enough-content-to-not-be-too-small', 'org/repo');
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/skipped/i);
    expect(result.findings).toEqual([]);
  });

  it('returns ok:false when LLM response is unparseable', async () => {
    mockClaudeReturning('this is not json — the LLM ignored the schema instruction');
    const result = await reviewDiff('--- a/x\n+++ b/x\n+1+2+3+4+5+6+7+8+9+10', 'org/repo');
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/parseable/i);
  });

  it('returns ok:false when LLM call throws', async () => {
    const create = vi.fn(async () => { throw new Error('rate limit'); });
    vi.mocked(createAnthropicWithOAuthAsync).mockResolvedValue({
      client: { messages: { create } } as never,
      isOAuth: false,
    });
    const result = await reviewDiff('--- a/x\n+++ b/x\n+a-real-and-long-enough-diff-text', 'org/repo');
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/rate limit/);
  });

  it('truncates very large diffs before sending', async () => {
    const create = mockClaudeReturning('{"summary":"clean","findings":[]}');
    const big = 'x'.repeat(50_000);
    await reviewDiff(big, 'org/repo');
    expect(create).toHaveBeenCalledOnce();
    const callArgs = create.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>;
    const userContent = callArgs[0][0].messages[0].content;
    expect(userContent.length).toBeLessThan(35_000);
    expect(userContent).toMatch(/diff truncated/);
  });
});

describe('summarizeReview', () => {
  it('returns CODE REVIEW PASS when 0 findings + ok', () => {
    expect(summarizeReview({ ok: true, findings: [], summary: 'clean' })).toMatch(/^CODE REVIEW PASS/);
  });

  it('returns CODE REVIEW SKIPPED when ok:false', () => {
    expect(summarizeReview({ ok: false, findings: [], summary: 'no provider' })).toMatch(/^CODE REVIEW SKIPPED/);
  });

  it('groups by severity in the summary', () => {
    const out = summarizeReview({
      ok: true,
      findings: [
        { severity: 'high',   file: 'a', category: 'auth',  issue: 'i' },
        { severity: 'high',   file: 'a', category: 'sql',   issue: 'i' },
        { severity: 'medium', file: 'b', category: 'other', issue: 'i' },
      ],
      summary: '3 issues',
    });
    expect(out).toMatch(/high=2/);
    expect(out).toMatch(/medium=1/);
  });
});
