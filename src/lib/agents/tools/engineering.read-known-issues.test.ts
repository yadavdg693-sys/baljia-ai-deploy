// Tests for the read_known_issues engineering tool.
// Mocks the failure service to avoid hitting the real DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRelevant = vi.fn();
const mockFormat = vi.fn((issues: unknown[]) =>
  issues.length === 0 ? 'KNOWN ISSUES: none match this context.' : `KNOWN ISSUES: ${issues.length} found`,
);

vi.mock('@/lib/services/failure.service', () => ({
  getRelevantKnownIssuesForAgent: mockGetRelevant,
  formatKnownIssuesForAgent: mockFormat,
}));

// Stub the db module so engineering.tools' transitive imports don't try to
// connect to a real Neon. The tool we're testing never touches db directly.
vi.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
  companies: {},
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

// The tool handler is internal; reach it through the dispatcher.
async function callTool(input: Record<string, unknown>): Promise<string> {
  const { handleEngineeringTool } = await import('./engineering.tools');
  // Minimal Task shape — handler only uses task.company_id for some tools, not this one.
  const task = { id: 't1', company_id: 'c1', tag: 'engineering', title: '', description: '' } as never;
  return handleEngineeringTool('read_known_issues', input, task);
}

describe('read_known_issues tool', () => {
  beforeEach(() => {
    mockGetRelevant.mockReset();
    mockFormat.mockClear();
  });

  it('returns formatted issues when matches exist', async () => {
    mockGetRelevant.mockResolvedValueOnce([
      { fix_status: 'fixed', description: 'render envvars dropped', fix_notes: 'put envVars at top level' },
    ]);
    const result = await callTool({ context: 'creating Render service' });
    expect(mockGetRelevant).toHaveBeenCalledWith('creating Render service', 30, 5);
    expect(result).toContain('KNOWN ISSUES');
    expect(result).toContain('1 found');
  });

  it('returns "none match" when no issues found', async () => {
    mockGetRelevant.mockResolvedValueOnce([]);
    const result = await callTool({ context: 'doing something completely novel' });
    expect(result).toMatch(/none match this context/);
  });

  it('returns clear error when context is missing or empty', async () => {
    const r1 = await callTool({});
    const r2 = await callTool({ context: '   ' });
    expect(r1).toMatch(/context is required/i);
    expect(r2).toMatch(/context is required/i);
    expect(mockGetRelevant).not.toHaveBeenCalled();
  });

  it('does NOT crash when DB lookup throws', async () => {
    mockGetRelevant.mockRejectedValueOnce(new Error('db unreachable'));
    const result = await callTool({ context: 'render service' });
    expect(result).toMatch(/lookup failed/i);
    expect(result).toMatch(/Proceed cautiously/);
  });
});

describe('formatKnownIssuesForAgent (real implementation)', () => {
  it('produces a compact bullet list under ~800 chars target for typical 3-5 entries', async () => {
    vi.doUnmock('@/lib/services/failure.service');
    vi.resetModules();
    const { formatKnownIssuesForAgent } = await import('@/lib/services/failure.service');
    const issues = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      fingerprint: `fp-${i}`,
      category: 'infra_error',
      description: 'Render service env vars dropped silently due to API shape change',
      fix_status: 'fixed' as const,
      fix_notes: 'envVars must be top-level of body, not nested in serviceDetails',
      affected_agents: [30],
      affected_tools: ['render_create_service'],
      occurrence_count: 1,
      first_seen_at: new Date(),
      last_seen_at: new Date(),
      regression_sensitive: false,
      root_cause: null,
      fix_applied_at: new Date(),
    })) as never[];
    const out = formatKnownIssuesForAgent(issues);
    expect(out).toMatch(/^KNOWN ISSUES: 5/);
    expect(out).toContain('[FIXED]');
    expect(out).toContain('fix:');
    expect(out.length).toBeLessThan(1500); // generous; real-world will be tighter
  });
});
