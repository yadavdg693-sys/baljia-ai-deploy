// CEO Agent — Streaming conversation with tool use
// Primary: Claude Sonnet 4 (Anthropic direct or AWS Bedrock)
// Fallback: OpenAI GPT-4o (Codex OAuth or OPENAI_API_KEY)
// Fallback: OpenRouter (GLM-4/Qwen via OpenAI-compatible API)
// Fallback: Gemini Flash (Google) — if all else fails

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { CEOStreamEvent, ChatMessage } from '@/types';
import { assembleCEOPrompt } from './ceo.prompt';
import { CEO_TOOLS, handleToolCall } from './ceo.tools';
import type { ToolResult } from './ceo.tools';
import { isAnthropicAvailable, isBedrockAvailable, isDirectAnthropicAvailable, isOpenAIAvailable, getOpenAIApiKey, isOpenRouterAvailable, OPENROUTER_MODELS, OPENAI_MODELS, getPreferredProvider } from '@/lib/llm-provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('CEO');

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const OPENAI_MODEL = OPENAI_MODELS.GPT_5_4;
const OPENROUTER_MODEL = OPENROUTER_MODELS.FULL_AGENT;
const GEMINI_MODEL = 'gemini-2.5-flash';

// G-LLM-001: Timeout per streaming turn (longer than worker calls since interactive)
const CEO_STREAM_TIMEOUT_MS = 90_000; // 90 seconds

// ══════════════════════════════════════════════
// MAIN ENTRY — tries Claude, falls back to Gemini
// ══════════════════════════════════════════════

export async function* streamCEOResponse(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): AsyncGenerator<CEOStreamEvent> {
  // Provider-ordered fallback: respects PRIMARY_LLM_PROVIDER env var
  // Default: OpenAI (o4-mini) → Claude → OpenRouter → Gemini
  type StreamFn = typeof streamWithOpenAI;
  const providers: { name: string; available: () => boolean; stream: StreamFn }[] = [
    { name: 'openai',     available: isOpenAIAvailable,     stream: streamWithOpenAI },
    { name: 'anthropic',  available: isAnthropicAvailable,  stream: streamWithClaude },
    { name: 'openrouter', available: isOpenRouterAvailable, stream: streamWithOpenRouter },
    { name: 'gemini',     available: () => true,            stream: streamWithGemini },
  ];

  const preferred = getPreferredProvider();
  const sorted = [
    providers.find(p => p.name === preferred)!,
    ...providers.filter(p => p.name !== preferred),
  ];

  for (const p of sorted) {
    if (!p.available()) continue;
    try {
      yield* p.stream(input);
      return;
    } catch (error) {
      log.warn(`${p.name} failed, trying next provider`, { companyId: input.companyId });
    }
  }

  yield { type: 'text', content: 'AI providers are temporarily unavailable. Please try again in a moment.' };
  yield { type: 'done' };
}

// ══════════════════════════════════════════════
// CLAUDE (Primary)
// ══════════════════════════════════════════════

/** Create the right Anthropic client — Bedrock API key, Bedrock IAM, or direct */
function createAnthropicClient(): Anthropic {
  // Option 1: Bedrock long-term API key (ABSK... format)
  const bedrockApiKey = process.env.AWS_BEDROCK_API_KEY;
  if (bedrockApiKey && !isDirectAnthropicAvailable()) {
    const region = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
    log.info('Using AWS Bedrock API key', { region });
    // Bedrock API keys use Bearer auth on the Bedrock runtime endpoint
    // The Anthropic SDK base URL + custom auth header makes this work
    const AnthropicBedrock = require('@anthropic-ai/bedrock-sdk').default;
    return new AnthropicBedrock({
      awsRegion: region,
      baseURL: `https://bedrock-runtime.${region}.amazonaws.com`,
      defaultHeaders: { 'Authorization': `Bearer ${bedrockApiKey}` },
      skipAuth: true,
    }) as unknown as Anthropic;
  }

  // Option 2: Standard IAM credentials for Bedrock
  if (isBedrockAvailable() && !isDirectAnthropicAvailable()) {
    const AnthropicBedrock = require('@anthropic-ai/bedrock-sdk').default;
    const region = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
    log.info('Using AWS Bedrock IAM', { region });
    return new AnthropicBedrock({ awsRegion: region }) as unknown as Anthropic;
  }

  // Option 3: Direct Anthropic API
  return new Anthropic();
}

