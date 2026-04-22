// LLM Provider — determines which provider to use based on available API keys
// Default chain: OpenAI (Codex OAuth) → Anthropic → OpenRouter → Gemini
// Override with PRIMARY_LLM_PROVIDER env var: 'openai' | 'anthropic' | 'openrouter' | 'gemini'
// OpenRouter provides access to GLM-4 and Qwen models via OpenAI-compatible API
// OpenAI Codex OAuth provides GPT-5.4 via stored Codex credentials

import { getCodexApiKeySync } from '@/lib/codex-oauth';
import { createLogger } from '@/lib/logger';

const log = createLogger('LLMProvider');

// ── Anthropic ──────────────────────────────────

export function isAnthropicAvailable(): boolean {
  if (isDirectAnthropicAvailable()) return true;
  if (isBedrockAvailable()) return true;
  return false;
}

export function isBedrockAvailable(): boolean {
  if (process.env.AWS_BEDROCK_API_KEY) return true;
  const region = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION;
  const hasExplicitCreds = !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;
  const hasRegion = !!region;
  return hasRegion && (hasExplicitCreds || !!process.env.AWS_BEDROCK_ENABLED);
}

export function isDirectAnthropicAvailable(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!key && key !== 'placeholder' && key.startsWith('sk-ant-');
}

// ── OpenAI (Codex OAuth) ───────────────────────

/** Check if OpenAI is available via Codex OAuth credentials or direct OPENAI_API_KEY */
export function isOpenAIAvailable(): boolean {
  // Direct env key
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey && envKey !== 'placeholder' && envKey.startsWith('sk-')) return true;
  // Codex OAuth stored credentials (sync check — no network)
  return !!getCodexApiKeySync();
}

/** Get the OpenAI API key — Codex OAuth first, then env fallback */
export function getOpenAIApiKey(): string | null {
  const codexKey = getCodexApiKeySync();
  if (codexKey) return codexKey;
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey && envKey !== 'placeholder' && envKey.startsWith('sk-')) return envKey;
  return null;
}

// ── OpenRouter ─────────────────────────────────

export function isOpenRouterAvailable(): boolean {
  const key = process.env.OPENROUTER_API_KEY;
  return !!key && key !== 'placeholder';
}

// ── Gemini ──────────────────────────────────────

export function isGeminiAvailable(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return !!key && key !== 'placeholder';
}

// ── Moonshot AI (direct Kimi API — OpenAI-compatible) ──

export function isMoonshotAvailable(): boolean {
  const key = process.env.MOONSHOT_API_KEY;
  return !!key && key !== 'placeholder' && key.startsWith('sk-');
}

export const MOONSHOT_API_BASE = process.env.MOONSHOT_API_BASE ?? 'https://api.moonshot.ai/v1';

export const MOONSHOT_MODELS = {
  /** Kimi K2.6 — latest (1T-param MoE, 128K context, agentic reasoning) */
  KIMI_K2_6: 'kimi-k2.6',
  /** Kimi K2.5 — prior stable */
  KIMI_K2_5: 'kimi-k2.5',
  /** 128K-context general model */
  MOONSHOT_V1_128K: 'moonshot-v1-128k',
  /** 32K-context general model (cheaper) */
  MOONSHOT_V1_32K: 'moonshot-v1-32k',
  /** Auto-select variant by context length */
  MOONSHOT_V1_AUTO: 'moonshot-v1-auto',
} as const;

/**
 * Call Moonshot AI's Kimi via their OpenAI-compatible REST API.
 * Drop-in replacement for callOpenAI when PRIMARY_LLM_PROVIDER=moonshot.
 */
export async function callMoonshot(params: {
  userPrompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  model?: string;
  temperature?: number;
}): Promise<string> {
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) throw new Error('MOONSHOT_API_KEY not set');

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (params.systemPrompt) messages.push({ role: 'system', content: params.systemPrompt });
  messages.push({ role: 'user', content: params.userPrompt });

  const res = await fetch(`${MOONSHOT_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model ?? MOONSHOT_MODELS.KIMI_K2_6,
      messages,
      max_tokens: params.maxTokens ?? 512,
      temperature: params.temperature ?? 0.7,
    }),
  });

  const body = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; code?: string | number };
  };

  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Moonshot API error: ${msg}`);
  }

  return body.choices?.[0]?.message?.content ?? '';
}

