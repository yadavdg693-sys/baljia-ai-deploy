import { describe, expect, it } from 'vitest';
import { normalizeToolResult, pushExecutionLog } from './execution-log';

describe('runtime execution log helpers', () => {
  it('redacts secrets before appending legacy-compatible entries', () => {
    const logs: Record<string, unknown>[] = [];
    pushExecutionLog(logs, {
      tool: 'render_set_env_vars',
      input: { DATABASE_URL: 'postgres://user:secret@example/db', api_key: 'sk-abc12345678901234567890' },
    });

    expect(JSON.stringify(logs[0])).not.toContain('secret@example');
    expect(JSON.stringify(logs[0])).not.toContain('sk-abc');
    expect(JSON.stringify(logs[0])).toContain('***');
  });

  it('normalizes blocked and failed tool results without breaking string fallback', () => {
    expect(normalizeToolResult('github_push_file', 'PRE_CODE_PLANNING_GATE: blocked').status).toBe('blocked');
    expect(normalizeToolResult('render_deploy', 'Error: deploy failed').status).toBe('failed');
    expect(normalizeToolResult('check_url_health', 'HTTP 200 OK').status).toBe('completed');
  });
});