/** Get the right model ID — Bedrock uses a different format */
function getClaudeModelId(): string {
  if ((process.env.AWS_BEDROCK_API_KEY || isBedrockAvailable()) && !isDirectAnthropicAvailable()) {
    return process.env.AWS_BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0';
  }
  return CLAUDE_MODEL;
}

async function* streamWithClaude(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): AsyncGenerator<CEOStreamEvent> {
  const anthropic = createAnthropicClient();
  const systemPrompt = await assembleCEOPrompt(input.companyId);

  const messages: Anthropic.MessageParam[] = input.sessionHistory
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  messages.push({ role: 'user', content: input.message });

  let continueLoop = true;
  let turnCount = 0;
  const MAX_TURNS = 5; // Prevent infinite tool-use loops

  while (continueLoop) {
    continueLoop = false;
    turnCount++;

    if (turnCount > MAX_TURNS) {
      log.warn('CEO Claude hit max turns', { companyId: input.companyId, turnCount });
      yield { type: 'text', content: '\n\n*(Reached processing limit — please send another message to continue.)*' };
      break;
    }

    // G-LLM-001: 90s timeout per streaming turn (prevents frozen chat UI)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CEO_STREAM_TIMEOUT_MS);

    try {
      const stream = anthropic.messages.stream({
        model: getClaudeModelId(),
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        tools: CEO_TOOLS as Anthropic.Tool[],
      }, { signal: controller.signal });

      const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', content: event.delta.text };
          }
        }

        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            toolUseBlocks.push({
              id: event.content_block.id,
              name: event.content_block.name,
              input: {} as Record<string, unknown>,
            });
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'input_json_delta' && toolUseBlocks.length > 0) {
            const lastTool = toolUseBlocks[toolUseBlocks.length - 1];
            void lastTool;
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      const toolResults: Array<{ tool_use_id: string; result: ToolResult }> = [];

      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          const result = await handleToolCall(
            block.name,
            block.input as Record<string, unknown>,
            input.companyId
          );
          toolResults.push({ tool_use_id: block.id, result });

          if (result.action) {
            yield { type: 'action', action: result.action };
          }
        }
      }

      if (toolResults.length > 0) {
        messages.push({ role: 'assistant', content: finalMessage.content });
        messages.push({
          role: 'user',
          content: toolResults.map((tr) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.result.content,
          })),
        });
        continueLoop = finalMessage.stop_reason === 'tool_use';
      }
    } catch (error) {
      if (controller.signal.aborted) {
        log.error('CEO Claude stream timed out', { companyId: input.companyId, turnCount });
        yield { type: 'text', content: '\n\n*(Response timed out — please try again.)*' };
        break;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  yield { type: 'done' };
}

// ══════════════════════════════════════════════
// OPENAI GPT-4o (Second fallback — Codex OAuth or OPENAI_API_KEY)
// Uses OpenAI SDK with streaming + tool use
// ══════════════════════════════════════════════

async function* streamWithOpenAI(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): AsyncGenerator<CEOStreamEvent> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error('No OpenAI API key available');

  // Codex OAuth JWT? Route through chatgpt.com/backend-api via pi-ai instead of
  // the openai SDK (which only knows api.openai.com — wrong billing surface).
  const isCodexJwt = apiKey.startsWith('eyJ') && apiKey.split('.').length === 3;
  if (isCodexJwt) {
    yield* streamWithCodex(input, apiKey);
    return;
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  const systemPrompt = await assembleCEOPrompt(input.companyId);

  const openaiTools = CEO_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    ...input.sessionHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    { role: 'user', content: input.message },
  ];

  let turnCount = 0;
  const MAX_TURNS = 5;

  while (turnCount < MAX_TURNS) {
    turnCount++;

    try {
      const stream = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
        tools: openaiTools,
        max_tokens: 4096,
        reasoning_effort: 'xhigh' as any,
        stream: true,
      });

      let fullContent = '';
      // Keyed by string so we can fall back to tc.id when tc.index is missing
      // (some proxies / OpenRouter forks strip index, which would otherwise
      // collide every undefined-index delta into a single bucket).
      const toolCallAccumulator: Record<string, { id: string; function: { name: string; arguments: string } }> = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          fullContent += delta.content;
          yield { type: 'text', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const rawIdx = typeof tc.index === 'number' ? tc.index : tc.id;
            if (rawIdx === undefined || rawIdx === null) continue;
            const idx = String(rawIdx);
            if (!toolCallAccumulator[idx]) {
              toolCallAccumulator[idx] = { id: tc.id ?? '', function: { name: '', arguments: '' } };
            }
            if (tc.id) toolCallAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallAccumulator[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallAccumulator[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      const toolCalls = Object.values(toolCallAccumulator);

      if (toolCalls.length === 0) break;

      messages.push({ role: 'assistant', content: fullContent, tool_calls: toolCalls } as any);

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }

        const toolResult: ToolResult = await handleToolCall(tc.function.name, args, input.companyId);
        if (toolResult.action) yield { type: 'action', action: toolResult.action };

        messages.push({ role: 'tool', content: toolResult.content, tool_call_id: tc.id });
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        log.error('CEO OpenAI stream timed out', { companyId: input.companyId, turnCount });
        yield { type: 'text', content: '\n\n*(Response timed out — please try again.)*' };
        break;
      }
      throw error;
    }
  }

  if (turnCount >= MAX_TURNS) {
    yield { type: 'text', content: '\n\n*(Reached processing limit — please send another message to continue.)*' };
  }

  yield { type: 'done' };
}