// ── OpenRouter model IDs ────────────────────────

export const OPENROUTER_MODELS = {
  GLM_5_1: 'z-ai/glm-5.1',
  QWEN_3_6_PLUS: 'qwen/qwen3.6-plus',
  /** Moonshot AI Kimi K2.6 — latest Kimi release (via OpenRouter) */
  KIMI_K2_6: 'moonshotai/kimi-k2.6',
  /** Kimi K2.5 — prior stable */
  KIMI_K2_5: 'moonshotai/kimi-k2.5',
  /** Kimi K2 Thinking — reasoning variant */
  KIMI_K2_THINKING: 'moonshotai/kimi-k2-thinking',
  /** Kimi K2 (original, Sep 2024 snapshot) */
  KIMI_K2: 'moonshotai/kimi-k2',
  FULL_AGENT: 'z-ai/glm-5.1',
  TEMPLATE: 'qwen/qwen3.6-plus',
  DETERMINISTIC: 'qwen/qwen3.6-plus',
} as const;

// ── OpenAI model IDs ────────────────────────────

export const OPENAI_MODELS = {
  /** Primary model for all agents — CEO, Engineering, and workers */
  GPT_5_4: 'gpt-5.4',
  /** Fast/cheap model for classification and short tasks (Haiku-equivalent) */
  GPT_5_4_MINI: 'gpt-5.4-mini',
  /** Legacy fallbacks */
  GPT_4O: 'gpt-4o',
  GPT_4O_MINI: 'gpt-4o-mini',
  O4_MINI: 'o4-mini',
} as const;

/** Returns true if the model is an o-series reasoning model (o1, o3, o4, etc.) */
export function isReasoningModel(model: string): boolean {
  return /^o\d/.test(model);
}

// ── Provider selection ──────────────────────────

type Provider = 'anthropic' | 'openai' | 'openrouter' | 'moonshot' | 'gemini';

const PROVIDER_CHECK: Record<Provider, () => boolean> = {
  openai: isOpenAIAvailable,
  anthropic: isAnthropicAvailable,
  openrouter: isOpenRouterAvailable,
  moonshot: isMoonshotAvailable,
  gemini: isGeminiAvailable,
};

/** Default fallback order — OpenAI first since Codex OAuth is primary */
const DEFAULT_ORDER: Provider[] = ['openai', 'anthropic', 'openrouter', 'moonshot', 'gemini'];

function getProviderOrder(): Provider[] {
  const primary = (process.env.PRIMARY_LLM_PROVIDER ?? '').toLowerCase() as Provider;
  if (primary && PROVIDER_CHECK[primary]) {
    // Move the chosen primary to front, keep others in default order
    return [primary, ...DEFAULT_ORDER.filter(p => p !== primary)];
  }
  return DEFAULT_ORDER;
}

export function getPreferredProvider(): Provider {
  for (const p of getProviderOrder()) {
    if (PROVIDER_CHECK[p]()) return p;
  }
  return 'gemini'; // will fail with clear error
}

