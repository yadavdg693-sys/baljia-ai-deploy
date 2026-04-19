// JSON output helper — wraps callSmallLLM with JSON-only prompting + parse + retry-once
// Used by Phase 3a stages that produce structured outputs (market research, mission, idea shapes)

import { createLogger } from '@/lib/logger';
import { callSmallLLM } from '../llm/small-llm';

const log = createLogger('OnboardingJsonMode');

export interface JsonModeOptions {
  maxTokens?: number;
  retryOnce?: boolean;
}

// Calls the LLM expecting JSON-only output. Strips common wrapping (```json / ```)
// and parses. Retries once with stricter prompt if first parse fails.
export async function callSmallLLMJson<T>(
  prompt: string,
  opts: JsonModeOptions = {},
): Promise<T> {
  const maxTokens = opts.maxTokens ?? 2500;
  const jsonOnlyPrompt = `${prompt}

Respond with ONLY a valid JSON object. No prose before or after. No markdown code fences. Start your response with { and end with }.`;

  try {
    const response = await callSmallLLM(jsonOnlyPrompt, maxTokens);
    return parseJson<T>(response);
  } catch (err) {
    if (opts.retryOnce === false) throw err;
    log.warn('JSON parse failed, retrying once', { error: err instanceof Error ? err.message : String(err) });

    const retryPrompt = `${prompt}

CRITICAL: Your previous response could not be parsed as JSON. Respond with ONLY a valid JSON object, starting with { and ending with }. No prose, no markdown, no commentary.`;
    const response = await callSmallLLM(retryPrompt, maxTokens);
    return parseJson<T>(response);
  }
}

function parseJson<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // Slice from first { to last } to tolerate trailing prose
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`No JSON object found in response: ${cleaned.slice(0, 200)}`);
  }
  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonStr) as T;
}