// ══════════════════════════════════════════════
// CODEX (via pi-ai → chatgpt.com/backend-api) — used when OpenAI key is a JWT
// Same multi-turn streaming + tool-call semantics as streamWithOpenAI above.
// ══════════════════════════════════════════════

async function* streamWithCodex(
  input: { companyId: string; message: string; sessionHistory: ChatMessage[] },
  apiKey: string,
): AsyncGenerator<CEOStreamEvent> {
  const { streamCodexAgentTurn } = await import('@/lib/llm-provider');

  const systemPrompt = await assembleCEOPrompt(input.companyId);

  const codexTools = CEO_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Record<string, unknown>,
  }));

  const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_name?: string; raw?: unknown }> = [
    ...input.sessionHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: input.message },
  ];

  let turnCount = 0;
  const MAX_TURNS = 5;

  while (turnCount < MAX_TURNS) {
    turnCount++;

    let turnText = '';
    const turnToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    let turnRawAssistant: unknown = null;

    try {
      const stream = streamCodexAgentTurn({
        apiKey,
        systemPrompt,
        messages,
        tools: codexTools,
        maxTokens: 4096,
        reasoning: 'high',
      });

      for await (const event of stream) {
        if (event.type === 'text_delta') {
          turnText += event.delta;
          yield { type: 'text', content: event.delta };
        } else if (event.type === 'done') {
          turnToolCalls.push(...event.toolCalls);
          turnRawAssistant = event.rawAssistantMessage;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        log.error('CEO Codex stream timed out', { companyId: input.companyId, turnCount });
        yield { type: 'text', content: '\n\n*(Response timed out — please try again.)*' };
        break;
      }
      throw error;
    }

    if (turnToolCalls.length === 0) break;

    // Push assistant turn with embedded toolCalls (raw) so Codex can pair tool results.
    messages.push({ role: 'assistant', content: turnText, raw: turnRawAssistant });

    for (const tc of turnToolCalls) {
      const toolResult: ToolResult = await handleToolCall(tc.name, tc.arguments, input.companyId);
      if (toolResult.action) yield { type: 'action', action: toolResult.action };
      messages.push({ role: 'tool', content: toolResult.content, tool_call_id: tc.id, tool_name: tc.name });
    }
  }

  if (turnCount >= MAX_TURNS) {
    yield { type: 'text', content: '\n\n*(Reached processing limit — please send another message to continue.)*' };
  }

  yield { type: 'done' };
}