// ══════════════════════════════════════════════
// SHARED OpenAI CALLER — used by CEO, governance, onboarding, workers
// ══════════════════════════════════════════════

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface OpenAICallOptions {
  model?: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Reasoning effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Detect Codex OAuth JWT (signed token from ChatGPT login) vs platform API key.
 * Codex tokens are 3-part JWTs (`header.payload.sig`) and start with `eyJ`.
 * Platform API keys start with `sk-` and are not dot-separated.
 */
function isCodexJwt(key: string): boolean {
  if (!key.startsWith('eyJ')) return false;
  return key.split('.').length === 3;
}

/**
 * Call Codex Responses API (chatgpt.com/backend-api) via pi-ai's provider.
 * Used when the API key is a Codex OAuth JWT — must NOT hit api.openai.com,
 * which would 401 / "insufficient_quota" because Codex tokens are tied to
 * ChatGPT subscription billing, not the standard OpenAI API plan.
 */
async function callCodex(apiKey: string, opts: OpenAICallOptions): Promise<string> {
  const { getModel } = await import('@mariozechner/pi-ai');
  const { streamSimple } = await import('@mariozechner/pi-ai');

  const {
    model = OPENAI_MODELS.GPT_5_4_MINI,
    systemPrompt,
    userPrompt,
    maxTokens = 1024,
    timeoutMs = 30_000,
    reasoningEffort,
  } = opts;

  // Map our internal model IDs to pi-ai's openai-codex provider model IDs.
  // The Codex provider only exposes a subset (no `gpt-5.4-mini` equivalent —
  // map mini-tier requests to gpt-5.1-codex-mini which is the cheapest reasoning model).
  const codexModelId = mapToCodexModel(model);
  const piModel = getModel('openai-codex', codexModelId as 'gpt-5.4');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Codex Responses API requires non-empty "instructions" (systemPrompt).
    // 400 "Instructions are required" if blank. Provide a tiny default if caller didn't.
    const effectiveSystem = systemPrompt && systemPrompt.trim().length > 0
      ? systemPrompt
      : 'You are a helpful AI assistant.';

    const eventStream = streamSimple(
      piModel,
      {
        systemPrompt: effectiveSystem,
        messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      },
      {
        apiKey,
        maxTokens,
        signal: controller.signal,
        // pi-ai's reasoning levels: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
        // (note: our 'none' maps to 'minimal' since Codex models always reason)
        reasoning: reasoningEffort === 'none' ? 'minimal' : (reasoningEffort ?? 'medium'),
      },
    );

    let fullText = '';
    for await (const event of eventStream) {
      if (event.type === 'text_delta') fullText += event.delta;
      if (event.type === 'error') {
        // pi-ai error event shape: { type: 'error', reason, error: AssistantMessage }
        const errMsg = event.error?.errorMessage ?? 'unknown';
        throw new Error(`Codex error: ${errMsg}`);
      }
    }
    return fullText;
  } finally {
    clearTimeout(timeout);
  }
}

function mapToCodexModel(model: string): string {
  // Internal IDs → openai-codex provider model IDs (pi-ai/dist/models.generated.js).
  // CRITICAL: Codex with a ChatGPT account (Plus/Pro) supports a NARROW subset.
  // Confirmed via live test on Pro account (2026-04-19):
  //   gpt-5.4              → ✅ works
  //   gpt-5.1              → ❌ "model is not supported when using Codex with a ChatGPT account"
  //   gpt-5.1-codex-mini   → ❌ same error
  // So every internal alias maps to gpt-5.4 — there is no cheap tier on ChatGPT-account Codex.
  // (For real cost differentiation use OPENAI_API_KEY=sk-... and hit api.openai.com instead.)
  void model;
  return 'gpt-5.4';
}

/**
 * Call OpenAI chat completions using Codex OAuth credentials or OPENAI_API_KEY.
 * Routes Codex JWTs to chatgpt.com/backend-api via pi-ai (Codex Responses API),
 * and platform API keys (`sk-...`) to api.openai.com (Chat Completions).
 * Supports reasoning_effort for GPT-5.4 and o-series models.
 * Returns the text content of the first choice.
 */
export async function callOpenAI(opts: OpenAICallOptions): Promise<string> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error('No OpenAI API key available (set OPENAI_API_KEY or sign in with Codex)');

  // Codex OAuth tokens MUST NOT go to api.openai.com — wrong billing surface.
  if (isCodexJwt(apiKey)) {
    return callCodex(apiKey, opts);
  }

  const {
    model = OPENAI_MODELS.GPT_5_4_MINI,
    systemPrompt,
    userPrompt,
    maxTokens = 1024,
    temperature = 0.3,
    timeoutMs = 30_000,
    reasoningEffort,
  } = opts;

  const reasoning = isReasoningModel(model);

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: reasoning ? 'developer' : 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';

  const body: Record<string, unknown> = { model, messages };
  if (reasoning) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = temperature;
  }
  // reasoning_effort works for both GPT-5.4 and o-series
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

// ══════════════════════════════════════════════
// CODEX AGENT TURN — for worker tool loops
// ══════════════════════════════════════════════
//
// Workers need full agent semantics: system prompt + multi-turn messages + tool
// calls + tool results. The OpenAI SDK path (used in agent-factory runWithOpenAI)
// hits api.openai.com and 401s with Codex JWTs. This helper runs one turn of an
// agent against the Codex Responses API via pi-ai, returning the final assistant
// message (text + toolCalls). Caller is responsible for executing tools and
// pushing tool-result messages back for the next turn.
//
// Returns null only on transport error (caller should fail the turn). On model
// "error" event we throw so retry/watchdog logic can react.

