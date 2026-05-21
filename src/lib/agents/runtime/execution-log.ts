const SECRET_KEY_RE = /(^|_)(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|CONNECTION_STRING|PRIVATE_KEY)$/i;
const SECRET_VALUE_RE = /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z_]{20,}|rk_[0-9A-Za-z_]{20,})\b/g;

export type LegacyExecutionLogEntry = Record<string, unknown>;

export interface TypedToolResult {
  toolName: string;
  status: 'completed' | 'blocked' | 'failed';
  text: string;
  evidence?: Record<string, unknown>;
}

export function redactForExecutionLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForExecutionLog);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.key === 'string' && 'value' in obj && SECRET_KEY_RE.test(obj.key)) {
      return { ...obj, value: '***' };
    }
    return Object.fromEntries(Object.entries(obj).map(([key, nested]) => [
      key,
      SECRET_KEY_RE.test(key) ? '***' : redactForExecutionLog(nested),
    ]));
  }
  if (typeof value === 'string') {
    return value
      .replace(/postgres(?:ql)?:\/\/[^:]+:[^@]+@/gi, 'postgres://***:***@')
      .replace(SECRET_VALUE_RE, '***');
  }
  return value;
}

export function pushExecutionLog(logs: LegacyExecutionLogEntry[], entry: LegacyExecutionLogEntry): void {
  logs.push(redactForExecutionLog(entry) as LegacyExecutionLogEntry);
}

export function normalizeToolResult(toolName: string, result: unknown): TypedToolResult {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  const failed = /\b(error|failed|failure|exception|timeout)\b/i.test(text);
  const blocked = /\b(blocked|policy_gate|pre_code_planning_gate|requires approval)\b/i.test(text);
  return {
    toolName,
    status: blocked ? 'blocked' : failed ? 'failed' : 'completed',
    text,
  };
}

export function executionEntryEventType(entry: LegacyExecutionLogEntry): string {
  if (typeof entry.tool === 'string') return 'tool_result';
  if (typeof entry.event === 'string') return entry.event;
  if (typeof entry.message === 'string') return 'message';
  return 'progress';
}
