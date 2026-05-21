export type ProviderName = 'anthropic' | 'openai' | 'openrouter' | 'gemini' | string;

export interface RuntimeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  provider?: ProviderName;
  raw?: unknown;
}

export interface RuntimeToolCall {
  id?: string;
  name: string;
  input: Record<string, unknown>;
  provider?: ProviderName;
  raw?: unknown;
}

export function toRuntimeMessage(role: RuntimeMessage['role'], content: unknown, provider?: ProviderName, raw?: unknown): RuntimeMessage {
  return {
    role,
    content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
    provider,
    raw,
  };
}

export function toRuntimeToolCall(name: string, input: unknown, provider?: ProviderName, raw?: unknown): RuntimeToolCall {
  return {
    name,
    input: input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {},
    provider,
    raw,
  };
}