export interface CodexTurnTool {
  name: string;
  description: string;
  // pi-ai's Tool.parameters is typed as TSchema (typebox) but at runtime accepts
  // any plain JSONSchema object (typebox emits JSONSchema). Our internal tools
  // already store JSONSchema in `input_schema`, so pass-through works.
  input_schema: Record<string, unknown>;
}

export interface CodexTurnMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
  /**
   * If set, this entry is treated as a raw pi-ai Message (e.g. a previous
   * AssistantMessage with embedded toolCalls returned from runCodexAgentTurn).
   * When present, `role` and `content` are ignored. Use this to push prior
   * assistant turns into multi-turn history.
   */
  raw?: unknown;
}

export interface CodexTurnResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  stopReason: 'stop' | 'length' | 'toolUse' | 'error';
  usage?: { input: number; output: number; totalTokens: number };
  /**
   * The raw pi-ai AssistantMessage from this turn. Caller must push this back
   * into the messages array for the next turn — Codex enforces that every
   * tool-result message is preceded by the assistant message that originated
   * the tool call (pairs by call_id). Skipping it returns:
   *   "No tool call found for function call output with call_id ..."
   */
  rawAssistantMessage: unknown;
}

/**
 * Run one agent turn against Codex (via pi-ai) and return the final message.
 * Apparent simple but: pi-ai expects strongly-typed Message[] with timestamps,
 * tool messages structured as ToolResultMessage, and tools as Tool[] (TSchema-typed).
 * We adapt our looser internal shapes to those.
 */
export async function runCodexAgentTurn(params: {
  apiKey: string;
  systemPrompt: string;
  messages: CodexTurnMessage[];
  tools: CodexTurnTool[];
  maxTokens?: number;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  signal?: AbortSignal;
}): Promise<CodexTurnResult> {
  const { getModel, streamSimple } = await import('@mariozechner/pi-ai');

  const piModel = getModel('openai-codex', 'gpt-5.4');

  // Adapt our messages → pi-ai Message[]. Tool results need toolResult role.
  // If the entry has `raw` set, it's already a pi-ai Message — pass through unchanged
  // (used for prior assistant turns with embedded toolCalls; required so Codex can
  // pair tool-result messages with the assistant call_ids that originated them).
  type PiMessage = Parameters<typeof streamSimple>[1]['messages'][number];
  const piMessages: PiMessage[] = params.messages.map((m) => {
    if (m.raw !== undefined) return m.raw as PiMessage;
    if (m.role === 'tool') {
      return {
        role: 'toolResult',
        toolCallId: m.tool_call_id ?? '',
        toolName: m.tool_name ?? '',
        content: [{ type: 'text', text: m.content }],
        isError: false,
        timestamp: Date.now(),
      } as PiMessage;
    }
    return { role: m.role, content: m.content, timestamp: Date.now() } as PiMessage;
  });

  // Adapt our tools → pi-ai Tool[]. JSONSchema passes through as TSchema at runtime.
  type PiTool = NonNullable<Parameters<typeof streamSimple>[1]['tools']>[number];
  const piTools: PiTool[] = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema as PiTool['parameters'],
  }));

  const stream = streamSimple(
    piModel,
    {
      systemPrompt: params.systemPrompt && params.systemPrompt.trim().length > 0
        ? params.systemPrompt
        : 'You are a helpful AI assistant.',
      messages: piMessages,
      tools: piTools.length > 0 ? piTools : undefined,
    },
    {
      apiKey: params.apiKey,
      maxTokens: params.maxTokens ?? 4096,
      signal: params.signal,
      reasoning: params.reasoning ?? 'medium',
    },
  );

  let text = '';
  const toolCalls: CodexTurnResult['toolCalls'] = [];
  let stopReason: CodexTurnResult['stopReason'] = 'stop';
  let usage: CodexTurnResult['usage'];
  let rawAssistantMessage: unknown = null;

  for await (const event of stream) {
    if (event.type === 'text_delta') text += event.delta;
    if (event.type === 'toolcall_end') {
      toolCalls.push({
        id: event.toolCall.id,
        name: event.toolCall.name,
        arguments: event.toolCall.arguments,
      });
    }
    if (event.type === 'done') {
      stopReason = event.reason;
      usage = {
        input: event.message.usage.input,
        output: event.message.usage.output,
        totalTokens: event.message.usage.totalTokens,
      };
      rawAssistantMessage = event.message;
    }
    if (event.type === 'error') {
      throw new Error(`Codex agent error: ${event.error?.errorMessage ?? 'unknown'}`);
    }
  }

  return { text, toolCalls, stopReason, usage, rawAssistantMessage };
}