// ══════════════════════════════════════════════
// OPENROUTER (Third fallback — GLM-4, Qwen)
// Uses OpenAI-compatible API with streaming
// ══════════════════════════════════════════════

async function* streamWithOpenRouter(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): AsyncGenerator<CEOStreamEvent> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.ai',
      'X-Title': 'Baljia AI',
    },
  });

  const systemPrompt = await assembleCEOPrompt(input.companyId);

  // Convert CEO_TOOLS to OpenAI function format
  const openaiTools = CEO_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  // Build messages from session history
  const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> = [
    { role: 'system', content: systemPrompt },
    ...input.sessionHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    { role: 'user', content: input.message },
  ];

  let turnCount = 0;
  const MAX_TURNS = 5;

  while (turnCount < MAX_TURNS) {
    turnCount++;

    try {
      const stream = await client.chat.completions.create(
        {
          model: OPENROUTER_MODEL,
          messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
          tools: openaiTools,
          max_tokens: 4096,
          stream: true,
        },
      );

      let fullContent = '';
      let toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];
      // Keyed by string with fallback to tc.id when tc.index is absent
      // (OpenRouter and some proxies strip index — without the fallback,
      // every undefined-index fragment collides into a single bucket).
      const toolCallAccumulator: Record<string, { id: string; function: { name: string; arguments: string } }> = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // Stream text content
        if (delta.content) {
          fullContent += delta.content;
          yield { type: 'text', content: delta.content };
        }

        // Accumulate tool calls from streamed deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const rawIdx = typeof tc.index === 'number' ? tc.index : tc.id;
            if (rawIdx === undefined || rawIdx === null) continue;
            const idx = String(rawIdx);
            if (!toolCallAccumulator[idx]) {
              toolCallAccumulator[idx] = { id: tc.id ?? '', function: { name: '', arguments: '' } };
            }
            if (tc.id) toolCallAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallAccumulator[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallAccumulator[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      toolCalls = Object.values(toolCallAccumulator);

      if (toolCalls.length === 0) {
        // No tool calls — done
        break;
      }

      // Add assistant message with tool calls to history
      messages.push({ role: 'assistant', content: fullContent, tool_calls: toolCalls } as any);

      // Execute tool calls
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        const toolResult: ToolResult = await handleToolCall(
          tc.function.name,
          args,
          input.companyId
        );

        if (toolResult.action) {
          yield { type: 'action', action: toolResult.action };
        }

        messages.push({
          role: 'tool',
          content: toolResult.content,
          tool_call_id: tc.id,
        });
      }

      // Continue loop to get model's response after tool results
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        log.error('CEO OpenRouter stream timed out', { companyId: input.companyId, turnCount });
        yield { type: 'text', content: '\n\n*(Response timed out — please try again.)*' };
        break;
      }
      throw error;
    }
  }

  if (turnCount >= MAX_TURNS) {
    yield { type: 'text', content: '\n\n*(Reached processing limit — please send another message to continue.)*' };
  }

  yield { type: 'done' };
}

// ══════════════════════════════════════════════
// GEMINI FLASH 3 (Fourth fallback)
// No streaming tool use — single-turn with function calling
// ══════════════════════════════════════════════

// Convert CEO_TOOLS from Anthropic format to Gemini function declarations
// Anthropic schemas already have { type: 'object', properties: {...} } which is compatible
function buildGeminiTools(): any[] {
  return CEO_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }));
}

