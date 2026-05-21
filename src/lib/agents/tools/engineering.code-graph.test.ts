import { describe, expect, it, vi, beforeEach } from 'vitest';

const graphMocks = vi.hoisted(() => ({
  buildCodeGraph: vi.fn(),
  readCodeGraphReport: vi.fn(),
  queryCodeGraph: vi.fn(),
  explainCodeNode: vi.fn(),
  codeGraphPath: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
  companies: {},
  tasks: {},
  taskExecutions: {},
  failureFingerprints: {},
}));

vi.mock('@/lib/services/code-graph.service', () => graphMocks);

const task = {
  id: 'task-1',
  company_id: 'company-1',
  title: 'Extend booking dashboard',
  description: 'Add billing status and document search to an existing app.',
} as never;

describe('Engineering code graph tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers runtime code graph tools without accepting a repo argument', async () => {
    const { getEngineeringTools } = await import('./engineering.tools');
    const tools = getEngineeringTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      'build_code_graph',
      'read_code_graph_report',
      'query_code_graph',
      'explain_code_node',
      'code_graph_path',
    ]));

    const buildTool = tools.find((tool) => tool.name === 'build_code_graph');
    const queryTool = tools.find((tool) => tool.name === 'query_code_graph');
    expect(Object.keys((buildTool?.input_schema.properties ?? {}) as Record<string, unknown>)).toEqual(['force']);
    expect(Object.keys((queryTool?.input_schema.properties ?? {}) as Record<string, unknown>)).toEqual(['question']);
  });

  it('returns CODE_GRAPH_EVIDENCE after a successful build', async () => {
    graphMocks.buildCodeGraph.mockResolvedValueOnce({
      ok: true,
      manifest: {
        repo_sha: 'abc123',
        github_repo: 'BALAJIapps/founder-app',
        default_branch: 'main',
        file_count: 42,
        skipped_count: 7,
        accepted_bytes: 12345,
      },
      reportExcerpt: 'Graph report excerpt',
    });

    const { handleEngineeringTool } = await import('./engineering.tools');
    await expect(handleEngineeringTool('build_code_graph', { force: true }, task)).resolves.toContain('CODE_GRAPH_EVIDENCE repo_sha=abc123 files=42 report_saved=true');
    expect(graphMocks.buildCodeGraph).toHaveBeenCalledWith('company-1', { force: true });
  });

  it('falls back cleanly when Graphify is unavailable', async () => {
    graphMocks.buildCodeGraph.mockResolvedValueOnce({
      ok: false,
      unavailable: true,
      reason: 'Graphify CLI unavailable',
    });

    const { handleEngineeringTool } = await import('./engineering.tools');
    await expect(handleEngineeringTool('build_code_graph', {}, task)).resolves.toContain('CODE_GRAPH_UNAVAILABLE');
  });

  it('routes query, explain, and path calls through the company-scoped service', async () => {
    graphMocks.queryCodeGraph.mockResolvedValueOnce({ ok: true, answer: 'CODE_GRAPH_QUERY_EVIDENCE repo_sha=abc\n- app/api/bookings/route.ts' });
    graphMocks.explainCodeNode.mockResolvedValueOnce({ ok: true, answer: 'CODE_GRAPH_NODE_EVIDENCE repo_sha=abc\nNode: route.ts' });
    graphMocks.codeGraphPath.mockResolvedValueOnce({ ok: true, answer: 'CODE_GRAPH_PATH_EVIDENCE repo_sha=abc\npage -> route -> table' });

    const { handleEngineeringTool } = await import('./engineering.tools');

    await expect(handleEngineeringTool('query_code_graph', { question: 'Which files create bookings?' }, task)).resolves.toContain('app/api/bookings/route.ts');
    await expect(handleEngineeringTool('explain_code_node', { node: 'route.ts' }, task)).resolves.toContain('CODE_GRAPH_NODE_EVIDENCE');
    await expect(handleEngineeringTool('code_graph_path', { from: 'dashboard page', to: 'bookings table' }, task)).resolves.toContain('page -> route -> table');

    expect(graphMocks.queryCodeGraph).toHaveBeenCalledWith('company-1', 'Which files create bookings?');
    expect(graphMocks.explainCodeNode).toHaveBeenCalledWith('company-1', 'route.ts');
    expect(graphMocks.codeGraphPath).toHaveBeenCalledWith('company-1', 'dashboard page', 'bookings table');
  });
});