// ══════════════════════════════════════════════
// CODEX STREAMING TURN — for CEO chat (live token-by-token output)
// ══════════════════════════════════════════════

export type CodexStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'done'; text: string; toolCalls: CodexTurnResult['toolCalls']; stopReason: CodexTurnResult['stopReason']; rawAssistantMessage: unknown };

/**
 * Streaming version of runCodexAgentTurn — yields text/thinking deltas as they
 * arrive so the caller can pipe them straight to an SSE response. Final event
 * is `done` with the same payload as runCodexAgentTurn.
 *
 * Used by CEO chat where the founder sees text appear character-by-character.
 */
export async function* streamCodexAgentTurn(params: {
  apiKey: string;
  systemPrompt: string;
  messages: CodexTurnMessage[];
  tools: CodexTurnTool[];
  maxTokens?: number;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  signal?: AbortSignal;
}): AsyncGenerator<CodexStreamEvent> {
  const { getModel, streamSimple } = await import('@mariozechner/pi-ai');

  const piModel = getModel('openai-codex', 'gpt-5.4');

  type PiMessage = Parameters<typeof streamSimple>[1]['messages'][number];
  const piMessages: PiMessage[] = params.messages.map((m) => {
    if (m.raw !== undefined) return m.raw as PiMessage;
    if (m.role === 'tool') {
      return {
        role: 'toolResult',
        toolCallId: m.tool_call_id ?? '',
        toolName: m.tool_name ?? '',
        content: [{ type: 'text', text: m.content }],
        isError: false,
        timestamp: Date.now(),
      } as PiMessage;
    }
    return { role: m.role, content: m.content, timestamp: Date.now() } as PiMessage;
  });

  type PiTool = NonNullable<Parameters<typeof streamSimple>[1]['tools']>[number];
  const piTools: PiTool[] = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema as PiTool['parameters'],
  }));

  const stream = streamSimple(
    piModel,
    {
      systemPrompt: params.systemPrompt && params.systemPrompt.trim().length > 0
        ? params.systemPrompt
        : 'You are a helpful AI assistant.',
      messages: piMessages,
      tools: piTools.length > 0 ? piTools : undefined,
    },
    {
      apiKey: params.apiKey,
      maxTokens: params.maxTokens ?? 4096,
      signal: params.signal,
      reasoning: params.reasoning ?? 'medium',
    },
  );

  let text = '';
  const toolCalls: CodexTurnResult['toolCalls'] = [];
  let stopReason: CodexTurnResult['stopReason'] = 'stop';
  let rawAssistantMessage: unknown = null;

  for await (const event of stream) {
    if (event.type === 'text_delta') {
      text += event.delta;
      yield { type: 'text_delta', delta: event.delta };
    } else if (event.type === 'thinking_delta') {
      yield { type: 'thinking_delta', delta: event.delta };
    } else if (event.type === 'toolcall_end') {
      toolCalls.push({
        id: event.toolCall.id,
        name: event.toolCall.name,
        arguments: event.toolCall.arguments,
      });
    } else if (event.type === 'done') {
      stopReason = event.reason;
      rawAssistantMessage = event.message;
    } else if (event.type === 'error') {
      throw new Error(`Codex stream error: ${event.error?.errorMessage ?? 'unknown'}`);
    }
  }

  yield { type: 'done', text, toolCalls, stopReason, rawAssistantMessage };
}

/**
 * Async version of getOpenAIApiKey that can refresh expired Codex tokens.
 * Use this in non-hot-path code (e.g., before starting a long agent run).
 */
export async function getOpenAIApiKeyAsync(): Promise<string | null> {
  // Try sync first (fast path)
  const syncKey = getOpenAIApiKey();
  if (syncKey) return syncKey;

  // Try async refresh of expired Codex token
  try {
    const { getCodexApiKey } = await import('@/lib/codex-oauth');
    return await getCodexApiKey();
  } catch {
    return null;
  }
}
