// CEO Agent — Streaming conversation with tool use
// Primary: Claude Sonnet 4 (Anthropic)
// Fallback: OpenRouter (GLM-4/Qwen via OpenAI-compatible API)
// Fallback: Gemini Flash 3 (Google) — if all else fails

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { CEOStreamEvent, ChatMessage } from '@/types';
import { assembleCEOPrompt } from './ceo.prompt';
import { CEO_TOOLS, handleToolCall } from './ceo.tools';
import type { ToolResult } from './ceo.tools';
import { isAnthropicAvailable, isOpenRouterAvailable, OPENROUTER_MODELS } from '@/lib/llm-provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('CEO');

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
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
  if (isAnthropicAvailable()) {
    try {
      yield* streamWithClaude(input);
      return;
    } catch (error) {
      log.warn('Claude failed, falling back to OpenRouter');
    }
  }

  if (isOpenRouterAvailable()) {
    try {
      yield* streamWithOpenRouter(input);
      return;
    } catch (error) {
      log.warn('OpenRouter failed, falling back to Gemini');
    }
  }

  try {
    yield* streamWithGemini(input);
  } catch (geminiError) {
    log.error('All providers failed', {}, geminiError);
    yield { type: 'text', content: 'AI providers are temporarily unavailable. Please try again in a moment.' };
    yield { type: 'done' };
  }
}

// ══════════════════════════════════════════════
// CLAUDE (Primary)
// ══════════════════════════════════════════════

async function* streamWithClaude(input: {
  companyId: string;
  message: string;
  sessionHistory: ChatMessage[];
}): AsyncGenerator<CEOStreamEvent> {
  const anthropic = new Anthropic();
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
        model: CLAUDE_MODEL,
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
// OPENROUTER (Second fallback — GLM-4, Qwen)
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
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'https://baljia.com',
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
      // Track tool call assembly from streaming chunks
      const toolCallAccumulator: Record<number, { id: string; function: { name: string; arguments: string } }> = {};

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
            const idx = tc.index;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// GEMINI FLASH 3 (Third fallback)
// No streaming tool use — single-turn with function calling
// ══════════════════════════════════════════════

// Convert CEO_TOOLS from Anthropic format to Gemini function declarations
// Anthropic schemas already have { type: 'object', properties: {...} } which is compatible
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: buildGeminiTools() }],
  });

  // Build history from session
  const history = input.sessionHistory
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));

  const chat = model.startChat({ history });

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
        }

        // Send function results back and continue (also with timeout)
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