async function* streamWithGemini(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): AsyncGenerator<CEOStreamEvent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const systemPrompt = await assembleCEOPrompt(input.companyId);
  const geminiTools = buildGeminiTools();

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: geminiTools }],
  });

  // Build history from session — Gemini requires alternating user/model turns
  // The sessionHistory already includes the current user message (appended by chat route),
  // but we send it separately via sendMessageStream, so exclude it from history to avoid
  // two consecutive user messages which Gemini rejects.
  const historyMessages = input.sessionHistory
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(0, -1); // drop the last message (current user message, sent separately)

  const rawHistory = historyMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: m.content }],
  }));

  // Drop leading 'model' messages — Gemini rejects history that starts with model
  const firstUserIdx = rawHistory.findIndex((m) => m.role === 'user');
  const history = firstUserIdx >= 0 ? rawHistory.slice(firstUserIdx) : [];

  // Gemini also requires alternating roles — deduplicate consecutive same-role messages
  const cleanHistory = history.filter((m, i) => i === 0 || m.role !== history[i - 1].role);

  const chat = model.startChat({ history: cleanHistory.length > 0 ? cleanHistory : undefined });

  let continueLoop = true;
  let currentMessage = input.message;
  let turnCount = 0;
  const MAX_TURNS = 5;

  while (continueLoop) {
    continueLoop = false;
    turnCount++;

    if (turnCount > MAX_TURNS) {
      log.warn('CEO Gemini hit max turns', { companyId: input.companyId, turnCount });
      yield { type: 'text', content: '\n\n*(Reached processing limit — please send another message to continue.)*' };
      break;
    }

    try {
      // G-LLM-001: 90s timeout per streaming turn
      const result = await Promise.race([
        chat.sendMessageStream(currentMessage),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('CEO_STREAM_TIMEOUT')), CEO_STREAM_TIMEOUT_MS)
        ),
      ]);

      let fullText = '';

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullText += text;
          yield { type: 'text', content: text };
        }
      }

      // Check for function calls in the final response
      const response = await result.response;
      const functionCalls = response.functionCalls();

      if (functionCalls && functionCalls.length > 0) {
        // Process tool calls
        const functionResponses: Array<{ name: string; response: Record<string, unknown> }> = [];

        for (const fc of functionCalls) {
          try {
            const toolResult = await handleToolCall(
              fc.name,
              (fc.args ?? {}) as Record<string, unknown>,
              input.companyId
            );

            if (toolResult.action) {
              yield { type: 'action', action: toolResult.action };
            }

            functionResponses.push({
              name: fc.name,
              response: { result: toolResult.content },
            });
          } catch (toolError) {
            log.error('Tool call failed', { tool: fc.name, error: toolError instanceof Error ? toolError.message : String(toolError) });
            functionResponses.push({
              name: fc.name,
              response: { result: `Error: ${toolError instanceof Error ? toolError.message : 'Tool execution failed'}` },
            });
          }
        }

        // Send function results back to Gemini for follow-up response
        try {
          const followUp = await Promise.race([
            chat.sendMessageStream(
              functionResponses.map((fr) => ({
                functionResponse: {
                  name: fr.name,
                  response: fr.response,
                },
              }))
            ),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('CEO_STREAM_TIMEOUT')), CEO_STREAM_TIMEOUT_MS)
            ),
          ]);

          for await (const chunk of followUp.stream) {
            const text = chunk.text();
            if (text) {
              yield { type: 'text', content: text };
            }
          }

          // Check if Gemini wants more tool calls
          const followUpResponse = await followUp.response;
          const moreCalls = followUpResponse.functionCalls();
          continueLoop = moreCalls !== undefined && moreCalls.length > 0;

          if (continueLoop) {
            currentMessage = JSON.stringify(moreCalls);
          }
        } catch (followUpError) {
          // Gemini follow-up failed — don't crash, the tool action already happened
          log.error('Gemini follow-up failed', { error: followUpError instanceof Error ? followUpError.message : String(followUpError) });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'CEO_STREAM_TIMEOUT') {
        log.error('CEO Gemini stream timed out', { companyId: input.companyId, turnCount });
        yield { type: 'text', content: '\n\n*(Response timed out — please try again.)*' };
        break;
      }
      throw error;
    }
  }

  yield { type: 'done' };
}
